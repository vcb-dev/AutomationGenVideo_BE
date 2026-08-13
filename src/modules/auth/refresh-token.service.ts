import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedRefreshToken {
  id: string;
  rawToken: string;
  familyId: string;
  expiresAt: Date;
}

/**
 * KHÔNG dùng bcrypt ở đây, và đây là lý do: bcrypt chậm có chủ đích để chống dò mật khẩu — thứ con
 * người đặt nên entropy thấp. Token này là 32 byte ngẫu nhiên, 256 bit, không có gì để dò. Quan
 * trọng hơn: bcrypt sinh salt riêng mỗi lần nên hai bản băm của cùng một token vẫn khác nhau →
 * không đánh index được → mỗi lần refresh phải quét cả bảng. SHA-256 cho tra cứu O(1).
 */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(
    userId: string,
    ttlMs: number,
    ctx: SessionContext = {},
    familyId?: string,
  ): Promise<IssuedRefreshToken> {
    const rawToken = randomBytes(32).toString('hex');
    const family = familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);

    const row = await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        token_hash: hashRefreshToken(rawToken),
        family_id: family,
        expires_at: expiresAt,
        user_agent: ctx.userAgent ?? null,
        ip_address: ctx.ipAddress ?? null,
      },
    });

    return { id: row.id, rawToken, familyId: family, expiresAt };
  }

  async rotate(
    rawToken: string,
    ttlMs: number,
    ctx: SessionContext = {},
  ): Promise<IssuedRefreshToken & { userId: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token_hash: hashRefreshToken(rawToken) },
    });

    if (!record) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    // Hết hạn là chuyện bình thường của một phiên sống lâu, không phải dấu hiệu tấn công — nên
    // KHÔNG thu hồi family ở nhánh này.
    if (record.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token đã hết hạn');
    }

    if (record.revoked_at) {
      const revokedAgeMs = Date.now() - record.revoked_at.getTime();
      // Đua tab: hai tab refresh gần như cùng lúc, tab thứ hai gửi token vừa bị thu hồi xong.
      // Nhận diện bằng "đã có token thay thế" + "vừa mới thu hồi". Không thể trả lại chính token
      // thay thế đó vì DB chỉ giữ bản băm của nó — nên cấp một token mới trong CÙNG family.
      const isBenignRace = record.replaced_by !== null && revokedAgeMs <= this.graceMs();

      if (!isBenignRace) {
        await this.revokeFamily(record.family_id);
        this.logger.warn(
          `Phát hiện tái sử dụng refresh token — đã thu hồi family ${record.family_id} của user ${record.user_id}`,
        );
        throw new UnauthorizedException('Refresh token đã bị thu hồi');
      }
    }

    const issued = await this.issue(record.user_id, ttlMs, ctx, record.family_id);

    // Chỉ đánh dấu thay thế cho lần xoay vòng ĐẦU TIÊN. Lần đua tab sau không được ghi đè
    // replaced_by, nếu không chuỗi thay thế mất dấu đúng lúc cần nó nhất để điều tra.
    if (!record.revoked_at) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revoked_at: new Date(), replaced_by: issued.id },
      });
    }

    return { ...issued, userId: record.user_id };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async revokeByRawToken(rawToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token_hash: hashRefreshToken(rawToken) },
    });
    // Đăng xuất với token rác vẫn phải thành công: người dùng chỉ muốn thoát, không cần biết token
    // còn hợp lệ hay không.
    if (record) {
      await this.revokeFamily(record.family_id);
    }
  }

  private graceMs(): number {
    return Number(this.config.get<string>('REFRESH_REUSE_GRACE_MS', '30000'));
  }
}

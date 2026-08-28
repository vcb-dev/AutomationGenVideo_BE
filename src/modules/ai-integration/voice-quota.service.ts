import { Injectable, ForbiddenException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UserVoiceQuotaInfo {
  date: string;
  default_limit: number;
  used_count: number;
  granted_extra: number;
  total_allowed: number;
  remaining: number;
}

@Injectable()
export class VoiceQuotaService implements OnModuleInit {
  private readonly logger = new Logger(VoiceQuotaService.name);
  public static readonly DEFAULT_DAILY_LIMIT = 8;
  public static readonly MAX_GRANT_PER_ACTION = 8;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Tự động tạo bảng nếu chưa có trong Postgres (đảm bảo không phụ thuộc migration)
    try {
      if (this.prisma.isHealthy) {
        await this.prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS user_daily_voice_quotas (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date VARCHAR(10) NOT NULL,
            default_limit INT NOT NULL DEFAULT 8,
            used_count INT NOT NULL DEFAULT 0,
            granted_extra INT NOT NULL DEFAULT 0,
            granted_by_id UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT user_daily_voice_quotas_user_id_date_key UNIQUE (user_id, date)
          );
          CREATE INDEX IF NOT EXISTS user_daily_voice_quotas_user_id_idx ON user_daily_voice_quotas(user_id);
          CREATE INDEX IF NOT EXISTS user_daily_voice_quotas_date_idx ON user_daily_voice_quotas(date);
        `);
      }
    } catch (e: any) {
      this.logger.warn(`[VoiceQuotaService] Init table warning: ${e?.message}`);
    }
  }

  /**
   * Lấy ngày định dạng YYYY-MM-DD theo múi giờ Việt Nam (Asia/Ho_Chi_Minh).
   */
  getTodayVnString(): string {
    return DateTime.now().setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd');
  }

  /**
   * Lấy thông tin hạn mức tạo voice trong ngày của user.
   */
  async getQuota(userId?: string, dateStr?: string): Promise<UserVoiceQuotaInfo> {
    const date = dateStr || this.getTodayVnString();
    if (!userId) {
      return {
        date,
        default_limit: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        used_count: 0,
        granted_extra: 0,
        total_allowed: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        remaining: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
      };
    }

    try {
      const record = await this.prisma.userDailyVoiceQuota.findUnique({
        where: {
          user_id_date: {
            user_id: userId,
            date,
          },
        },
      });

      const defaultLimit = record?.default_limit ?? VoiceQuotaService.DEFAULT_DAILY_LIMIT;
      const usedCount = record?.used_count ?? 0;
      const grantedExtra = record?.granted_extra ?? 0;
      const totalAllowed = defaultLimit + grantedExtra;
      const remaining = Math.max(0, totalAllowed - usedCount);

      return {
        date,
        default_limit: defaultLimit,
        used_count: usedCount,
        granted_extra: grantedExtra,
        total_allowed: totalAllowed,
        remaining,
      };
    } catch (err: any) {
      this.logger.warn(`[VoiceQuotaService] getQuota query failed, using default: ${err?.message}`);
      return {
        date,
        default_limit: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        used_count: 0,
        granted_extra: 0,
        total_allowed: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        remaining: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
      };
    }
  }

  /**
   * Kiểm tra và tiêu thụ 1 lượt tạo voice.
   * Nếu hết lượt sẽ ném ForbiddenException (403).
   */
  async checkAndConsumeQuota(userId: string): Promise<UserVoiceQuotaInfo> {
    const date = this.getTodayVnString();

    const quota = await this.getQuota(userId, date);
    if (quota.remaining <= 0) {
      throw new ForbiddenException(
        `Bạn đã sử dụng hết hạn mức tạo voice hôm nay (${quota.total_allowed} lượt). Vui lòng liên hệ Admin để được cấp thêm lượt.`,
      );
    }

    // Ghi nhận +1 lượt sử dụng
    const updated = await this.prisma.userDailyVoiceQuota.upsert({
      where: {
        user_id_date: {
          user_id: userId,
          date,
        },
      },
      create: {
        user_id: userId,
        date,
        default_limit: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        used_count: 1,
        granted_extra: 0,
      },
      update: {
        used_count: {
          increment: 1,
        },
      },
    });

    const totalAllowed = updated.default_limit + updated.granted_extra;
    const remaining = Math.max(0, totalAllowed - updated.used_count);

    return {
      date,
      default_limit: updated.default_limit,
      used_count: updated.used_count,
      granted_extra: updated.granted_extra,
      total_allowed: totalAllowed,
      remaining,
    };
  }

  /**
   * Admin cấp thêm lượt tạo voice cho user trong ngày hôm nay (tối đa 8 lượt/lần cấp).
   */
  async grantExtraQuota(targetUserId: string, extraCount: number, adminId?: string): Promise<UserVoiceQuotaInfo> {
    const count = Number(extraCount);
    if (isNaN(count) || count < 1 || count > VoiceQuotaService.MAX_GRANT_PER_ACTION) {
      throw new BadRequestException(
        `Số lượt cấp thêm không hợp lệ. Mỗi lần chỉ được cấp từ 1 đến tối đa ${VoiceQuotaService.MAX_GRANT_PER_ACTION} lượt.`,
      );
    }

    // Kiểm tra user tồn tại
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, full_name: true },
    });
    if (!targetUser) {
      throw new BadRequestException('Người dùng không tồn tại.');
    }

    const date = this.getTodayVnString();

    const updated = await this.prisma.userDailyVoiceQuota.upsert({
      where: {
        user_id_date: {
          user_id: targetUserId,
          date,
        },
      },
      create: {
        user_id: targetUserId,
        date,
        default_limit: VoiceQuotaService.DEFAULT_DAILY_LIMIT,
        used_count: 0,
        granted_extra: count,
        granted_by_id: adminId || null,
      },
      update: {
        granted_extra: {
          increment: count,
        },
        granted_by_id: adminId || null,
      },
    });

    const totalAllowed = updated.default_limit + updated.granted_extra;
    const remaining = Math.max(0, totalAllowed - updated.used_count);

    this.logger.log(
      `[VoiceQuotaService] Admin ${adminId ?? 'system'} đã cấp thêm ${count} lượt tạo voice cho user ${targetUserId} (${targetUser.full_name}) ngày ${date}. Tổng được phép: ${totalAllowed}, còn lại: ${remaining}`,
    );

    return {
      date,
      default_limit: updated.default_limit,
      used_count: updated.used_count,
      granted_extra: updated.granted_extra,
      total_allowed: totalAllowed,
      remaining,
    };
  }
}

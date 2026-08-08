import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RefreshTokenService, hashRefreshToken } from '../refresh-token.service';

const TTL_7D = 604_800_000;
const GRACE_MS = 30_000;

/** Prisma giả bằng mảng trong bộ nhớ — đủ để chạy đúng logic xoay vòng mà không cần DB thật. */
function buildPrisma() {
  const rows: any[] = [];
  let seq = 0;
  const prisma = {
    rows,
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `rt${++seq}`, revoked_at: null, replaced_by: null, ...data };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.token_hash === where.token_hash) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter(
          (r) => r.family_id === where.family_id && r.revoked_at === null,
        );
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
  };
  return prisma as unknown as PrismaService & { rows: any[] };
}

function buildService(prisma: any, graceMs = GRACE_MS) {
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'REFRESH_REUSE_GRACE_MS' ? String(graceMs) : fallback,
  } as unknown as ConfigService;
  return new RefreshTokenService(prisma, config);
}

describe('hashRefreshToken', () => {
  it('là SHA-256 hex của token thô', () => {
    const raw = 'abc123';
    expect(hashRefreshToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashRefreshToken(raw)).toHaveLength(64);
  });
});

describe('RefreshTokenService.issue', () => {
  it('sinh token thô 64 ký tự hex và trả về family mới', async () => {
    const prisma = buildPrisma();
    const issued = await buildService(prisma).issue('user-1', TTL_7D);

    expect(issued.rawToken).toHaveLength(64);
    expect(issued.familyId).toBeTruthy();
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // Đây là điều kiện an toàn cốt lõi: lộ dump DB không được phép mạo danh được ai.
  it('DB lưu bản BĂM chứ không phải token thô', async () => {
    const prisma = buildPrisma();
    const issued = await buildService(prisma).issue('user-1', TTL_7D);

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].token_hash).not.toBe(issued.rawToken);
    expect(prisma.rows[0].token_hash).toBe(hashRefreshToken(issued.rawToken));
    // Không cột nào được chứa token thô.
    expect(JSON.stringify(prisma.rows[0])).not.toContain(issued.rawToken);
  });

  it('ghi lại user agent và IP khi có', async () => {
    const prisma = buildPrisma();
    await buildService(prisma).issue('user-1', TTL_7D, {
      userAgent: 'Chrome/130',
      ipAddress: '10.0.0.5',
    });
    expect(prisma.rows[0].user_agent).toBe('Chrome/130');
    expect(prisma.rows[0].ip_address).toBe('10.0.0.5');
  });

  it('hai lần đăng nhập tạo hai family khác nhau', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const a = await service.issue('user-1', TTL_7D);
    const b = await service.issue('user-1', TTL_7D);
    expect(a.familyId).not.toBe(b.familyId);
  });
});

describe('RefreshTokenService.rotate', () => {
  it('cấp token mới trong cùng family và thu hồi token cũ', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const first = await service.issue('user-1', TTL_7D);

    const second = await service.rotate(first.rawToken, TTL_7D);

    expect(second.userId).toBe('user-1');
    expect(second.rawToken).not.toBe(first.rawToken);
    expect(second.familyId).toBe(first.familyId);

    const oldRow = prisma.rows.find((r) => r.id === first.id);
    expect(oldRow.revoked_at).toBeInstanceOf(Date);
    expect(oldRow.replaced_by).toBe(second.id);
  });

  it('từ chối token không tồn tại', async () => {
    const service = buildService(buildPrisma());
    await expect(service.rotate('khong-co-that', TTL_7D)).rejects.toThrow(UnauthorizedException);
  });

  it('từ chối token đã hết hạn, và KHÔNG thu hồi cả family', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const issued = await service.issue('user-1', TTL_7D);
    // Đẩy hạn về quá khứ: hết hạn là chuyện bình thường, không phải dấu hiệu bị trộm.
    prisma.rows[0].expires_at = new Date(Date.now() - 1000);

    await expect(service.rotate(issued.rawToken, TTL_7D)).rejects.toThrow(UnauthorizedException);
    expect(prisma.rows[0].revoked_at).toBeNull();
  });

  // Đây là lý do tồn tại của cả cơ chế family.
  it('dùng lại token đã thu hồi ngoài cửa sổ khoan dung → thu hồi TOÀN BỘ family', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const first = await service.issue('user-1', TTL_7D);
    const second = await service.rotate(first.rawToken, TTL_7D);

    // Đẩy thời điểm thu hồi lùi quá cửa sổ khoan dung.
    const oldRow = prisma.rows.find((r) => r.id === first.id);
    oldRow.revoked_at = new Date(Date.now() - GRACE_MS - 1000);

    await expect(service.rotate(first.rawToken, TTL_7D)).rejects.toThrow(UnauthorizedException);

    // Token #2 tuy chưa từng bị dùng sai vẫn phải chết theo: ta không biết kẻ trộm giữ cái nào.
    const secondRow = prisma.rows.find((r) => r.id === second.id);
    expect(secondRow.revoked_at).toBeInstanceOf(Date);
  });

  // Hai tab cùng refresh một lúc là chuyện xảy ra hằng ngày, không được coi là tấn công.
  it('đua tab trong cửa sổ khoan dung → cấp token mới, KHÔNG thu hồi family', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const first = await service.issue('user-1', TTL_7D);
    const second = await service.rotate(first.rawToken, TTL_7D);

    const third = await service.rotate(first.rawToken, TTL_7D);

    expect(third.familyId).toBe(first.familyId);
    expect(third.rawToken).not.toBe(second.rawToken);

    const secondRow = prisma.rows.find((r) => r.id === second.id);
    expect(secondRow.revoked_at).toBeNull();
  });

  it('lần đua tab không ghi đè replaced_by của token gốc', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const first = await service.issue('user-1', TTL_7D);
    const second = await service.rotate(first.rawToken, TTL_7D);
    await service.rotate(first.rawToken, TTL_7D);

    // Giữ nguyên chuỗi thay thế đầu tiên, nếu không thì mất dấu khi cần điều tra sự cố.
    const firstRow = prisma.rows.find((r) => r.id === first.id);
    expect(firstRow.replaced_by).toBe(second.id);
  });
});

describe('RefreshTokenService.revokeByRawToken', () => {
  it('thu hồi cả family — đăng xuất là chấm dứt toàn bộ chuỗi phiên đó', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const first = await service.issue('user-1', TTL_7D);
    const second = await service.rotate(first.rawToken, TTL_7D);

    await service.revokeByRawToken(second.rawToken);

    expect(prisma.rows.every((r) => r.revoked_at !== null)).toBe(true);
  });

  it('im lặng bỏ qua token không tồn tại — đăng xuất không được phép ném lỗi', async () => {
    const service = buildService(buildPrisma());
    await expect(service.revokeByRawToken('rac')).resolves.toBeUndefined();
  });
});

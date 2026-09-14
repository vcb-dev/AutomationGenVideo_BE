import { VoiceQuotaService } from './voice-quota.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

describe('VoiceQuotaService', () => {
  function buildService(opts: { quotaRecord?: any; targetUser?: any } = {}) {
    let quota = opts.quotaRecord !== undefined ? opts.quotaRecord : null;
    const prisma: any = {
      isHealthy: true,
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (opts.targetUser !== undefined) return opts.targetUser;
          return { id: where.id, full_name: 'Nguyễn Văn A' };
        }),
      },
      userDailyVoiceQuota: {
        findUnique: jest.fn(async () => quota),
        upsert: jest.fn(async ({ create, update }: any) => {
          if (!quota) {
            quota = {
              user_id: create.user_id,
              date: create.date,
              default_limit: create.default_limit ?? 8,
              used_count: create.used_count ?? 0,
              granted_extra: create.granted_extra ?? 0,
              granted_by_id: create.granted_by_id ?? null,
            };
          } else {
            if (update.used_count?.increment) {
              quota.used_count += update.used_count.increment;
            }
            if (update.granted_extra?.increment) {
              quota.granted_extra += update.granted_extra.increment;
            }
            if (update.granted_by_id !== undefined) {
              quota.granted_by_id = update.granted_by_id;
            }
          }
          return quota;
        }),
      },
    };

    const service = new VoiceQuotaService(prisma);
    return { service, prisma };
  }

  it('lấy hạn mức mặc định 8 lượt/ngày cho user mới', async () => {
    const { service } = buildService({ quotaRecord: null });
    const quota = await service.getQuota('user-1', '2026-08-28');

    expect(quota.default_limit).toBe(8);
    expect(quota.used_count).toBe(0);
    expect(quota.granted_extra).toBe(0);
    expect(quota.total_allowed).toBe(8);
    expect(quota.remaining).toBe(8);
  });

  it('tiêu thụ 1 lượt tạo voice thành công khi còn hạn mức', async () => {
    const { service } = buildService({
      quotaRecord: {
        user_id: 'user-1',
        date: '2026-08-28',
        default_limit: 8,
        used_count: 2,
        granted_extra: 0,
      },
    });

    jest.spyOn(service, 'getTodayVnString').mockReturnValue('2026-08-28');

    const result = await service.checkAndConsumeQuota('user-1');
    expect(result.used_count).toBe(3);
    expect(result.remaining).toBe(5);
  });

  it('chặn tạo voice và ném ForbiddenException khi đã hết 8 lượt', async () => {
    const { service } = buildService({
      quotaRecord: {
        user_id: 'user-1',
        date: '2026-08-28',
        default_limit: 8,
        used_count: 8,
        granted_extra: 0,
      },
    });

    jest.spyOn(service, 'getTodayVnString').mockReturnValue('2026-08-28');

    await expect(service.checkAndConsumeQuota('user-1')).rejects.toThrow(ForbiddenException);
    await expect(service.checkAndConsumeQuota('user-1')).rejects.toThrow(
      /Bạn đã sử dụng hết hạn mức tạo voice hôm nay \(8 lượt\)/,
    );
  });

  it('Admin cấp thêm 5 lượt thành công (tối đa không quá 8 lượt)', async () => {
    const { service } = buildService({
      quotaRecord: {
        user_id: 'user-1',
        date: '2026-08-28',
        default_limit: 8,
        used_count: 8,
        granted_extra: 0,
      },
    });

    jest.spyOn(service, 'getTodayVnString').mockReturnValue('2026-08-28');

    const updated = await service.grantExtraQuota('user-1', 5, 'admin-1');
    expect(updated.granted_extra).toBe(5);
    expect(updated.total_allowed).toBe(13);
    expect(updated.remaining).toBe(5);

    // Sau khi cấp, user tạo tiếp được
    const nextConsume = await service.checkAndConsumeQuota('user-1');
    expect(nextConsume.used_count).toBe(9);
    expect(nextConsume.remaining).toBe(4);
  });

  it('báo lỗi BadRequestException khi Admin cố cấp quá 8 lượt hoặc số âm', async () => {
    const { service } = buildService();

    await expect(service.grantExtraQuota('user-1', 9, 'admin-1')).rejects.toThrow(BadRequestException);
    await expect(service.grantExtraQuota('user-1', 0, 'admin-1')).rejects.toThrow(BadRequestException);
    await expect(service.grantExtraQuota('user-1', -1, 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('báo lỗi khi người dùng được cấp không tồn tại', async () => {
    const { service } = buildService({ targetUser: null });

    await expect(service.grantExtraQuota('non-existent-user', 3, 'admin-1')).rejects.toThrow(BadRequestException);
  });
});

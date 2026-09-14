import { Test, TestingModule } from '@nestjs/testing';
import { VoiceQuotaService } from '../voice-quota.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

describe('VoiceQuotaService', () => {
  let service: VoiceQuotaService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      userDailyVoiceQuota: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceQuotaService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<VoiceQuotaService>(VoiceQuotaService);
  });

  describe('getQuota', () => {
    it('returns default quota if no userId is provided', async () => {
      const quota = await service.getQuota();
      expect(quota.default_limit).toBe(8);
      expect(quota.remaining).toBe(8);
      expect(quota.used_count).toBe(0);
    });

    it('returns user quota from database record', async () => {
      mockPrisma.userDailyVoiceQuota.findUnique.mockResolvedValue({
        default_limit: 8,
        used_count: 3,
        granted_extra: 2,
      });

      const quota = await service.getQuota('user-123');
      expect(quota.default_limit).toBe(8);
      expect(quota.total_allowed).toBe(10);
      expect(quota.used_count).toBe(3);
      expect(quota.remaining).toBe(7);
    });
  });

  describe('refundQuota', () => {
    it('decrements used_count when task fails and used_count > 0', async () => {
      mockPrisma.userDailyVoiceQuota.updateMany.mockResolvedValue({ count: 1 });

      await service.refundQuota('user-123');

      expect(mockPrisma.userDailyVoiceQuota.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: 'user-123',
            used_count: { gt: 0 },
          }),
          data: {
            used_count: { decrement: 1 },
          },
        }),
      );
    });

    it('does nothing if userId is empty', async () => {
      await service.refundQuota('');
      expect(mockPrisma.userDailyVoiceQuota.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('checkAndConsumeQuota', () => {
    it('throws ForbiddenException if remaining quota is 0', async () => {
      mockPrisma.userDailyVoiceQuota.findUnique.mockResolvedValue({
        default_limit: 8,
        used_count: 8,
        granted_extra: 0,
      });

      await expect(service.checkAndConsumeQuota('user-123')).rejects.toThrow();
    });

    it('increments used_count if quota is available', async () => {
      mockPrisma.userDailyVoiceQuota.findUnique.mockResolvedValue({
        default_limit: 8,
        used_count: 2,
        granted_extra: 0,
      });
      mockPrisma.userDailyVoiceQuota.upsert.mockResolvedValue({
        default_limit: 8,
        used_count: 3,
        granted_extra: 0,
      });

      const res = await service.checkAndConsumeQuota('user-123');
      expect(res.used_count).toBe(3);
      expect(res.remaining).toBe(5);
    });
  });
});

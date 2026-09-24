import { HttpException, HttpStatus } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { InstagramOwnedAccountsController } from '../src/modules/instagram-owned-accounts/instagram-owned-accounts.controller';
import { InstagramOwnedAccountsService } from '../src/modules/instagram-owned-accounts/instagram-owned-accounts.service';
import { ThreadsOwnedAccountsController } from '../src/modules/threads-owned-accounts/threads-owned-accounts.controller';
import { ThreadsOwnedAccountsService } from '../src/modules/threads-owned-accounts/threads-owned-accounts.service';

/**
 * Chức năng: Cơ chế đồng bộ bất đồng bộ (Non-blocking Async Sync) cho kênh nội bộ Instagram và Threads.
 *
 * Lý do cần file test riêng:
 * - Khi có nhiều tài khoản kết nối, việc duyệt toàn bộ kênh và gọi Graph API lấy bài viết + insight lượt xem
 *   mất vài phút. Request HTTP đồng bộ sẽ bị Nginx reverse proxy ngắt kết nối với mã lỗi 502 Bad Gateway sau 60s.
 * - Test này đảm bảo:
 *   1. syncAll() trả về ngay lập tức (non-blocking) phản hồi 200 OK với status 'processing'.
 *   2. Chặn kích hoạt trùng lặp khi một tiến trình đồng bộ ngầm đang chạy (already_running).
 *   3. Cung cấp API getSyncStatus() để theo dõi tiến độ.
 *   4. syncSingleProfileByUsername() cho phép đồng bộ nhanh 1 kênh cụ thể qua Meta Graph API bằng token chính chủ.
 */
describe('Đồng bộ kênh nội bộ bất đồng bộ (Async Non-blocking Sync)', () => {
  describe('InstagramOwnedAccountsService', () => {
    let service: InstagramOwnedAccountsService;
    let mockPrisma: any;
    let mockCrypto: any;

    beforeEach(() => {
      mockPrisma = {
        socialAccount: {
          count: jest.fn().mockResolvedValue(59),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
        scraperInstagramProfile: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({ id: BigInt(101) }),
        },
        scraperInstagramReel: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      mockCrypto = {
        decrypt: jest.fn().mockReturnValue('mock-access-token'),
      };
      service = new InstagramOwnedAccountsService(mockPrisma, mockCrypto);
    });

    it('triggerAsyncSyncAll trả về phản hồi tức thì với status processing', async () => {
      const result = await service.triggerAsyncSyncAll();

      expect(result.status).toBe('processing');
      expect(result.accounts).toBe(59);
      expect(result.message).toContain('Đã bắt đầu đồng bộ');
      expect(mockPrisma.socialAccount.count).toHaveBeenCalledWith({
        where: { platform: SocialPlatform.INSTAGRAM, is_active: true },
      });
    });

    it('triggerAsyncSyncAll chặn kích hoạt trùng lặp khi đang có tiến trình đồng bộ chạy', async () => {
      // Giả lập đang chạy
      (service as any).isSyncing = true;
      (service as any).syncProgress = { current: 10, total: 59 };

      const result = await service.triggerAsyncSyncAll();

      expect(result.status).toBe('already_running');
      expect(result.accounts).toBe(59);
      expect(result.message).toContain('đang chạy trong nền');
    });

    it('getSyncStatus trả về trạng thái tiến độ đồng bộ hiện tại', () => {
      (service as any).isSyncing = true;
      (service as any).syncProgress = { current: 25, total: 59 };

      const status = service.getSyncStatus();

      expect(status.is_syncing).toBe(true);
      expect(status.progress).toEqual({ current: 25, total: 59 });
    });

    it('syncSingleProfileByUsername trả về null nếu username không có trong SocialAccount kết nối', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue(null);

      const result = await service.syncSingleProfileByUsername('kenh_chua_ket_noi');

      expect(result).toBeNull();
    });

    it('syncSingleProfileByUsername đồng bộ kênh qua Graph API khi tìm thấy tài khoản kết nối', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'sa-1',
        username: 'ghuyk.jeweler',
        platform_id: 'ig-12345',
        access_token_enc: 'enc_token',
        extra_data: { igUserId: 'ig-12345', type: 'instagram_business' },
      });

      jest.spyOn(service, 'fetchUserProfile').mockResolvedValue({
        id: 'ig-12345',
        username: 'ghuyk.jeweler',
        name: 'GHUYK Jeweler',
      });
      jest.spyOn(service, 'upsertProfile').mockResolvedValue({
        id: BigInt(77),
        created: false,
      });
      jest.spyOn(service, 'syncProfileMedia').mockResolvedValue(15);

      const result = await service.syncSingleProfileByUsername('ghuyk.jeweler');

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.profile_id).toBe(77);
      expect(result?.synced_media).toBe(15);
      expect(result?.message).toContain('qua Meta Graph API');
      expect(mockPrisma.scraperInstagramProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BigInt(77) },
          data: expect.objectContaining({ scraping_status: 'idle', is_initial_scraped: true }),
        }),
      );
    });
  });

  describe('InstagramOwnedAccountsController', () => {
    let controller: InstagramOwnedAccountsController;
    let mockService: any;

    beforeEach(() => {
      mockService = {
        getOwnedProfiles: jest.fn().mockResolvedValue([]),
        triggerAsyncSyncAll: jest.fn().mockResolvedValue({
          status: 'processing',
          message: 'Đã bắt đầu đồng bộ 59 kênh Instagram trong nền...',
          accounts: 59,
        }),
        getSyncStatus: jest.fn().mockReturnValue({ is_syncing: false, progress: { current: 59, total: 59 } }),
        syncSingleProfileByUsername: jest.fn(),
      };
      controller = new InstagramOwnedAccountsController(mockService);
    });

    it('POST /sync gọi triggerAsyncSyncAll và trả về phản hồi không bị block', async () => {
      const res = await controller.syncAll();
      expect(mockService.triggerAsyncSyncAll).toHaveBeenCalled();
      expect(res.status).toBe('processing');
    });

    it('GET /sync/status trả về kết quả từ service.getSyncStatus', async () => {
      const res = await controller.getSyncStatus();
      expect(mockService.getSyncStatus).toHaveBeenCalled();
      expect(res.is_syncing).toBe(false);
    });

    it('POST /sync-profile/:username ném 404 nếu không tìm thấy tài khoản', async () => {
      mockService.syncSingleProfileByUsername.mockResolvedValue(null);

      await expect(controller.syncSingleProfile('unknown')).rejects.toThrow(HttpException);
    });

    it('POST /sync-profile/:username trả về kết quả thành công khi tìm thấy tài khoản', async () => {
      mockService.syncSingleProfileByUsername.mockResolvedValue({
        success: true,
        message: 'Đã cập nhật',
        profile_id: 1,
      });

      const res = await controller.syncSingleProfile('ghuyk.jeweler');
      expect(res.success).toBe(true);
      expect(res.profile_id).toBe(1);
    });
  });

  describe('ThreadsOwnedAccountsController & Service', () => {
    let controller: ThreadsOwnedAccountsController;
    let mockService: any;

    beforeEach(() => {
      mockService = {
        getOwnedProfiles: jest.fn().mockResolvedValue([]),
        triggerAsyncSyncAll: jest.fn().mockResolvedValue({
          status: 'processing',
          message: 'Đã bắt đầu đồng bộ các kênh Threads trong nền...',
          accounts: 10,
        }),
        getSyncStatus: jest.fn().mockReturnValue({ is_syncing: false }),
        syncSingleProfileByUsername: jest.fn(),
        toggleOwned: jest.fn(),
      };
      controller = new ThreadsOwnedAccountsController(mockService);
    });

    it('POST /sync của Threads gọi triggerAsyncSyncAll dạng non-blocking', async () => {
      const res = await controller.syncAll();
      expect(mockService.triggerAsyncSyncAll).toHaveBeenCalled();
      expect(res.status).toBe('processing');
    });

    it('POST /sync-profile/:username ném 404 khi không tìm thấy tài khoản', async () => {
      mockService.syncSingleProfileByUsername.mockResolvedValue(null);
      await expect(controller.syncSingleProfile('unknown_threads')).rejects.toThrow(HttpException);
    });
  });
});

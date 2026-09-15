import { InstagramScraperService } from '../src/modules/instagram-scraper/instagram-scraper.service';
import { InstagramScraperController } from '../src/modules/instagram-scraper/instagram-scraper.controller';
import { InstagramScraperReadService } from '../src/modules/instagram-scraper/instagram-scraper-read.service';
import { TiktokScraperService } from '../src/modules/tiktok-scraper/tiktok-scraper.service';

describe('Channel Bookmark Author & Timestamp Tracking', () => {
  describe('InstagramScraperService.toggleProfile', () => {
    it('khi bật lưu (is_bookmarked = true), phải ghi nhận bookmarked_by_id, bookmarked_by_name và bookmarked_at', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperInstagramProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: 10n,
            is_bookmarked: false,
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return updatedData;
          }),
        },
      };

      const service = new InstagramScraperService(prismaMock, {} as any);
      const user = { id: 'uuid-user-123', full_name: 'Thoa Trần', email: 'thoa@vcbi.com' };
      const res = await service.toggleProfile(10n, 'is_bookmarked', user);

      expect(res).toBe(true);
      expect(updatedData.is_bookmarked).toBe(true);
      expect(updatedData.bookmarked_by_id).toBe('uuid-user-123');
      expect(updatedData.bookmarked_by_name).toBe('Thoa Trần');
      expect(updatedData.bookmarked_at).toBeInstanceOf(Date);
    });

    it('khi bỏ lưu (is_bookmarked = false), phải đặt bookmarked_by_id, bookmarked_by_name và bookmarked_at về null', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperInstagramProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: 10n,
            is_bookmarked: true,
            bookmarked_by_name: 'Thoa Trần',
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return updatedData;
          }),
        },
      };

      const service = new InstagramScraperService(prismaMock, {} as any);
      const user = { id: 'uuid-user-123', full_name: 'Thoa Trần', email: 'thoa@vcbi.com' };
      const res = await service.toggleProfile(10n, 'is_bookmarked', user);

      expect(res).toBe(false);
      expect(updatedData.is_bookmarked).toBe(false);
      expect(updatedData.bookmarked_by_id).toBeNull();
      expect(updatedData.bookmarked_by_name).toBeNull();
      expect(updatedData.bookmarked_at).toBeNull();
    });

    it('nếu user không có full_name, fallback sang email', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperInstagramProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: 10n,
            is_bookmarked: false,
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return updatedData;
          }),
        },
      };

      const service = new InstagramScraperService(prismaMock, {} as any);
      const user = { id: 'uuid-user-456', full_name: '', email: 'editor@vcbi.com' };
      await service.toggleProfile(10n, 'is_bookmarked', user);

      expect(updatedData.bookmarked_by_name).toBe('editor@vcbi.com');
    });
  });

  describe('InstagramScraperController.toggle', () => {
    it('truyền đúng req.user vào toggleProfile', async () => {
      const serviceMock: any = {
        toggleProfile: jest.fn().mockResolvedValue(true),
      };
      const controller = new InstagramScraperController(serviceMock, {} as any);

      const req = {
        user: { id: 'uuid-789', full_name: 'Admin User', email: 'admin@vcbi.com' },
      };

      const result = await controller.toggle('15', { field: 'is_bookmarked' }, req);

      expect(result).toEqual({ status: 'ok', is_bookmarked: true });
      expect(serviceMock.toggleProfile).toHaveBeenCalledWith(15n, 'is_bookmarked', req.user);
    });
  });

  describe('TikTokScraperService.toggleProfile', () => {
    it('TikTok cũng ghi nhận bookmarked_by_name khi toggle is_bookmarked', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperTikTokProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: 20n,
            is_bookmarked: false,
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return updatedData;
          }),
        },
      };

      const service = new TiktokScraperService(prismaMock, {} as any, {} as any, {} as any);
      const user = { id: 'uuid-tiktok-1', full_name: 'Nguyễn Văn A' };
      const res = await service.toggleProfile(20n, 'is_bookmarked', user);

      expect(res).toBe(true);
      expect(updatedData.is_bookmarked).toBe(true);
      expect(updatedData.bookmarked_by_id).toBe('uuid-tiktok-1');
      expect(updatedData.bookmarked_by_name).toBe('Nguyễn Văn A');
      expect(updatedData.bookmarked_at).toBeInstanceOf(Date);
    });
  });

  describe('InstagramScraperReadService.listProfiles', () => {
    it('trả về đúng bookmarked_by_name và bookmarked_at trong danh sách profile', async () => {
      const now = new Date();
      const prismaMock: any = {
        scraperInstagramProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 10n,
              username: 'thoa.tran.gems.and.pearl',
              url: 'https://instagram.com/thoa.tran.gems.and.pearl/',
              avatar_drive_url: null,
              avatar_url: null,
              is_verified: false,
              followers_count: 5000n,
              following_count: 100n,
              posts_count: 50,
              is_tracked: false,
              is_bookmarked: true,
              bookmarked_by_name: 'Thoa Trần',
              bookmarked_at: now,
              is_owned: false,
              is_initial_scraped: true,
              scraping_status: 'completed',
              scrape_error: null,
              channel_type: 'product',
              product_lines: ['vang'],
              last_scraped_at: now,
              created_at: now,
            },
          ]),
        },
        scraperInstagramReel: {
          groupBy: jest.fn().mockResolvedValue([{ profile_id: 10n, _count: { id: 50 } }]),
        },
      };

      const readService = new InstagramScraperReadService(prismaMock);
      const res = await readService.listProfiles({});

      expect(res.profiles).toHaveLength(1);
      expect(res.profiles[0].is_bookmarked).toBe(true);
      expect(res.profiles[0].bookmarked_by_name).toBe('Thoa Trần');
      expect(res.profiles[0].bookmarked_at).toEqual(now);
    });
  });
});

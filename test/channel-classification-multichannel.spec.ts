import { TiktokScraperService } from '../src/modules/tiktok-scraper/tiktok-scraper.service';
import { TiktokScraperReadService } from '../src/modules/tiktok-scraper/tiktok-scraper-read.service';
import { InstagramScraperService } from '../src/modules/instagram-scraper/instagram-scraper.service';
import { InstagramScraperReadService } from '../src/modules/instagram-scraper/instagram-scraper-read.service';
import { YoutubeScraperService } from '../src/modules/youtube-scraper/youtube-scraper.service';
import { DouyinScraperService } from '../src/modules/douyin-scraper/douyin-scraper.service';
import { DouyinScraperReadService } from '../src/modules/douyin-scraper/douyin-scraper-read.service';
import { XiaohongshuScraperService } from '../src/modules/xiaohongshu-scraper/xiaohongshu-scraper.service';
import { XiaohongshuScraperReadService } from '../src/modules/xiaohongshu-scraper/xiaohongshu-scraper-read.service';
import { KuaishouScraperService } from '../src/modules/kuaishou-scraper/kuaishou-scraper.service';
import { KuaishouScraperReadService } from '../src/modules/kuaishou-scraper/kuaishou-scraper-read.service';
import { BilibiliScraperService } from '../src/modules/bilibili-scraper/bilibili-scraper.service';
import { BilibiliScraperReadService } from '../src/modules/bilibili-scraper/bilibili-scraper-read.service';

describe('Multi-Platform Channel Classification & Filtering', () => {
  describe('TikTok Scraper Classification', () => {
    it('updateClassification cập nhật thành công channel_type và product_lines cho profile', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperTikTokProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new TiktokScraperService(prismaMock, {} as any, {} as any, {} as any);
      const res = await service.updateClassification(123n, 'content', ['vang', 'da_quy']);

      expect(res.channel_type).toBe('content');
      expect(res.product_lines).toEqual(['vang', 'da_quy']);
      expect(updatedData.channel_type).toBe('content');
      expect(updatedData.product_lines).toEqual(['vang', 'da_quy']);
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperTikTokProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 123n,
                username: 'tiktok_channel',
                channel_type: 'content',
                product_lines: ['vang'],
                followers_count: 1000n,
                heart_count: 5000n,
                video_count: 50,
                is_tracked: true,
                is_bookmarked: false,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperTikTokProfileVideo: {
          groupBy: jest.fn().mockResolvedValue([{ profile_id: 123n, _count: { id: 10 } }]),
        },
      };

      const readService = new TiktokScraperReadService(prismaMock);
      const res = await readService.listProfiles({
        channel_type: 'content',
        product_line: 'vang',
      });

      expect(capturedWhere.channel_type).toBe('content');
      expect(capturedWhere.product_lines).toEqual({ has: 'vang' });
      expect(res.profiles[0].channel_type).toBe('content');
      expect(res.profiles[0].product_lines).toEqual(['vang']);
    });
  });

  describe('Instagram Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperInstagramProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new InstagramScraperService(prismaMock, {} as any);
      const res = await service.updateClassification(456n, 'product', ['kim_cuong']);

      expect(res.channel_type).toBe('product');
      expect(res.product_lines).toEqual(['kim_cuong']);
      expect(updatedData.channel_type).toBe('product');
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperInstagramProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 456n,
                username: 'insta_channel',
                channel_type: 'product',
                product_lines: ['kim_cuong'],
                followers_count: 2000n,
                following_count: 100n,
                posts_count: 30,
                is_tracked: true,
                is_bookmarked: false,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperInstagramReel: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
      };

      const readService = new InstagramScraperReadService(prismaMock);
      await readService.listProfiles({
        channel_type: 'product',
        product_line: 'kim_cuong',
      });

      expect(capturedWhere.channel_type).toBe('product');
      expect(capturedWhere.product_lines).toEqual({ has: 'kim_cuong' });
    });

    it('listReels lọc đúng theo is_owned', async () => {
      let capturedQueries: any[] = [];
      const prismaMock: any = {
        $queryRaw: jest.fn().mockImplementation((queryParts: any) => {
          capturedQueries.push(queryParts);
          // Return count first, then reels
          if (capturedQueries.length === 1) {
            return [{ total: 1n }];
          }
          return [
            {
              post_id: '123',
              shortcode: 'abc',
              url: 'https://insta.com/reel/abc',
              description: 'test reel',
              hashtags: [],
              thumbnail_url: null,
              thumbnail_drive_url: null,
              duration_seconds: 15,
              is_paid_partnership: false,
              play_count: 1000n,
              likes_count: 50n,
              comments_count: 5n,
              date_posted: new Date(),
              profile_id: 456n,
              profile_username: 'insta_channel',
              profile_avatar_url: null,
              profile_avatar_drive_url: null,
            },
          ];
        }),
      };

      const readService = new InstagramScraperReadService(prismaMock);
      const res = await readService.listReels({
        is_owned: 'false',
        sort: 'scraped',
      });

      expect(res.status).toBe('ok');
      expect(res.reels.length).toBe(1);
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('YouTube Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperYoutubeProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new YoutubeScraperService(prismaMock, {} as any, {} as any);
      const res = await service.updateClassification(789n, 'content', ['che_tac']);

      expect(res.channel_type).toBe('content');
      expect(res.product_lines).toEqual(['che_tac']);
      expect(updatedData.product_lines).toEqual(['che_tac']);
    });
  });

  describe('Douyin Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperDouyinProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new DouyinScraperService(prismaMock, {} as any, {} as any, {} as any, {} as any);
      const res = await service.updateClassification(101n, 'product', ['bac']);

      expect(res.channel_type).toBe('product');
      expect(res.product_lines).toEqual(['bac']);
      expect(updatedData.channel_type).toBe('product');
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperDouyinProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 101n,
                sec_uid: 'sec123',
                nickname: 'douyin_channel',
                channel_type: 'product',
                product_lines: ['bac'],
                follower_count: 5000n,
                total_favorited: 10000n,
                aweme_count: 80,
                is_tracked: false,
                is_bookmarked: true,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperDouyinVideo: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
      };

      const readService = new DouyinScraperReadService(prismaMock);
      await readService.listProfiles({
        channel_type: 'product',
        product_line: 'bac',
      });

      expect(capturedWhere.channel_type).toBe('product');
      expect(capturedWhere.product_lines).toEqual({ has: 'bac' });
    });
  });

  describe('XiaoHongShu Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperXiaohongshuProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new XiaohongshuScraperService(prismaMock, {} as any, {} as any, {} as any);
      const res = await service.updateClassification(202n, 'content', ['moissanite']);

      expect(res.channel_type).toBe('content');
      expect(res.product_lines).toEqual(['moissanite']);
      expect(updatedData.product_lines).toEqual(['moissanite']);
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperXiaohongshuProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 202n,
                user_id: 'xhs123',
                nickname: 'xhs_creator',
                channel_type: 'content',
                product_lines: ['moissanite'],
                fans_count: 3000n,
                follows_count: 50n,
                notes_count: 20,
                is_tracked: true,
                is_bookmarked: false,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperXiaohongshuVideo: {
          count: jest.fn().mockResolvedValue(5),
        },
      };

      const readService = new XiaohongshuScraperReadService(prismaMock);
      await readService.listProfiles({
        channel_type: 'content',
        product_line: 'moissanite',
      });

      expect(capturedWhere.channel_type).toBe('content');
      expect(capturedWhere.product_lines).toEqual({ has: 'moissanite' });
    });
  });

  describe('KuaiShou Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperKuaishouProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new KuaishouScraperService(prismaMock, {} as any, {} as any, {} as any, {} as any);
      const res = await service.updateClassification(303n, 'product', ['vang', 'bac']);

      expect(res.channel_type).toBe('product');
      expect(res.product_lines).toEqual(['vang', 'bac']);
      expect(updatedData.channel_type).toBe('product');
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperKuaishouProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 303n,
                eid: 'ks123',
                nickname: 'ks_creator',
                channel_type: 'product',
                product_lines: ['vang', 'bac'],
                followers_count: 7000n,
                following_count: 20n,
                videos_count: 15,
                is_tracked: false,
                is_bookmarked: false,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperKuaishouVideo: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
      };

      const readService = new KuaishouScraperReadService(prismaMock);
      await readService.listProfiles({
        channel_type: 'product',
        product_line: 'vang',
      });

      expect(capturedWhere.channel_type).toBe('product');
      expect(capturedWhere.product_lines).toEqual({ has: 'vang' });
    });
  });

  describe('Bilibili Scraper Classification', () => {
    it('updateClassification cập nhật thành công', async () => {
      let updatedData: any = null;
      const prismaMock: any = {
        scraperBilibiliProfile: {
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            updatedData = { id: where.id, ...data };
            return {
              id: where.id,
              channel_type: data.channel_type,
              product_lines: data.product_lines,
            };
          }),
        },
      };

      const service = new BilibiliScraperService(prismaMock, {} as any, {} as any, {} as any, {} as any);
      const res = await service.updateClassification(404n, 'content', ['che_tac']);

      expect(res.channel_type).toBe('content');
      expect(res.product_lines).toEqual(['che_tac']);
      expect(updatedData.channel_type).toBe('content');
    });

    it('listProfiles lọc đúng theo channel_type và product_line', async () => {
      let capturedWhere: any = null;
      const prismaMock: any = {
        scraperBilibiliProfile: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockImplementation(({ where }: any) => {
            capturedWhere = where;
            return [
              {
                id: 404n,
                mid: 'bili123',
                nickname: 'bili_creator',
                channel_type: 'content',
                product_lines: ['che_tac'],
                followers_count: 9000n,
                following_count: 10n,
                likes_count: 20000n,
                videos_count: 40,
                is_tracked: true,
                is_bookmarked: true,
                is_initial_scraped: true,
                created_at: new Date(),
              },
            ];
          }),
        },
        scraperBilibiliVideo: {
          groupBy: jest.fn().mockResolvedValue([]),
        },
      };

      const readService = new BilibiliScraperReadService(prismaMock);
      await readService.listProfiles({
        channel_type: 'content',
        product_line: 'che_tac',
      });

      expect(capturedWhere.channel_type).toBe('content');
      expect(capturedWhere.product_lines).toEqual({ has: 'che_tac' });
    });
  });
});

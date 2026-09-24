import { HttpException, HttpStatus } from '@nestjs/common';
import { DouyinScraperController } from '../src/modules/douyin-scraper/douyin-scraper.controller';
import { DouyinScraperService } from '../src/modules/douyin-scraper/douyin-scraper.service';

describe('Douyin Scraper URL Resolution & Error Resilience', () => {
  let controller: DouyinScraperController;
  let serviceMock: any;
  let readServiceMock: any;
  let aiClientMock: any;

  beforeEach(() => {
    serviceMock = {
      scrapeProfile: jest.fn(),
      periodicRefresh: jest.fn(),
      searchKeyword: jest.fn(),
    };
    readServiceMock = {
      listVideos: jest.fn(),
      keywordSuggest: jest.fn(),
      listProfiles: jest.fn(),
      profileDetail: jest.fn(),
      profileVideos: jest.fn(),
      lookalikes: jest.fn(),
    };
    aiClientMock = {
      fetchSearch: jest.fn(),
      fetchProfileVideos: jest.fn(),
      resolveVideoAuthor: jest.fn(),
    };

    controller = new DouyinScraperController(
      serviceMock as unknown as DouyinScraperService,
      readServiceMock,
      aiClientMock,
    );
  });

  describe('profileScrape URL Parsing & sec_user_id Resolution', () => {
    it('1. Bóc chuẩn khi input đã là sec_user_id trần (MS4wLjAB...)', async () => {
      const validSecUid = 'MS4wLjABAAAAkaQz6JIeOxhYro3BZCAuNcyRLCFCRxPU_TgGXCvfyaU';
      serviceMock.scrapeProfile.mockResolvedValue({ status: 'ok', profile_id: 1 });

      await controller.profileScrape({ sec_user_id: validSecUid });

      expect(serviceMock.scrapeProfile).toHaveBeenCalledWith(validSecUid, undefined, 50);
    });

    it('2. Bóc chuẩn từ URL profile có query params', async () => {
      const validSecUid = 'MS4wLjABAAAAkaQz6JIeOxhYro3BZCAuNcyRLCFCRxPU_TgGXCvfyaU';
      const fullUrl = `https://www.douyin.com/user/${validSecUid}?from_tab_name=main&sec_uid=foo`;
      serviceMock.scrapeProfile.mockResolvedValue({ status: 'ok', profile_id: 1 });

      await controller.profileScrape({ sec_user_id: fullUrl });

      expect(serviceMock.scrapeProfile).toHaveBeenCalledWith(validSecUid, undefined, 50);
    });

    it('3. Bóc chuẩn khi dán đoạn text tiếng Trung từ mobile clipboard', async () => {
      const validSecUid = 'MS4wLjABAAAAkaQz6JIeOxhYro3BZCAuNcyRLCFCRxPU_TgGXCvfyaU';
      const clipboard = `7.12 04/28 复制打开抖音，看看【VCBI的作品】 https://www.douyin.com/user/${validSecUid} 10/24 Q@d.Ns :0pm`;
      serviceMock.scrapeProfile.mockResolvedValue({ status: 'ok', profile_id: 1 });

      await controller.profileScrape({ sec_user_id: clipboard });

      expect(serviceMock.scrapeProfile).toHaveBeenCalledWith(validSecUid, undefined, 50);
    });

    it('4. Tự động tìm tác giả khi dán link video Douyin', async () => {
      const videoUrl = 'https://www.douyin.com/video/7674192769753359759?mode=share';
      const resolvedAuthorSecUid = 'MS4wLjABAAAAkaQz6JIeOxhYro3BZCAuNcyRLCFCRxPU_TgGXCvfyaU';
      aiClientMock.resolveVideoAuthor.mockResolvedValue(resolvedAuthorSecUid);
      serviceMock.scrapeProfile.mockResolvedValue({ status: 'ok', profile_id: 1 });

      await controller.profileScrape({ sec_user_id: videoUrl });

      expect(aiClientMock.resolveVideoAuthor).toHaveBeenCalledWith('7674192769753359759');
      expect(serviceMock.scrapeProfile).toHaveBeenCalledWith(resolvedAuthorSecUid, undefined, 50);
    });

    it('5. Link rút gọn v.douyin.com hết hạn trỏ về trang chủ douyin.com -> Báo lỗi 400 thân thiện, không gửi DB', async () => {
      const expiredShortLink = 'https://v.douyin.com/BZdN8kxKBJM/';

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        url: 'https://www.douyin.com',
      } as any);

      try {
        await expect(controller.profileScrape({ sec_user_id: expiredShortLink })).rejects.toThrow(HttpException);

        expect(serviceMock.scrapeProfile).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('6. Chặn URL rác hoặc chuỗi không chứa MS4wLjAB hợp lệ, không để lọt vào DB gây lỗi varchar(255)', async () => {
      const garbage = 'https://www.google.com/some/random/path/that/is/not/douyin';

      await expect(controller.profileScrape({ sec_user_id: garbage })).rejects.toThrow(HttpException);

      expect(serviceMock.scrapeProfile).not.toHaveBeenCalled();
    });
  });

  describe('service.scrapeProfile error resilience', () => {
    it('Bắt lỗi AI/TikHub trong scrapeProfile, xoá profile rỗng và ném lỗi rõ ràng thay vì 500 unhandled', async () => {
      const prismaMock = {
        scraperDouyinProfile: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 100n, sec_user_id: 'MS4wLjAB_valid' }),
          update: jest.fn(),
          delete: jest.fn().mockResolvedValue({ id: 100n }),
        },
      };

      const realService = new DouyinScraperService(
        prismaMock as any,
        aiClientMock as any,
        { broadcastToActiveUsers: jest.fn() } as any,
        readServiceMock as any,
        { generateCompetitorAnalysis: jest.fn() } as any,
      );

      // Giả lập AI service bị lỗi timeout / tikhub error
      aiClientMock.fetchProfileVideos.mockRejectedValue(new Error('TikHub Douyin timeout'));

      await expect(realService.scrapeProfile('MS4wLjAB_valid', false, 20)).rejects.toThrow(HttpException);

      // Đã dọn dẹp profile rác khi cào thất bại
      expect(prismaMock.scraperDouyinProfile.delete).toHaveBeenCalledWith({ where: { id: 100n } });
    });
  });
});

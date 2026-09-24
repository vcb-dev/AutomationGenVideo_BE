import { HttpException, HttpStatus } from '@nestjs/common';
import {
  extractDouyinSecUserId,
  extractXiaohongshuUserId,
  extractKuaishouEid,
  extractThreadsUsername,
} from '../src/common/utils/channel-url.util';
import { DouyinScraperController } from '../src/modules/douyin-scraper/douyin-scraper.controller';
import { XiaohongshuScraperController } from '../src/modules/xiaohongshu-scraper/xiaohongshu-scraper.controller';
import { KuaishouScraperController } from '../src/modules/kuaishou-scraper/kuaishou-scraper.controller';

describe('Channel URL Extractors & Scraper Controllers', () => {
  describe('extractDouyinSecUserId', () => {
    const SAMPLE_SEC_UID = 'MS4wLjABAAAAMYg6MdsvSmtAFtlO9X15pwjLzWohECbGeCwCpjh15k_aPv6p00za_GYHeAwMGCAB';

    it('bóc tách đúng từ link web PC douyin.com/user/<id>', () => {
      const url = `https://www.douyin.com/user/${SAMPLE_SEC_UID}`;
      expect(extractDouyinSecUserId(url)).toBe(SAMPLE_SEC_UID);
    });

    it('bóc tách đúng từ link share mobile iesdouyin.com/share/user/<id> kèm query params', () => {
      const url = `https://www.iesdouyin.com/share/user/${SAMPLE_SEC_UID}?u_code=3414fccbg2ae&did=123&sec_uid=${SAMPLE_SEC_UID}&from_ssr=1`;
      expect(extractDouyinSecUserId(url)).toBe(SAMPLE_SEC_UID);
    });

    it('bóc tách đúng từ query param sec_uid khi URL không có path /user/', () => {
      const url = `https://www.douyin.com/other/path?sec_uid=${SAMPLE_SEC_UID}`;
      expect(extractDouyinSecUserId(url)).toBe(SAMPLE_SEC_UID);
    });

    it('chấp nhận sec_user_id thuần', () => {
      expect(extractDouyinSecUserId(SAMPLE_SEC_UID)).toBe(SAMPLE_SEC_UID);
    });

    it('từ chối link video Douyin (/video/<id>)', () => {
      const videoUrl = 'https://www.douyin.com/video/7382193821938123456';
      expect(extractDouyinSecUserId(videoUrl)).toBeNull();
    });

    it('từ chối chuỗi rỗng hoặc URL không hợp lệ', () => {
      expect(extractDouyinSecUserId('')).toBeNull();
      expect(extractDouyinSecUserId('https://google.com')).toBeNull();
    });
  });

  describe('extractXiaohongshuUserId', () => {
    const SAMPLE_XHS_ID = '5b863d08e8cd0300018f8888';

    it('bóc tách đúng từ URL profile web xiaohongshu.com/user/profile/<hex>', () => {
      const url = `https://www.xiaohongshu.com/user/profile/${SAMPLE_XHS_ID}?xsec_token=12345`;
      expect(extractXiaohongshuUserId(url)).toBe(SAMPLE_XHS_ID);
    });

    it('chấp nhận user_id thuần 24 ký tự hex', () => {
      expect(extractXiaohongshuUserId(SAMPLE_XHS_ID)).toBe(SAMPLE_XHS_ID);
    });

    it('từ chối link bài viết / explore của Xiaohongshu', () => {
      const noteUrl = 'https://www.xiaohongshu.com/explore/6620f4c3000000000d021234';
      expect(extractXiaohongshuUserId(noteUrl)).toBeNull();
    });

    it('từ chối chuỗi không phải hex hoặc không đủ 24 ký tự', () => {
      expect(extractXiaohongshuUserId('not-hex-id-123')).toBeNull();
      expect(extractXiaohongshuUserId('5b863d08e8cd03')).toBeNull();
    });
  });

  describe('extractKuaishouEid', () => {
    const SAMPLE_EID = '3xabcdef12345678';

    it('bóc tách đúng từ URL profile kuaishou.com/profile/<eid>', () => {
      const url = `https://www.kuaishou.com/profile/${SAMPLE_EID}?sub=1`;
      expect(extractKuaishouEid(url)).toBe(SAMPLE_EID);
    });

    it('chấp nhận eid thuần', () => {
      expect(extractKuaishouEid(SAMPLE_EID)).toBe(SAMPLE_EID);
    });

    it('từ chối link video ngắn kuaishou (/short-video/<id>)', () => {
      const videoUrl = `https://www.kuaishou.com/short-video/${SAMPLE_EID}`;
      expect(extractKuaishouEid(videoUrl)).toBeNull();
    });
  });

  describe('extractThreadsUsername', () => {
    it('bóc tách đúng từ link threads.net/@username', () => {
      expect(extractThreadsUsername('https://www.threads.net/@zuck')).toBe('zuck');
    });

    it('bóc tách đúng từ link threads.net/username không có @', () => {
      expect(extractThreadsUsername('https://threads.net/zuck?hl=vi')).toBe('zuck');
    });

    it('bóc tách đúng từ handle có @', () => {
      expect(extractThreadsUsername('@zuck_official.1')).toBe('zuck_official.1');
    });

    it('chấp nhận username thuần hợp lệ', () => {
      expect(extractThreadsUsername('zuck')).toBe('zuck');
    });

    it('từ chối URL bài viết Threads (/post/ hoặc /t/)', () => {
      expect(extractThreadsUsername('https://www.threads.net/@zuck/post/DFxyz123')).toBeNull();
      expect(extractThreadsUsername('https://www.threads.net/t/C_xyz123')).toBeNull();
    });

    it('từ chối path hệ thống Threads cố định', () => {
      expect(extractThreadsUsername('https://www.threads.net/login')).toBeNull();
      expect(extractThreadsUsername('https://www.threads.net/search')).toBeNull();
      expect(extractThreadsUsername('t')).toBeNull();
    });

    it('từ chối URL hoặc username có ký tự đặc biệt không hợp lệ', () => {
      expect(extractThreadsUsername('https://random.com/something')).toBeNull();
      expect(extractThreadsUsername('user!@#$')).toBeNull();
    });
  });

  describe('Controller Validations (chặn lỗi 500 khi dán link sai/link video)', () => {
    let mockDouyinService: any;
    let mockDouyinAiClient: any;
    let mockXhsService: any;
    let mockKuaishouService: any;

    beforeEach(() => {
      mockDouyinService = { scrapeProfile: jest.fn().mockResolvedValue({ status: 'ok' }) };
      mockDouyinAiClient = { resolveVideoAuthor: jest.fn().mockResolvedValue(null) };
      mockXhsService = { scrapeProfile: jest.fn().mockResolvedValue({ status: 'ok' }) };
      mockKuaishouService = { scrapeProfile: jest.fn().mockResolvedValue({ status: 'ok' }) };
    });

    it('DouyinScraperController: ném 400 Bad Request khi dán link video không phân giải được tác giả', async () => {
      const controller = new DouyinScraperController(mockDouyinService, {} as any, mockDouyinAiClient);
      await expect(
        controller.profileScrape({ sec_user_id: 'https://www.douyin.com/video/7382193821938' }),
      ).rejects.toThrow(HttpException);

      try {
        await controller.profileScrape({ sec_user_id: 'https://www.douyin.com/video/7382193821938' });
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.getResponse().error).toContain('Không tìm thấy định danh kênh Douyin');
      }
      expect(mockDouyinService.scrapeProfile).not.toHaveBeenCalled();
    });

    it('DouyinScraperController: bóc tách thành công sec_user_id từ link share mobile iesdouyin', async () => {
      const controller = new DouyinScraperController(mockDouyinService, {} as any, mockDouyinAiClient);
      const secUid = 'MS4wLjABAAAAMYg6MdsvSmtAFtlO9X15pwjLzWohECbGeCwCpjh15k_aPv6p00za_GYHeAwMGCAB';
      const shareUrl = `https://www.iesdouyin.com/share/user/${secUid}?u_code=123`;

      const result = await controller.profileScrape({ sec_user_id: shareUrl });
      expect(result).toEqual({ status: 'ok' });
      expect(mockDouyinService.scrapeProfile).toHaveBeenCalledWith(secUid, undefined, 50);
    });

    it('XiaohongshuScraperController: ném 400 Bad Request khi dán link bài viết note thay vì profile', async () => {
      const controller = new XiaohongshuScraperController(mockXhsService, {} as any);
      await expect(
        controller.profileScrape({ user_id: 'https://www.xiaohongshu.com/explore/6620f4c3000000000d021234' }),
      ).rejects.toThrow(HttpException);

      try {
        await controller.profileScrape({ user_id: 'https://www.xiaohongshu.com/explore/6620f4c3000000000d021234' });
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.getResponse().error).toContain('Không lấy được ID tài khoản XiaoHongShu');
      }
      expect(mockXhsService.scrapeProfile).not.toHaveBeenCalled();
    });

    it('KuaishouScraperController: ném 400 Bad Request khi dán link video ngắn thay vì profile', async () => {
      const controller = new KuaishouScraperController(mockKuaishouService, {} as any);
      await expect(
        controller.profileScrape({ eid: 'https://www.kuaishou.com/short-video/3xabcdef12345678' }),
      ).rejects.toThrow(HttpException);

      try {
        await controller.profileScrape({ eid: 'https://www.kuaishou.com/short-video/3xabcdef12345678' });
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(err.getResponse().error).toContain('Không lấy được eid Kuaishou');
      }
      expect(mockKuaishouService.scrapeProfile).not.toHaveBeenCalled();
    });
  });
});

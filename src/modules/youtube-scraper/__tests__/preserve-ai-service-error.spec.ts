import { HttpException, Logger } from '@nestjs/common';
import { YoutubeScraperService } from '../youtube-scraper.service';

/**
 * YouTube / Bilibili / Kuaishou bọc MỌI lỗi của khối cào đồng bộ thành
 * `HttpException(err.message, 400)`. Với AxiosError thì `err.message` là
 * "Request failed with status code 502": lý do thật của AI service nằm trong
 * `response.data.error` bị vứt đi, và 502 (hỏng ở nhà cung cấp) bị đổi thành 400
 * (người dùng nhập sai). Cả hai đều đẩy người trực đi nhầm hướng.
 *
 * Đo trên hệ thống thật 12/08/2026 sau khi AI service đã báo đúng nguyên nhân:
 * TikTok/Douyin/Instagram/Xiaohongshu trả 502 kèm "token TikHub hết hạn", riêng ba
 * nền tảng này vẫn trả 400 "Request failed with status code 502".
 *
 * YouTube đại diện cho cả ba — cùng một khối catch, chép y hệt nhau.
 */
describe('YoutubeScraperService.scrapeChannel — không che lý do AI service đưa ra', () => {
  let prisma: any;
  let aiClient: { fetchChannel: jest.Mock };
  let service: YoutubeScraperService;

  const HO_SO = {
    id: 1n,
    channel_id: 'UCtest',
    title: '',
    scraping_status: 'idle',
    is_initial_scraped: false,
    is_owned: false,
  };

  beforeEach(() => {
    prisma = {
      scraperYoutubeProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(HO_SO),
        create: jest.fn().mockResolvedValue(HO_SO),
        update: jest.fn().mockResolvedValue(HO_SO),
        delete: jest.fn().mockResolvedValue(HO_SO),
      },
    };
    aiClient = { fetchChannel: jest.fn() };
    service = new YoutubeScraperService(prisma, aiClient as any, {} as any);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function loiTuAiService() {
    return Object.assign(new Error('Request failed with status code 502'), {
      isAxiosError: true,
      response: {
        status: 502,
        data: { error: 'TikHub từ chối yêu cầu (403) ở youtube get_channel_info: API token has expired.' },
      },
    });
  }

  it('giữ nguyên lỗi AI service để bộ lọc chung đọc được lý do thật', async () => {
    aiClient.fetchChannel.mockRejectedValue(loiTuAiService());

    await expect(service.scrapeChannel('UCtest')).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 502 },
    });
  });

  it('không hạ 502 của nhà cung cấp xuống 400 của người dùng', async () => {
    aiClient.fetchChannel.mockRejectedValue(loiTuAiService());

    const loi = await service.scrapeChannel('UCtest').catch((e) => e);

    expect(loi).not.toBeInstanceOf(HttpException);
  });

  it('lỗi không phải của AI service vẫn thành 400 kèm thông báo cũ', async () => {
    aiClient.fetchChannel.mockRejectedValue(new Error('channel_id sai định dạng'));

    const loi = await service.scrapeChannel('UCtest').catch((e) => e);

    expect(loi).toBeInstanceOf(HttpException);
    expect(loi.getStatus()).toBe(400);
    expect(loi.getResponse()).toEqual({ error: 'channel_id sai định dạng' });
  });
});

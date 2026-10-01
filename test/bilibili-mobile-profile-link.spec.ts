import { HttpException, HttpStatus } from '@nestjs/common';
import { BilibiliScraperController } from '../src/modules/bilibili-scraper/bilibili-scraper.controller';

/**
 * Link trang cá nhân Bilibili copy trên điện thoại là m.bilibili.com/space/<mid> — bản cũ chỉ
 * nhận space.bilibili.com/<mid> nên báo "Không lấy được ID kênh Bilibili" (m.bilibili.com
 * không thuộc allowlist link rút gọn nên cũng không được resolve).
 */
describe('BilibiliScraperController.profileScrape — link trang cá nhân', () => {
  let fetchSpy: jest.SpyInstance;
  const service = { scrapeProfile: jest.fn().mockResolvedValue({ status: 'ok' }) };

  beforeEach(() => {
    service.scrapeProfile.mockClear();
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it.each([
    ['https://m.bilibili.com/space/2', '2'],
    ['https://m.bilibili.com/space/946974?spm_id_from=333.1007.0.0', '946974'],
    ['https://space.bilibili.com/946974', '946974'],
    ['https://space.bilibili.com/946974/video?tid=0', '946974'],
    ['946974', '946974'],
  ])('%s → mid %s', async (input, mid) => {
    const controller = new BilibiliScraperController(service as any, {} as any);
    await controller.profileScrape({ mid: input, num_of_posts: 20 });
    expect(service.scrapeProfile).toHaveBeenCalledWith(mid, 20);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('link video vẫn bị từ chối với hướng dẫn dán link trang cá nhân', async () => {
    const controller = new BilibiliScraperController(service as any, {} as any);
    const err = await controller.profileScrape({ mid: 'https://www.bilibili.com/video/BV1GJ411x7h7' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(service.scrapeProfile).not.toHaveBeenCalled();
  });
});

import { ScraperAggregateReadService } from '../src/modules/scraper-aggregate/scraper-aggregate-read.service';

describe('ScraperHiddenVideos (Xoá mềm, Ẩn video & Khôi phục)', () => {
  let service: ScraperAggregateReadService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      scraperHiddenVideo: {
        upsert: jest.fn().mockResolvedValue({ id: 'h1', platform: 'facebook', post_id: '123' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ total: 0n }]),
    };

    service = new ScraperAggregateReadService(prismaMock);
  });

  it('hideVideo: lưu platform và post_id vào bảng scraper_hidden_videos', async () => {
    const res = await service.hideVideo('facebook', '123456', 'user-1', 'Nội dung không phù hợp');
    expect(res).toEqual({ status: 'ok', hidden: true, platform: 'facebook', post_id: '123456' });
    expect(prismaMock.scraperHiddenVideo.upsert).toHaveBeenCalledWith({
      where: { platform_post_id: { platform: 'facebook', post_id: '123456' } },
      create: { platform: 'facebook', post_id: '123456', user_id: 'user-1', reason: 'Nội dung không phù hợp' },
      update: { reason: 'Nội dung không phù hợp', user_id: 'user-1' },
    });
  });

  it('hideVideo: báo lỗi khi thiếu platform hoặc post_id', async () => {
    await expect(service.hideVideo('', '123456')).rejects.toThrow();
    await expect(service.hideVideo('facebook', '')).rejects.toThrow();
  });

  it('restoreVideo: xoá khỏi scraper_hidden_videos để khôi phục lại', async () => {
    const res = await service.restoreVideo('facebook', '123456');
    expect(res).toEqual({ status: 'ok', restored: true, platform: 'facebook', post_id: '123456' });
    expect(prismaMock.scraperHiddenVideo.deleteMany).toHaveBeenCalledWith({
      where: { platform: 'facebook', post_id: '123456' },
    });
  });

  it('restoreVideo: báo lỗi khi thiếu platform hoặc post_id', async () => {
    await expect(service.restoreVideo('', '123456')).rejects.toThrow();
    await expect(service.restoreVideo('facebook', '')).rejects.toThrow();
  });
});

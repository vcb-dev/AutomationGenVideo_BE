import { TiktokScraperService } from '../../../modules/tiktok-scraper/tiktok-scraper.service';
import { DouyinScraperService } from '../../../modules/douyin-scraper/douyin-scraper.service';
import { InstagramScraperService } from '../../../modules/instagram-scraper/instagram-scraper.service';
import { YoutubeScraperService } from '../../../modules/youtube-scraper/youtube-scraper.service';
import { KuaishouScraperService } from '../../../modules/kuaishou-scraper/kuaishou-scraper.service';
import { BilibiliScraperService } from '../../../modules/bilibili-scraper/bilibili-scraper.service';
import { XiaohongshuScraperService } from '../../../modules/xiaohongshu-scraper/xiaohongshu-scraper.service';

/**
 * Nút "Đồng bộ tất cả" trên trang từng nền tảng.
 *
 * Cào lại từng kênh một quá mất công khi có 238 kênh. Nhưng cào hàng loạt là thao tác TỐN
 * TIỀN THẬT: mỗi lượt gọi TikHub tính 0,0055 USD (số từ hoá đơn 30/07), nên cào hết 238 kênh
 * là ~1,3 USD một lần bấm. Vì vậy hai ràng buộc dưới đây quan trọng ngang chức năng chính:
 *
 *   - Bấm hai lần không được chạy hai lượt song song. Nhấp đúp = trả tiền gấp đôi.
 *   - Kênh đang cào dở phải bị bỏ qua, không cào chồng lên.
 *
 * `periodicRefresh()` sẵn có chỉ lấy kênh `is_tracked = true` — hiện chỉ có 1/238 kênh được
 * đánh dấu, nên đem nguyên nó ra làm nút thì bấm xong gần như không cào gì.
 */

const PLATFORMS = [
  { label: 'TikTok', model: 'scraperTikTokProfile', make: (p: any) => new TiktokScraperService(p, {} as any, {} as any, {} as any) },
  { label: 'Douyin', model: 'scraperDouyinProfile', make: (p: any) => new DouyinScraperService(p, {} as any, {} as any, {} as any, {} as any) },
  { label: 'Instagram', model: 'scraperInstagramProfile', make: (p: any) => new InstagramScraperService(p, {} as any) },
  { label: 'YouTube', model: 'scraperYoutubeProfile', make: (p: any) => new YoutubeScraperService(p, {} as any, {} as any) },
  { label: 'KuaiShou', model: 'scraperKuaishouProfile', make: (p: any) => new KuaishouScraperService(p, {} as any, {} as any, {} as any, {} as any) },
  { label: 'Bilibili', model: 'scraperBilibiliProfile', make: (p: any) => new BilibiliScraperService(p, {} as any, {} as any, {} as any, {} as any) },
  { label: 'XiaoHongShu', model: 'scraperXiaohongshuProfile', make: (p: any) => new XiaohongshuScraperService(p, {} as any, {} as any, {} as any) },
];

function build(model: string, rows: any[] = []) {
  const prisma: any = {
    [model]: {
      findMany: jest.fn(async () => rows),
      updateMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => rows[0] ?? null),
    },
  };
  return prisma;
}

describe.each(PLATFORMS)('$label — Đồng bộ tất cả', ({ model, make }) => {
  it('cào cả kênh CHƯA đánh dấu chú ý', async () => {
    // Đây là điểm khác duy nhất so với periodicRefresh, và là lý do nút này tồn tại.
    const prisma = build(model);
    const service = make(prisma) as any;

    await service.syncAllProfiles();

    const where = prisma[model].findMany.mock.calls[0][0].where;
    expect(where.is_tracked).toBeUndefined();
  });

  it('bỏ qua kênh đang cào dở, không cào chồng', async () => {
    const prisma = build(model);
    const service = make(prisma) as any;

    await service.syncAllProfiles();

    const where = prisma[model].findMany.mock.calls[0][0].where;
    expect(where.scraping_status).toEqual({ not: 'processing' });
  });

  it('periodicRefresh vẫn chỉ lấy kênh đã đánh dấu — nút mới không được đổi hành vi cron', async () => {
    const prisma = build(model);
    const service = make(prisma) as any;

    await service.periodicRefresh();

    expect(prisma[model].findMany.mock.calls[0][0].where.is_tracked).toBe(true);
  });
});

describe('Chống bấm hai lần', () => {
  it('lượt thứ hai bị từ chối khi lượt đầu chưa xong — nhấp đúp không được trả tiền gấp đôi', async () => {
    // Đặt thẳng cờ thay vì chạy thật một lượt: refreshProfiles nghỉ 5 giây giữa mỗi kênh
    // để không dồn dập gọi API, nên mô phỏng bằng thời gian thật sẽ làm test treo 5 giây.
    const prisma = build('scraperTikTokProfile', [{ id: 1n, username: 'a' }]);
    const service = new TiktokScraperService(prisma, {} as any, {} as any, {} as any) as any;
    service.syncAllRunning = true;

    const secondRun = await service.syncAllProfiles();

    expect(secondRun.already_running).toBe(true);
    expect(secondRun.total).toBe(0);
    expect(prisma.scraperTikTokProfile.findMany).not.toHaveBeenCalled();
  });

  it('chạy xong thì lượt sau được phép chạy lại', async () => {
    const prisma = build('scraperTikTokProfile');
    const service = new TiktokScraperService(prisma, {} as any, {} as any, {} as any) as any;

    await service.syncAllProfiles();
    await service.syncAllProfiles();

    expect(prisma.scraperTikTokProfile.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('Kênh chưa cào lần đầu', () => {
  it('Đồng bộ tất cả PHẢI bao gồm cả kênh chưa cào lần nào', async () => {
    // 48 kênh trong hệ thống chưa có video nào (KuaiShou 23/59, Instagram 11/58...). Nếu nút
    // vẫn lọc is_initial_scraped: true như cron thì chúng không có đường vào, người dùng
    // buộc phải đi bấm cào từng kênh — đúng thứ nút này sinh ra để tránh.
    const prisma = build('scraperTikTokProfile');
    const service = new TiktokScraperService(prisma, {} as any, {} as any, {} as any) as any;

    await service.syncAllProfiles();

    expect(prisma.scraperTikTokProfile.findMany.mock.calls[0][0].where.is_initial_scraped).toBeUndefined();
  });

  it('cron định kỳ vẫn chỉ đụng kênh đã cào lần đầu', async () => {
    // Cron chạy nền không ai theo dõi, cào lần đầu tốn nhiều lượt API hơn hẳn cào delta —
    // để nó tự ý cào kênh mới là mở đường cho hoá đơn phình mà không ai biết.
    const prisma = build('scraperTikTokProfile');
    const service = new TiktokScraperService(prisma, {} as any, {} as any, {} as any) as any;

    await service.periodicRefresh();

    expect(prisma.scraperTikTokProfile.findMany.mock.calls[0][0].where.is_initial_scraped).toBe(true);
  });
});

import { VideoLibraryService } from '../src/modules/video-library/video-library.service';
import { VideoLibraryController } from '../src/modules/video-library/video-library.controller';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { recordUsageFromResponse, setUsageSink, UsageRow } from '../src/common/api-usage/api-usage-tracking';
import { currentUsageContext } from '../src/common/api-usage/request-context';

/**
 * Thống kê chi phí TikHub + Gemini của menu Khám phá Video (trang "Chi phí" ở Bộ sưu tập).
 * AI đo chi phí từng lượt gọi → chốt chung common/api-usage ghi api_usage_logs → trang "Chi phí"
 * tổng hợp theo trang / bước / nền tảng / người. Bộ sưu tập chỉ gắn nhãn cho lượt gọi của mình.
 */
const LEADER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

/** Như khi phản hồi AI đi qua interceptor thật: header X-Api-Usage → dòng ghi (kèm nhãn hiện tại). */
function passThroughInterceptor(aiPath: string, usage: unknown[]) {
  recordUsageFromResponse({ headers: { 'x-api-usage': JSON.stringify(usage) }, config: { url: `http://ai.local${aiPath}` } } as any);
}

function build() {
  const tags: any[] = [];
  const prisma: any = {
    notification: { create: jest.fn(async () => ({})) },
    team: { findMany: jest.fn(async () => []) },
    videoLibraryTeam: { createMany: jest.fn(async () => ({ count: 0 })) },
    videoLibrary: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 'lib1', ...data })) },
    scraperVideoProposal: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })) },
    approvedContent: {
      create: jest.fn(async ({ data }: any) => ({ id: 'c1', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    apiUsageLog: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => [{ id: LEADER, full_name: 'Bùi Đức Chung', email: 'c@x' }]) },
  };
  const aiIntegration: any = {
    fetchVideoDetail: jest.fn(async () => {
      tags.push(currentUsageContext()?.tag);
      passThroughInterceptor('/api/scraper/video-detail/', [
        { provider: 'tikhub', endpoint: '/api/v1/douyin/web/fetch_one_video', cached: false, status: 200, calls: 1, cost_usd: 0.001 },
      ]);
      return null;
    }),
    generateScriptFromVideo: jest.fn(async () => {
      tags.push(currentUsageContext()?.tag);
      passThroughInterceptor('/api/scraped-video/script-from-video/', [
        { provider: 'tikhub', endpoint: '/api/v1/douyin/web/fetch_one_video', cached: true, status: 200, calls: 1, cost_usd: 0 },
        { provider: 'gemini', endpoint: 'gemini-3.1-flash-lite', cached: false, status: 200, calls: 1, cost_usd: 0.0028, input_tokens: 7270, output_tokens: 341 },
      ]);
      return { status: 'DONE', source: 'gemini_video', script_text: 'K', transcript: 't', has_voice: true, download: { ok: true, source: 'tikhub' } };
    }),
    analyzeScrapedVideo: jest.fn(async () => ({ vietnamese_content: 'x', script_outline: 'y', hashtags: [] })),
    getTikhubAccount: jest.fn(async () => ({ key_name: 'VCB-DEV', balance_usd: 10.3608, today: { usage_usd: 0.404 } })),
  };
  const service = new VideoLibraryService(prisma, { sendToUser: jest.fn(async () => {}) } as any, aiIntegration);
  return { service, prisma, aiIntegration, tags };
}

const video = { video_id: '7226977942524448040', platform: 'douyin', video_url: 'https://www.douyin.com/video/7226977942524448040', title: 'T' };

describe('Bộ sưu tập gắn nhãn cho chốt ghi chi phí', () => {
  let rows: UsageRow[];
  beforeEach(() => { rows = []; setUsageSink(async (r) => { rows.push(...r); }); });
  afterEach(() => setUsageSink(null));

  it('đề xuất → lượt lấy số liệu mang nhãn Bộ sưu tập, gắn người đề xuất + video', async () => {
    const { service, tags } = build();
    await service.proposeVideo(MEMBER, { ...video } as any);
    expect(tags[0]).toEqual({ page: 'COLLECTION', feature: 'PROPOSAL_DETAIL', userId: MEMBER, videoId: video.video_id, platform: 'douyin' });
    expect(rows).toEqual([expect.objectContaining({
      provider: 'TIKHUB', feature: 'PROPOSAL_DETAIL', page: 'COLLECTION', platform: 'douyin', cost_usd: 0.001,
      user_id: MEMBER, video_id: video.video_id, cached: false, http_status: 200,
    })]);
  });

  it('duyệt → chi phí kịch bản chạy nền vẫn đúng bước (TikHub = tải dự phòng, Gemini = viết), gắn content + người duyệt', async () => {
    const { service } = build();
    await service.addVideoDirectly(LEADER, 'Leader', ['LEADER'], { ...video } as any);
    await service.waitForPendingScripts();
    const script = rows.filter((l) => l.feature !== 'PROPOSAL_DETAIL');
    expect(script.map((l) => [l.provider, l.feature, l.page, l.cached, l.cost_usd])).toEqual([
      ['TIKHUB', 'SCRIPT_DOWNLOAD', 'COLLECTION', true, 0],
      ['GEMINI', 'SCRIPT_GEMINI', 'COLLECTION', false, 0.0028],
    ]);
    expect(script[1]).toMatchObject({ input_tokens: 7270, output_tokens: 341, approved_content_id: 'c1', user_id: LEADER });
  });
});

// Tỷ giá là biến bắt buộc (không có mặc định trong code) — mỗi test tự cấp, test riêng kiểm lúc thiếu.
beforeEach(() => { process.env.USD_VND_RATE = '26000'; });
afterEach(() => { delete process.env.USD_VND_RATE; });

describe('Thống kê chi phí (getCostStats)', () => {

  function row(o: any) {
    return {
      cached: false, http_status: 200, calls: 1, input_tokens: 0, output_tokens: 0, user_id: LEADER, video_id: 'v', approved_content_id: null,
      platform: 'douyin', page: 'COLLECTION', ...o, cost_usd: String(o.cost_usd ?? 0),
    };
  }

  it('cộng dồn đúng theo trang/bước, quy ra VNĐ, tách lượt tính tiền / dùng bộ đệm, số lượt gộp', async () => {
    process.env.USD_VND_RATE = '25000';
    const { service, prisma } = build();
    prisma.apiUsageLog.findMany.mockResolvedValue([
      row({ id: '1', provider: 'TIKHUB', feature: 'PROPOSAL_DETAIL', endpoint: '/xhs', platform: 'xiaohongshu', cost_usd: 0.01, created_at: new Date('2026-09-28T03:00:00Z') }),
      row({ id: '2', provider: 'TIKHUB', feature: 'SCRIPT_DOWNLOAD', endpoint: '/xhs', platform: 'xiaohongshu', cached: true, cost_usd: 0, approved_content_id: 'c1', created_at: new Date('2026-09-28T03:01:00Z') }),
      row({ id: '3', provider: 'GEMINI', feature: 'SCRIPT_GEMINI', endpoint: 'gemini-3.1-flash-lite', platform: 'xiaohongshu', cost_usd: 0.012, input_tokens: 7000, output_tokens: 1800, approved_content_id: 'c1', created_at: new Date('2026-09-28T03:02:00Z') }),
      // 18:30 UTC ngày 27 = 01:30 sáng 28/09 giờ VN → phải rơi vào ngày 28
      row({ id: '4', provider: 'GEMINI', feature: 'SCRIPT_GEMINI', endpoint: 'gemini-3.1-flash-lite', cost_usd: 0.008, input_tokens: 5000, output_tokens: 1000, approved_content_id: 'c2', created_at: new Date('2026-09-27T18:30:00Z') }),
      // kênh nội bộ đồng bộ bài đăng: 5 lượt gộp trong một dòng
      row({ id: '5', provider: 'TIKHUB', feature: 'CHANNEL_SYNC', page: 'INTERNAL_CHANNELS', endpoint: '/api/v1/tiktok/app/v3/fetch_user_post_videos', platform: 'tiktok', calls: 5, cost_usd: 0.005, created_at: new Date('2026-09-28T04:00:00Z') }),
      row({ id: '6', provider: 'TIKHUB', feature: 'CHANNEL_SYNC', page: 'AUTO', endpoint: '/api/v1/tiktok/app/v3/fetch_user_post_videos', platform: 'tiktok', calls: 2, cost_usd: 0.002, user_id: null, created_at: new Date('2026-09-28T05:00:00Z') }),
      // trang ngoài Khám phá Video → không cộng vào tổng
      row({ id: '7', provider: 'TIKHUB', feature: 'OTHER', page: 'OTHER', endpoint: '/api/v1/x', cost_usd: 0.1, calls: 4, created_at: new Date('2026-09-28T06:00:00Z') }),
    ]);

    const s = await service.getCostStats('2026-09-28', '2026-09-28');

    expect(s.totals).toMatchObject({ cost_usd: 0.037, cost_vnd: 925, scripts: 2 });
    expect(s.totals.tikhub).toMatchObject({ cost_usd: 0.017, cost_vnd: 425, paid_calls: 8, cached_calls: 1 });
    expect(s.totals.gemini).toMatchObject({ cost_usd: 0.02, calls: 2, input_tokens: 12000, output_tokens: 2800 });
    expect(s.totals.avg_script).toMatchObject({ cost_usd: 0.01, cost_vnd: 250 }); // (0.012 + 0.008) / 2
    expect(s.by_page.map((p: any) => [p.page, p.label, p.calls, p.cost_vnd])).toEqual([
      ['COLLECTION', 'Bộ sưu tập', 3, 750], ['INTERNAL_CHANNELS', 'Kênh nội bộ', 5, 125], ['AUTO', 'Tự động (cron)', 2, 50],
    ]);
    expect(s.outside).toMatchObject({ cost_usd: 0.1, cost_vnd: 2500, calls: 4 });
    expect(s.by_day).toEqual([{ date: '2026-09-28', tikhub_vnd: 425, gemini_vnd: 500 }]);
    expect(s.by_feature.map((f: any) => [f.feature, f.calls, f.cost_vnd])).toEqual([
      ['SCRIPT_GEMINI', 2, 500], ['PROPOSAL_DETAIL', 1, 250], ['CHANNEL_SYNC', 7, 175], ['SCRIPT_DOWNLOAD', 0, 0],
    ]);
    expect(s.by_feature[0].label).toBe('Gemini viết kịch bản');
    expect(s.by_platform.find((p: any) => p.platform === 'tiktok')).toMatchObject({ calls: 7, cost_vnd: 175 });
    expect(s.by_user[0]).toMatchObject({ name: 'Bùi Đức Chung', cost_vnd: 875 });
    expect(s.recent.find((r: any) => r.page === 'AUTO')).toMatchObject({ page_label: 'Tự động (cron)', calls: 2 });
    expect(s.recent.some((r: any) => r.page === 'OTHER')).toBe(false);
    expect(s.pricing.usd_vnd_rate).toBe(25000);
  });

  it('lọc theo ngày giờ Việt Nam (+07:00)', async () => {
    const { service, prisma } = build();
    await service.getCostStats('2026-09-28', '2026-09-28');
    const where = prisma.apiUsageLog.findMany.mock.calls[0][0].where;
    expect(where.created_at.gte.toISOString()).toBe('2026-09-27T17:00:00.000Z');
    expect(where.created_at.lte.toISOString()).toBe('2026-09-28T16:59:59.999Z');
  });

  it('thiếu hoặc sai USD_VND_RATE → báo lỗi nêu tên biến, không tự lấy tỷ giá nào', async () => {
    const { service } = build();
    for (const bad of [undefined, '', 'abc', '0', '-1']) {
      if (bad === undefined) delete process.env.USD_VND_RATE; else process.env.USD_VND_RATE = bad;
      await expect(service.getCostStats()).rejects.toThrow('Thiếu USD_VND_RATE');
    }
  });
});

describe('Tài khoản TikHub', () => {
  it('quy số dư + chi tiêu hôm nay ra VNĐ', async () => {
    const { service } = build();
    const res: any = await service.getTikhubAccount({ id: LEADER });
    expect(res).toMatchObject({ key_name: 'VCB-DEV', balance_vnd: Math.round(10.3608 * 26000), today_usage_vnd: Math.round(0.404 * 26000) });
  });

  it('thiếu USD_VND_RATE → báo lỗi nêu tên biến', async () => {
    const { service } = build();
    delete process.env.USD_VND_RATE;
    await expect(service.getTikhubAccount({ id: LEADER })).rejects.toThrow('Thiếu USD_VND_RATE');
  });

  it('AI lỗi → trả nguyên lỗi để trang hiện lý do', async () => {
    const { service, aiIntegration } = build();
    aiIntegration.getTikhubAccount.mockResolvedValue({ error: 'Chưa cấu hình TIKHUB_API_KEY.' });
    expect(await service.getTikhubAccount({ id: LEADER })).toEqual({ error: 'Chưa cấu hình TIKHUB_API_KEY.' });
  });
});

describe('Quyền xem chi phí', () => {
  it.each(['costs', 'tikhubAccount'])('%s chỉ ADMIN và MANAGER', (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, (VideoLibraryController.prototype as any)[method]);
    expect(roles).toEqual(['ADMIN', 'MANAGER']);
  });
});

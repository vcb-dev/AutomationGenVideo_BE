import { WeeklyReportService, FullWeekVideoDetail } from '../weekly-report.service';

/**
 * Vì sao có bước làm mới riêng: cron làm mới toàn cục chạy 12:00, báo cáo chạy 09:00 — số gửi
 * đi sẽ là số của 12:00 hôm qua, cũ ~21 tiếng. Lô này ~130 video, rẻ hơn nhiều so với nới cửa
 * sổ toàn cục lên 8 ngày (~1.300 video).
 */

let dem = 0;
const video = (v: Partial<FullWeekVideoDetail> = {}): FullWeekVideoDetail => ({
  post_id: `p${++dem}`,
  ten_fanpage: 'Fanpage A',
  caption: 'x',
  permalink_url: null,
  published_at: new Date('2026-07-30T00:00:00.000Z'),
  view_count: 100,
  like_count: 1,
  comment_count: 0,
  share_count: 0,
  managed_page_id: 1n,
  page_access_token: 'tok_a',
  ...v,
});

function buildService(fetchMetricsRefresh: jest.Mock, update = jest.fn()) {
  const prisma = { video_management_ownedvideocontent: { update } } as any;
  const aiClient = { fetchMetricsRefresh } as any;
  return {
    service: new WeeklyReportService(prisma, aiClient, {} as any, {} as any),
    update,
  };
}

describe('refreshBatchMetrics', () => {
  it('gom theo fanpage: mỗi page gọi Graph API đúng một lượt, không gọi từng video', async () => {
    const fetchMetricsRefresh = jest.fn().mockResolvedValue({ metrics: {} });
    const { service } = buildService(fetchMetricsRefresh);

    await service.refreshBatchMetrics([
      video({ managed_page_id: 1n, page_access_token: 'tok_a' }),
      video({ managed_page_id: 1n, page_access_token: 'tok_a' }),
      video({ managed_page_id: 2n, page_access_token: 'tok_b' }),
    ]);

    expect(fetchMetricsRefresh).toHaveBeenCalledTimes(2);
    expect(fetchMetricsRefresh.mock.calls[0][1]).toHaveLength(2);
    expect(fetchMetricsRefresh.mock.calls[1][1]).toHaveLength(1);
  });

  it('ghi số mới vào chính đối tượng video để phần dựng message khỏi truy vấn lại', async () => {
    const v = video({ post_id: 'p_moi', view_count: 100, like_count: 1 });
    const fetchMetricsRefresh = jest.fn().mockResolvedValue({
      metrics: { p_moi: { view_count: 42_100, like_count: 900, comment_count: 30, share_count: 4 } },
    });
    const { service } = buildService(fetchMetricsRefresh);

    await service.refreshBatchMetrics([v]);

    expect(v.view_count).toBe(42_100);
    expect(v.like_count).toBe(900);
  });

  it('fanpage thiếu token thì bỏ qua, lô vẫn chạy tiếp cho page khác', async () => {
    const fetchMetricsRefresh = jest.fn().mockResolvedValue({ metrics: {} });
    const { service } = buildService(fetchMetricsRefresh);

    await service.refreshBatchMetrics([
      video({ managed_page_id: 1n, page_access_token: '' }),
      video({ managed_page_id: 2n, page_access_token: 'tok_b' }),
    ]);

    expect(fetchMetricsRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMetricsRefresh.mock.calls[0][0]).toBe('tok_b');
  });

  it('Graph API lỗi thì nuốt lỗi và dùng số cũ — số cũ vẫn hơn không có báo cáo', async () => {
    const v = video({ view_count: 100 });
    const fetchMetricsRefresh = jest.fn().mockRejectedValue(new Error('Graph API 500'));
    const { service } = buildService(fetchMetricsRefresh);

    await expect(service.refreshBatchMetrics([v])).resolves.toBeUndefined();
    expect(v.view_count).toBe(100);
  });

  it('video không có trong kết quả trả về thì giữ số cũ, không ghi đè bằng 0', async () => {
    const v = video({ post_id: 'p_thieu', view_count: 777 });
    const fetchMetricsRefresh = jest.fn().mockResolvedValue({ metrics: {} });
    const { service, update } = buildService(fetchMetricsRefresh);

    await service.refreshBatchMetrics([v]);

    expect(v.view_count).toBe(777);
    expect(update).not.toHaveBeenCalled();
  });

  it('lô rỗng thì không gọi Graph API lần nào', async () => {
    const fetchMetricsRefresh = jest.fn();
    const { service } = buildService(fetchMetricsRefresh);

    await service.refreshBatchMetrics([]);

    expect(fetchMetricsRefresh).not.toHaveBeenCalled();
  });
});

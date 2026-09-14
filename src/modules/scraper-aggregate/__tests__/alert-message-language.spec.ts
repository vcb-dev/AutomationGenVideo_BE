import { buildAlerts, type ChannelListRow, type ChannelRow } from '../owned-stats.service';
import { buildDuplicateAlerts, type DuplicateByChannel } from '../owned-duplicate.service';

/**
 * Khối "Cần chú ý" trên trang Tổng quan kênh nội bộ từng hiện tiếng Anh.
 *
 * BE trả hai khoá cho cùng một câu: `content` (tiếng Anh) và `noi_dung` (tiếng Việt), còn FE
 * đọc `content` trước — nên người dùng thấy "Sync error: …", "No new posts in 15 days",
 * nhãn "Error / Drop / Silent / Empty / Duplicate" giữa một trang tiếng Việt. Bản dịch có
 * sẵn nhưng không bao giờ tới được màn hình.
 *
 * Nay chỉ còn MỘT câu tiếng Việt đổ vào cả hai khoá: FE đọc khoá nào cũng ra tiếng Việt, và
 * sau này có bỏ khoá cũ đi thì trang vẫn đúng.
 */
describe('Cảnh báo kênh nội bộ — chữ người dùng đọc phải là tiếng Việt', () => {
  function channel(overrides: Partial<ChannelListRow> = {}): ChannelListRow {
    return {
      platform: 'facebook',
      kenh_id: 'page-1',
      ten: 'Fanpage 1',
      avatar: '',
      followers: 1000n,
      dong_bo: new Date(),
      loi: null,
      hoat_dong: true,
      ngay_cuoi: new Date(),
      ...overrides,
    };
  }

  /** Bắt đúng những câu tiếng Anh đã từng lọt ra màn hình. */
  const ENGLISH_PHRASES = /Sync error|Sync errors|Views dropped|No new posts|No videos scraped|videos duplicated/;
  const ENGLISH_LABELS = ['Error', 'Drop', 'Silent', 'Empty', 'Duplicate'];

  it('lỗi đồng bộ lẻ: câu và nhãn đều tiếng Việt ở cả hai khoá', () => {
    const alerts = buildAlerts([channel({ loi: 'Request failed with status code 502' })], [], 28);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].content).toBe('Đồng bộ lỗi: Request failed with status code 502');
    expect(alerts[0].noi_dung).toBe(alerts[0].content);
    expect(alerts[0].label).toBe('Lỗi');
    expect(alerts[0].nhan).toBe('Lỗi');
  });

  it('lỗi đồng bộ hàng loạt: dòng gộp cũng tiếng Việt', () => {
    const channelList = Array.from({ length: 5 }, (_, i) =>
      channel({ kenh_id: `page-${i}`, ten: `Fanpage ${i}`, loi: 'Token hết hạn' }),
    );

    const errorAlert = buildAlerts(channelList, [], 28).find((c) => c.label === 'Lỗi')!;

    expect(errorAlert.content).toBe('Đồng bộ lỗi ở 5/5 kênh: Token hết hạn');
    expect(errorAlert.channel).toBe('5 kênh');
    expect(errorAlert.kenh).toBe('5 kênh');
  });

  it('tụt lượt xem: câu tiếng Việt, không còn "Views dropped"', () => {
    const byChannel: ChannelRow[] = [
      { platform: 'facebook', kenh_id: 'page-1', ky: 'nay', posts: 5n, views: 20_000n, likes: 0n, comments: 0n, shares: 0n },
      { platform: 'facebook', kenh_id: 'page-1', ky: 'truoc', posts: 5n, views: 100_000n, likes: 0n, comments: 0n, shares: 0n },
    ];

    const dropAlert = buildAlerts([channel()], byChannel, 28).find((c) => c.label === 'Tụt')!;

    expect(dropAlert.content).toBe('Lượt xem giảm 80% so với 28 ngày trước đó');
    expect(dropAlert.noi_dung).toBe(dropAlert.content);
  });

  it('kênh trống và kênh im lặng đều nói tiếng Việt', () => {
    const emptyAlert = buildAlerts([channel({ ngay_cuoi: null })], [], 28)[0];
    const silentAlert = buildAlerts(
      [channel({ ngay_cuoi: new Date(Date.now() - 15 * 86_400_000) })],
      [],
      28,
    )[0];

    expect(emptyAlert.content).toBe('Chưa cào được video nào');
    expect(emptyAlert.label).toBe('Trống');
    expect(silentAlert.content).toBe('Chưa đăng bài trong 15 ngày');
    expect(silentAlert.label).toBe('Im lặng');
  });

  it('cảnh báo trùng lặp: một câu tiếng Việt cho cả hai khoá', () => {
    const byChannel: DuplicateByChannel[] = [
      {
        platform: 'facebook',
        id: 'page-1',
        name: 'Fanpage 1',
        duplicateVideos: 48,
        totalVideos: 50,
        duplicateRatio: 96,
      },
    ];

    const alerts = buildDuplicateAlerts(byChannel);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].content).toContain('48/50 video trong kỳ trùng với kênh khác');
    expect(alerts[0].noi_dung).toBe(alerts[0].content);
    expect(alerts[0].label).toBe('Trùng');
  });

  it('không còn mẩu tiếng Anh nào lọt ra ở bất kỳ loại cảnh báo nào', () => {
    const channelList = [
      channel({ kenh_id: 'a', loi: 'Request failed with status code 502' }),
      channel({ kenh_id: 'b', ngay_cuoi: null }),
      channel({ kenh_id: 'c', ngay_cuoi: new Date(Date.now() - 30 * 86_400_000) }),
    ];
    const byChannel: ChannelRow[] = [
      { platform: 'facebook', kenh_id: 'a', ky: 'nay', posts: 1n, views: 1_000n, likes: 0n, comments: 0n, shares: 0n },
      { platform: 'facebook', kenh_id: 'a', ky: 'truoc', posts: 1n, views: 90_000n, likes: 0n, comments: 0n, shares: 0n },
    ];

    const alerts = [
      ...buildAlerts(channelList, byChannel, 28),
      ...buildDuplicateAlerts([
        {
          platform: 'facebook',
          id: 'page-1',
          name: 'Fanpage 1',
          duplicateVideos: 48,
          totalVideos: 50,
          duplicateRatio: 96,
        },
      ]),
    ];

    expect(alerts.length).toBeGreaterThan(3);
    for (const c of alerts) {
      expect(c.content).not.toMatch(ENGLISH_PHRASES);
      expect(ENGLISH_LABELS).not.toContain(c.label);
    }
  });
});

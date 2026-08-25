import { OwnedStatsService, type RawAggregateMetricsRow, type ChannelListRow } from '../owned-stats.service';

/**
 * Nền tảng có bài trong kỳ mà tổng lượt xem bằng 0 thì đó là "chưa lấy được số", không phải
 * "không ai xem".
 *
 * Ca thật: 1.446/1.470 reels Instagram có `play_count = 0` vì token thiếu quyền
 * `instagram_manage_insights` (Graph API trả "(#10) Application does not have permission"),
 * trong khi 947 reels vẫn có lượt thích. Trả về số 0 trần trụi khiến trang vẽ đường phẳng
 * dính đáy, kéo tụt "lượt xem trung bình / bài" và dìm mọi kênh Instagram xuống đáy bảng xếp
 * hạng — mà không đâu nói rằng con số đó không tồn tại.
 */
describe('Cờ viewsAvailable của từng nền tảng', () => {
  const service = new OwnedStatsService(null as never, null as never);

  const merge = (rows: RawAggregateMetricsRow[], channels: ChannelListRow[]) =>
    (
      service as never as {
        mergePlatforms: (
          a: RawAggregateMetricsRow[],
          b: unknown[],
          c: ChannelListRow[],
          d: string[],
          e: string,
        ) => { platform: string; viewsAvailable: boolean }[];
      }
    ).mergePlatforms(rows, [], channels, ['2026-08-25'], '');

  const aggregate = (platform: string, posts: number, views: number): RawAggregateMetricsRow => ({
    platform,
    ky: 'nay',
    posts: BigInt(posts),
    views: BigInt(views),
    likes: 0n,
    comments: 0n,
    shares: 0n,
    so_kenh: 1n,
  });

  const channel = (platform: string): ChannelListRow => ({
    platform,
    kenh_id: `${platform}-1`,
    ten: `Kênh ${platform}`,
    avatar: '',
    followers: 0n,
    dong_bo: null,
    loi: null,
    hoat_dong: true,
    ngay_cuoi: null,
  });

  it('có bài, có lượt xem → viewsAvailable = true', () => {
    const res = merge([aggregate('facebook', 4100, 28_700_000)], [channel('facebook')]);

    expect(res[0].viewsAvailable).toBe(true);
  });

  it('có bài, KHÔNG có lượt xem → viewsAvailable = false', () => {
    const res = merge([aggregate('instagram', 1156, 0)], [channel('instagram')]);

    expect(res[0].viewsAvailable).toBe(false);
  });

  it('không có bài nào trong kỳ → vẫn là true, 0 bài thì 0 view là đúng', () => {
    const res = merge([aggregate('youtube', 0, 0)], [channel('youtube')]);

    expect(res[0].viewsAvailable).toBe(true);
  });

  it('nền tảng không có dòng số liệu nào cũng không bị coi là thiếu số', () => {
    const res = merge([], [channel('threads')]);

    expect(res[0].viewsAvailable).toBe(true);
  });

  it('mỗi nền tảng được đánh giá riêng, không lây sang nhau', () => {
    const res = merge(
      [aggregate('facebook', 4100, 28_700_000), aggregate('instagram', 1156, 0)],
      [channel('facebook'), channel('instagram')],
    );
    const theoNenTang = Object.fromEntries(res.map((x) => [x.platform, x.viewsAvailable]));

    expect(theoNenTang).toEqual({ facebook: true, instagram: false });
  });
});

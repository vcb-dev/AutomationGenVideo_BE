import {
  normalizeDateRange,
  normalizePlatform,
  addDays,
  OwnedStatsService,
  daysBetween,
} from '../owned-stats.service';

const FROZEN_NOW = new Date('2026-08-07T05:00:00.000Z'); // 12:00 VN time

beforeAll(() => {
  jest.useFakeTimers({ now: FROZEN_NOW });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('normalizePlatform', () => {
  it.each(['facebook', 'tiktok', 'instagram', 'youtube', 'threads'])('preserves valid platform "%s"', (p) => {
    expect(normalizePlatform(p)).toBe(p);
  });

  it.each([
    ['FACEBOOK', 'facebook'],
    ['  TikTok  ', 'tiktok'],
  ])('normalizes case and trims whitespace: "%s"', (input, expected) => {
    expect(normalizePlatform(input)).toBe(expected);
  });

  it.each([undefined, '', '   ', 'all', 'douyin', 'xiaohongshu', "'; DROP TABLE--"])(
    'maps "%s" to empty string (all platforms)',
    (raw) => {
      expect(normalizePlatform(raw as string | undefined)).toBe('');
    },
  );
});

describe('addDays / daysBetween', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap years correctly', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts both start and end days inclusive', () => {
    expect(daysBetween('2026-08-07', '2026-08-07')).toBe(1);
    expect(daysBetween('2026-08-01', '2026-08-07')).toBe(7);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
  });
});

describe('normalizeDateRange', () => {
  it('defaults to last 28 days when no params provided', () => {
    expect(normalizeDateRange()).toEqual({
      startDate: '2026-07-11',
      endDate: '2026-08-07',
      tu: '2026-07-11',
      den: '2026-08-07',
    });
    expect(daysBetween('2026-07-11', '2026-08-07')).toBe(28);
  });

  it.each([
    ['7', '2026-08-01'],
    ['28', '2026-07-11'],
    ['90', '2026-05-10'],
  ])('handles preset days=%s', (days, startDate) => {
    expect(normalizeDateRange(undefined, undefined, days)).toEqual({
      startDate,
      endDate: '2026-08-07',
      tu: startDate,
      den: '2026-08-07',
    });
  });

  it.each(['1', '30', '365', 'abc', ''])('falls back to default 28 days for invalid days=%s', (days) => {
    expect(normalizeDateRange(undefined, undefined, days)).toEqual({
      startDate: '2026-07-11',
      endDate: '2026-08-07',
      tu: '2026-07-11',
      den: '2026-08-07',
    });
  });

  it('explicit startDate and endDate take precedence over days preset', () => {
    expect(normalizeDateRange('2026-06-01', '2026-06-30', '7')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tu: '2026-06-01',
      den: '2026-06-30',
    });
  });

  it('swaps reversed date ranges automatically', () => {
    expect(normalizeDateRange('2026-06-30', '2026-06-01')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tu: '2026-06-01',
      den: '2026-06-30',
    });
  });

  it('clamps future end date to today', () => {
    expect(normalizeDateRange('2026-08-01', '2027-01-01')).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-07',
      tu: '2026-08-01',
      den: '2026-08-07',
    });
  });

  it('clamps entire future range to today', () => {
    expect(normalizeDateRange('2027-01-01', '2027-02-01')).toEqual({
      startDate: '2026-08-07',
      endDate: '2026-08-07',
      tu: '2026-08-07',
      den: '2026-08-07',
    });
  });

  it('caps range at 366 days max span', () => {
    const res = normalizeDateRange('2016-01-01', '2026-08-07');
    expect(daysBetween(res.startDate, res.endDate)).toBe(366);
    expect(res.endDate).toBe('2026-08-07');
  });

  it.each(['2026-02-31', '2026-13-01', '07-08-2026', '2026/08/07', 'yesterday'])(
    'discards invalid dates "%s" and falls back to default',
    (invalidDate) => {
      expect(normalizeDateRange(invalidDate, invalidDate)).toEqual({
        startDate: '2026-07-11',
        endDate: '2026-08-07',
        tu: '2026-07-11',
        den: '2026-08-07',
      });
    },
  );
});

function buildService() {
  return new OwnedStatsService({} as any, {} as any);
}

const sampleChannelMeta = (p: any = {}) => ({
  platform: 'facebook',
  kenh_id: 'k1',
  ten: 'Page A',
  avatar: '',
  followers: BigInt(100),
  dong_bo: null,
  loi: null,
  hoat_dong: true,
  ngay_cuoi: FROZEN_NOW,
  ...p,
});

const sampleChannelMetrics = (p: any = {}) => ({
  platform: 'facebook',
  kenh_id: 'k1',
  ky: 'nay',
  posts: BigInt(0),
  views: BigInt(0),
  likes: BigInt(0),
  comments: BigInt(0),
  shares: BigInt(0),
  ...p,
});

describe('mergeMarkets', () => {
  it('separates VN vs Global by vn flag and sorts by total views descending', () => {
    const res = (buildService() as any).mergeMarkets([
      { platform: 'facebook', vn: true, posts: BigInt(10), views: BigInt(1000) },
      { platform: 'facebook', vn: false, posts: BigInt(5), views: BigInt(500) },
      { platform: 'tiktok', vn: true, posts: BigInt(1), views: BigInt(9_999) },
    ]);

    expect(res).toEqual([
      { platform: 'tiktok', vn: 9_999, global: 0, posts_vn: 1, posts_global: 0 },
      { platform: 'facebook', vn: 1000, global: 500, posts_vn: 10, posts_global: 5 },
    ]);
  });

  it('returns empty array when input is empty', () => {
    expect((buildService() as any).mergeMarkets([])).toEqual([]);
  });
});

describe('mergeContentLines', () => {
  it('aggregates totals and separates VN vs Global for content line codes', () => {
    const res = (buildService() as any).mergeContentLines([
      { ma: 'A1', vn: true, posts: BigInt(3), views: BigInt(300) },
      { ma: 'A1', vn: false, posts: BigInt(2), views: BigInt(200) },
      { ma: 'A2', vn: true, posts: BigInt(1), views: BigInt(50) },
    ]);

    expect(res).toEqual([
      { code: 'A1', ma: 'A1', posts: 5, views: 500, viewsVn: 300, views_vn: 300, viewsGlobal: 200, views_global: 200 },
      { code: 'A2', ma: 'A2', posts: 1, views: 50, viewsVn: 50, views_vn: 50, viewsGlobal: 0, views_global: 0 },
    ]);
    expect(res[0].views).toBe(res[0].viewsVn + res[0].viewsGlobal);
  });
});

describe('buildAlerts', () => {
  it('reports sync errors first with message truncated to 120 chars', () => {
    const longError = 'x'.repeat(500);
    const res = (buildService() as any).buildAlerts([sampleChannelMeta({ loi: longError })], [], 28);

    expect(res).toHaveLength(1);
    expect(res[0].label).toBe('Error');
    expect(res[0].level).toBe('b');
    expect(res[0].content).toBe(`Sync error: ${'x'.repeat(120)}`);
  });

  it('ignores inactive channels to prevent noise', () => {
    const res = (buildService() as any).buildAlerts(
      [sampleChannelMeta({ hoat_dong: false, loi: 'expired token', ngay_cuoi: new Date('2020-01-01') })],
      [],
      28,
    );
    expect(res).toEqual([]);
  });

  it('reports Empty for channels with no scraped videos', () => {
    const res = (buildService() as any).buildAlerts([sampleChannelMeta({ ngay_cuoi: null })], [], 28);
    expect(res[0]).toMatchObject({ label: 'Empty', level: 'w', content: 'No videos scraped yet' });
  });

  it.each([
    [6, false],
    [7, true],
    [30, true],
  ])('silent for %s days → reported: %s', (silentDays, shouldReport) => {
    const lastDate = new Date(FROZEN_NOW.getTime() - silentDays * 86_400_000);
    const res = (buildService() as any).buildAlerts([sampleChannelMeta({ ngay_cuoi: lastDate })], [], 28);
    const silentAlerts = res.filter((c: any) => c.label === 'Silent');

    expect(silentAlerts).toHaveLength(shouldReport ? 1 : 0);
    if (shouldReport) expect(silentAlerts[0].content).toBe(`No new posts in ${silentDays} days`);
  });

  it('does not report drop when previous period has under 10k views', () => {
    const res = (buildService() as any).buildAlerts(
      [sampleChannelMeta()],
      [sampleChannelMetrics({ ky: 'nay', views: BigInt(0) }), sampleChannelMetrics({ ky: 'truoc', views: BigInt(9_999) })],
      28,
    );
    expect(res.filter((c: any) => c.label === 'Drop')).toHaveLength(0);
  });

  it.each([
    [71_000, false],
    [70_000, true],
    [50_000, true],
  ])('previous 100k views, current %s → reported drop: %s', (currentViews, shouldReport) => {
    const res = (buildService() as any).buildAlerts(
      [sampleChannelMeta()],
      [
        sampleChannelMetrics({ ky: 'nay', views: BigInt(currentViews) }),
        sampleChannelMetrics({ ky: 'truoc', views: BigInt(100_000) }),
      ],
      28,
    );
    expect(res.filter((c: any) => c.label === 'Drop')).toHaveLength(shouldReport ? 1 : 0);
  });

  it('drop alert content mentions exact day count of the period', () => {
    const res = (buildService() as any).buildAlerts(
      [sampleChannelMeta()],
      [sampleChannelMetrics({ ky: 'nay', views: BigInt(40_000) }), sampleChannelMetrics({ ky: 'truoc', views: BigInt(100_000) })],
      90,
    );
    expect(res[0].content).toBe('Views dropped by 60% compared to the prior 90 days');
  });

  it('caps returned alerts to maximum 12 items', () => {
    const manyChannels = Array.from({ length: 40 }, (_, i) =>
      sampleChannelMeta({ kenh_id: `k${i}`, ten: `Page ${i}`, ngay_cuoi: new Date('2020-01-01') }),
    );
    expect((buildService() as any).buildAlerts(manyChannels, [], 28)).toHaveLength(12);
  });

  it('sorts sync error alerts before silent channel alerts', () => {
    const res = (buildService() as any).buildAlerts(
      [
        sampleChannelMeta({ kenh_id: 'im', ten: 'Silent Channel', ngay_cuoi: new Date('2020-01-01') }),
        sampleChannelMeta({ kenh_id: 'loi', ten: 'Error Channel', loi: 'expired token' }),
      ],
      [],
      28,
    );
    expect(res.map((c: any) => c.label)).toEqual(['Error', 'Silent']);
  });
});

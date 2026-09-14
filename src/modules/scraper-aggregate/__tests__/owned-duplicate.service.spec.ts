import {
  RawDuplicateGroupRow,
  RawChannelVideoRow,
  buildDuplicateAlerts,
  mergeGroups,
  truncateContent,
  computeByChannel,
} from '../owned-duplicate.service';

const sampleGroup = (p: Partial<RawDuplicateGroupRow>): RawDuplicateGroupRow => ({
  platform: 'facebook',
  cap: 'sample caption long enough to pass caption length filter',
  giay: 38,
  so_kenh: BigInt(2),
  so_video: BigInt(2),
  views: BigInt(1000),
  kenh_id: ['a', 'b'],
  kenh_ten: ['Page A', 'Page B'],
  ngay_dau: new Date('2026-07-10T03:00:00Z'),
  ngay_cuoi: new Date('2026-07-12T03:00:00Z'),
  url_mau: 'https://facebook.com/1',
  ...p,
});

const sampleChannel = (p: Partial<RawChannelVideoRow>): RawChannelVideoRow => ({
  platform: 'facebook',
  kenh_id: 'k1',
  kenh_ten: 'Page A',
  video_trung: BigInt(0),
  tong_video: BigInt(0),
  ...p,
});

describe('mergeGroups — builds duplicate group list', () => {
  it('sorts groups by channel count descending, then by views descending', () => {
    const res = mergeGroups([
      sampleGroup({ cap: 'few channels high views', so_kenh: BigInt(2), views: BigInt(900_000) }),
      sampleGroup({ cap: 'many channels', so_kenh: BigInt(4), views: BigInt(10) }),
      sampleGroup({ cap: 'three channels low views', so_kenh: BigInt(3), views: BigInt(5) }),
      sampleGroup({ cap: 'three channels high views', so_kenh: BigInt(3), views: BigInt(50) }),
    ]);
    expect(res.map((x) => x.content)).toEqual([
      'many channels',
      'three channels high views',
      'three channels low views',
      'few channels high views',
    ]);
  });

  it('returns ISO date strings rather than Date objects', () => {
    const [res] = mergeGroups([sampleGroup({})]);
    expect(typeof res.startDate).toBe('string');
    expect(typeof res.endDate).toBe('string');
    expect(res.startDate).toBe('2026-07-10T03:00:00.000Z');
  });

  it('pairs channel ids, names, urls, and views accurately', () => {
    const [res] = mergeGroups([
      sampleGroup({
        kenh_id: ['x', 'y', 'z'],
        kenh_ten: ['Page X', 'Page Y', 'Page Z'],
        kenh_url: ['https://facebook.com/x', 'https://facebook.com/y', 'https://facebook.com/z'],
        kenh_views: [BigInt(500), BigInt(300), BigInt(100)],
        so_kenh: BigInt(3),
      }),
    ]);
    expect(res.channels).toEqual([
      { id: 'x', name: 'Page X', ten: 'Page X', url: 'https://facebook.com/x', views: 500 },
      { id: 'y', name: 'Page Y', ten: 'Page Y', url: 'https://facebook.com/y', views: 300 },
      { id: 'z', name: 'Page Z', ten: 'Page Z', url: 'https://facebook.com/z', views: 100 },
    ]);
  });

  it('handles null duration gracefully (e.g. YouTube Shorts)', () => {
    const [res] = mergeGroups([sampleGroup({ platform: 'youtube', giay: null })]);
    expect(res.durationSeconds).toBeNull();
    expect(res.platform).toBe('youtube');
  });
});

describe('computeByChannel — duplicate ratios per channel', () => {
  it('computes ratio accurately and sorts descending', () => {
    const res = computeByChannel([
      sampleChannel({ kenh_id: 'k1', kenh_ten: 'Channel A', video_trung: BigInt(69), tong_video: BigInt(69) }),
      sampleChannel({ kenh_id: 'k2', kenh_ten: 'Channel B', video_trung: BigInt(35), tong_video: BigInt(85) }),
      sampleChannel({ kenh_id: 'k3', kenh_ten: 'Channel C', video_trung: BigInt(71), tong_video: BigInt(72) }),
    ]);
    expect(res.map((x) => x.name)).toEqual(['Channel A', 'Channel C', 'Channel B']);
    expect(res[0].duplicateRatio).toBe(100);
    expect(res[1].duplicateRatio).toBe(98.6);
    expect(res[2].duplicateRatio).toBe(41.2);
  });

  it('handles zero total videos without division by zero', () => {
    const [res] = computeByChannel([sampleChannel({ video_trung: BigInt(0), tong_video: BigInt(0) })]);
    expect(res.duplicateRatio).toBe(0);
    expect(Number.isFinite(res.duplicateRatio)).toBe(true);
  });
});

describe('buildDuplicateAlerts — channel-level warnings', () => {
  it('does not generate group-level alerts', () => {
    const res = buildDuplicateAlerts(
      computeByChannel([sampleChannel({ video_trung: BigInt(1), tong_video: BigInt(100) })]),
    );
    expect(res).toEqual([]);
  });

  it('generates high severity alert for channels with >=20 videos and >=90% duplicates', () => {
    const res = buildDuplicateAlerts(
      computeByChannel([
        sampleChannel({ kenh_ten: 'Channel A', video_trung: BigInt(69), tong_video: BigInt(69) }),
      ]),
    );
    expect(res).toHaveLength(1);
    expect(res[0].level).toBe('b');
    expect(res[0].channel).toBe('Channel A');
    expect(res[0].label).toBe('Trùng');
    expect(res[0].content).toContain('69/69');
    expect(res[0].content).toContain('100');
  });

  it('respects the 20-video floor threshold', () => {
    const belowFloor = buildDuplicateAlerts(
      computeByChannel([sampleChannel({ video_trung: BigInt(19), tong_video: BigInt(19) })]),
    );
    expect(belowFloor).toEqual([]);

    const atFloor = buildDuplicateAlerts(
      computeByChannel([sampleChannel({ video_trung: BigInt(20), tong_video: BigInt(20) })]),
    );
    expect(atFloor).toHaveLength(1);
  });

  it('respects the 90% threshold', () => {
    const atThreshold = buildDuplicateAlerts(
      computeByChannel([sampleChannel({ video_trung: BigInt(90), tong_video: BigInt(100) })]),
    );
    expect(atThreshold).toHaveLength(1);

    const belowThreshold = buildDuplicateAlerts(
      computeByChannel([sampleChannel({ video_trung: BigInt(89), tong_video: BigInt(100) })]),
    );
    expect(belowThreshold).toEqual([]);
  });

  it('sorts highest ratio channels first', () => {
    const res = buildDuplicateAlerts(
      computeByChannel([
        sampleChannel({ kenh_id: 'a', kenh_ten: '90 Percent', video_trung: BigInt(90), tong_video: BigInt(100) }),
        sampleChannel({ kenh_id: 'b', kenh_ten: '100 Percent', video_trung: BigInt(50), tong_video: BigInt(50) }),
      ]),
    );
    expect(res.map((x) => x.channel)).toEqual(['100 Percent', '90 Percent']);
  });
});

describe('truncateContent', () => {
  it('preserves short captions', () => {
    expect(truncateContent('short caption #tag', 80)).toBe('short caption #tag');
  });

  it('truncates long captions and appends ellipsis', () => {
    const longText = 'a'.repeat(200);
    const res = truncateContent(longText, 80);
    expect(res).toHaveLength(81);
    expect(res.endsWith('…')).toBe(true);
  });

  it('preserves unicode composite characters without breaking', () => {
    const text = 'kẻ thù của vàng '.repeat(20);
    const res = truncateContent(text, 30);
    expect([...res].length).toBeLessThanOrEqual(31);
    expect(res.normalize('NFC')).toBe(res);
  });

  it('handles empty or null captions safely', () => {
    expect(truncateContent('', 80)).toBe('');
    expect(truncateContent(null as unknown as string, 80)).toBe('');
  });
});

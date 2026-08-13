import { TiktokScraperReadService } from './tiktok-scraper-read.service';
import { DouyinScraperReadService } from '../douyin-scraper/douyin-scraper-read.service';

/**
 * Lookalike Creator — gợi ý kênh khác cùng nền tảng có hashtag trùng lặp với
 * 1 kênh đang xem. TikTok là bản tham chiếu: top hashtag của profile → tìm
 * profile khác overlap >= ngưỡng → hydrate qua findMany, giữ thứ tự overlap
 * giảm dần.
 */
describe('TiktokScraperReadService.lookalikes', () => {
  function build() {
    const queryRaw = jest.fn();
    const prisma: any = {
      $queryRaw: queryRaw,
      scraperTikTokProfile: { findMany: jest.fn() },
    };
    const service = new TiktokScraperReadService(prisma);
    return { service, prisma, queryRaw };
  }

  afterEach(() => jest.clearAllMocks());

  it('trả về rỗng ngay khi profile nguồn không có hashtag nào (không query overlap)', async () => {
    const { service, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([]); // topTags rỗng

    const result = await service.lookalikes(1n);

    expect(result).toEqual({ lookalikes: [] });
    expect(queryRaw).toHaveBeenCalledTimes(1); // không gọi query overlap nếu không có tag
  });

  it('trả về rỗng khi có hashtag nhưng không profile nào khác đạt ngưỡng overlap', async () => {
    const { service, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([{ hashtag: 'lamdep', cnt: 5n }]); // topTags
    queryRaw.mockResolvedValueOnce([]); // overlaps rỗng

    const result = await service.lookalikes(1n);

    expect(result).toEqual({ lookalikes: [] });
  });

  it('trả về lookalike đúng thứ tự overlap_count giảm dần, kèm thông tin profile', async () => {
    const { service, queryRaw, prisma } = build();
    queryRaw.mockResolvedValueOnce([{ hashtag: 'lamdep', cnt: 10n }, { hashtag: 'skincare', cnt: 8n }]);
    queryRaw.mockResolvedValueOnce([
      { profile_id: 2n, overlap_count: 2n },
      { profile_id: 3n, overlap_count: 1n },
    ]);
    prisma.scraperTikTokProfile.findMany.mockResolvedValueOnce([
      { id: 3n, username: 'channel_c', nickname: 'C', avatar_url: '', avatar_drive_url: '', followers_count: 500n },
      { id: 2n, username: 'channel_b', nickname: 'B', avatar_url: '', avatar_drive_url: '', followers_count: 9000n },
    ]);

    const result = await service.lookalikes(1n);

    expect(result.lookalikes.map((l: any) => l.username)).toEqual(['channel_b', 'channel_c']);
    expect(result.lookalikes[0].overlap_count).toBe(2);
    expect(result.lookalikes[0].followers_count).toBe(9000);
  });

  it('bỏ qua overlap record không tìm thấy profile tương ứng (vd đã bị xoá)', async () => {
    const { service, queryRaw, prisma } = build();
    queryRaw.mockResolvedValueOnce([{ hashtag: 'lamdep', cnt: 10n }]);
    queryRaw.mockResolvedValueOnce([{ profile_id: 99n, overlap_count: 3n }]);
    prisma.scraperTikTokProfile.findMany.mockResolvedValueOnce([]); // profile 99 không còn tồn tại

    const result = await service.lookalikes(1n);

    expect(result.lookalikes).toEqual([]);
  });
});

/**
 * Douyin là platform duy nhất KHÔNG có FK profile_id trên video (nhận diện
 * qua search_keyword='@username') — lookalikes() phải tự resolve qua username
 * và CHỈ trả về tác giả đã có profile tracked sẵn (không tạo mới), khác các
 * platform còn lại. Đây là giới hạn kỹ thuật đã biết, cần test riêng.
 */
describe('DouyinScraperReadService.lookalikes — chỉ trả về tác giả đã tracked', () => {
  function build(sourceProfile: any) {
    const queryRaw = jest.fn();
    const prisma: any = {
      $queryRaw: queryRaw,
      scraperDouyinProfile: {
        findUnique: jest.fn(async () => sourceProfile),
        findMany: jest.fn(),
      },
    };
    const service = new DouyinScraperReadService(prisma);
    return { service, prisma, queryRaw };
  }

  afterEach(() => jest.clearAllMocks());

  it('trả về rỗng nếu profile nguồn không có username (chưa resolve xong)', async () => {
    const { service } = build({ id: 1n, username: '' });
    const result = await service.lookalikes(1n);
    expect(result).toEqual({ lookalikes: [] });
  });

  it('chỉ trả về tác giả overlap ĐÃ có profile trong DB, bỏ tác giả overlap chưa từng thêm', async () => {
    const { service, queryRaw, prisma } = build({ id: 1n, username: 'kenh_goc' });
    queryRaw.mockResolvedValueOnce([{ hashtag: 'lamdep', cnt: 5n }]); // topTags từ '@kenh_goc'
    queryRaw.mockResolvedValueOnce([
      { author_username: 'kenh_da_track', overlap_count: 3n },
      { author_username: 'kenh_chua_track', overlap_count: 5n }, // overlap cao hơn nhưng chưa có profile
    ]);
    // findMany chỉ trả về profile đã tồn tại cho 'kenh_da_track'
    prisma.scraperDouyinProfile.findMany.mockResolvedValueOnce([
      { id: 5n, sec_user_id: 'sec123', username: 'kenh_da_track', nickname: 'Đã track', avatar_url: '', avatar_drive_url: '', followers_count: 1000n },
    ]);

    const result = await service.lookalikes(1n);

    expect(result.lookalikes).toHaveLength(1);
    expect(result.lookalikes[0].username).toBe('kenh_da_track');
    expect(result.lookalikes[0].sec_user_id).toBe('sec123');
  });
});

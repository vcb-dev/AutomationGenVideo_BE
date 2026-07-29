import { TiktokScraperService } from './tiktok-scraper.service';
import { ParsedTikTokVideo } from './tiktok-ai-client.service';
import { KuaishouScraperService } from '../kuaishou-scraper/kuaishou-scraper.service';
import { ParsedKuaishouSearchVideo } from '../kuaishou-scraper/kuaishou-ai-client.service';
import { XiaohongshuScraperService } from '../xiaohongshu-scraper/xiaohongshu-scraper.service';
import { ParsedXhsVideo } from '../xiaohongshu-scraper/xiaohongshu-ai-client.service';

/**
 * Auto-discover kênh mới từ kết quả search từ khoá (TikTok là bản tham chiếu —
 * xem plan "Tự động khám phá + cào kênh mới từ kết quả search từ khoá").
 *
 * Business rule: sau khi ingest video xong, gom tác giả xuất hiện trong lần
 * search này, lọc theo ngưỡng, lấy top MAX_AUTO_DISCOVER_PER_SEARCH tác giả
 * chưa có profile trong DB, rồi dispatch scrapeProfile() fire-and-forget
 * (không chặn response search). Profile tạo ra PHẢI có is_tracked=false (như
 * thêm profile thủ công) — quyết định sản phẩm đã chốt, tránh cron phình to +
 * chi phí TikHub tăng vĩnh viễn.
 */
function buildVideo(overrides: Partial<ParsedTikTokVideo>): ParsedTikTokVideo {
  return {
    post_id: overrides.post_id || Math.random().toString(),
    shortcode: '',
    url: '',
    description: '',
    hashtags: [],
    thumbnail_url: '',
    video_duration: 0,
    region: 'VN',
    author_id: '',
    author_username: '',
    author_display_name: '',
    author_avatar: '',
    author_url: '',
    author_followers: 0,
    author_is_verified: false,
    play_count: 0,
    digg_count: 0,
    comment_count: 0,
    share_count: 0,
    collect_count: 0,
    music_title: '',
    music_author: '',
    search_keyword: '',
    date_posted: new Date().toISOString(),
    ...overrides,
  };
}

describe('TiktokScraperService.searchKeyword — auto-discover kênh mới', () => {
  function build(existingUsernames: string[] = []) {
    const prisma: any = {
      scraperTikTokVideo: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      scraperTikTokProfile: {
        findMany: jest.fn(async ({ where }: any) => {
          const requested: string[] = where.username.in;
          return requested.filter((u) => existingUsernames.includes(u)).map((username) => ({ username }));
        }),
      },
    };
    const aiClient: any = { fetchSearch: jest.fn() };
    const notifications: any = { broadcastToActiveUsers: jest.fn() };
    const readService: any = { keywordSuggest: jest.fn() };
    const service = new TiktokScraperService(prisma, aiClient, notifications, readService);
    return { service, prisma, aiClient, notifications, readService };
  }

  afterEach(() => jest.clearAllMocks());

  it('chỉ dispatch scrapeProfile cho tác giả đạt ngưỡng followers, bỏ tác giả dưới ngưỡng', async () => {
    const { service, aiClient } = build();
    aiClient.fetchSearch.mockResolvedValueOnce({
      videos: [
        buildVideo({ post_id: '1', author_username: 'big_channel', author_followers: 10000 }),
        buildVideo({ post_id: '2', author_username: 'tiny_channel', author_followers: 10 }),
      ],
      cursor: 0,
      has_more: false,
    });
    const scrapeSpy = jest.spyOn(service, 'scrapeProfile').mockResolvedValue(undefined);

    const result = await service.searchKeyword('kw', 30, 'VN');

    expect(result.auto_discovered).toEqual(['big_channel']);
    expect(scrapeSpy).toHaveBeenCalledWith('big_channel');
    expect(scrapeSpy).not.toHaveBeenCalledWith('tiny_channel');
  });

  it('giới hạn tối đa 5 tác giả mới mỗi lần search dù kết quả có nhiều hơn', async () => {
    const { service, aiClient } = build();
    const videos = Array.from({ length: 8 }, (_, i) =>
      buildVideo({ post_id: `v${i}`, author_username: `channel_${i}`, author_followers: 10000 + i }),
    );
    aiClient.fetchSearch.mockResolvedValueOnce({ videos, cursor: 0, has_more: false });
    const scrapeSpy = jest.spyOn(service, 'scrapeProfile').mockResolvedValue(undefined);

    const result = await service.searchKeyword('kw', 30, 'VN');

    expect(result.auto_discovered).toHaveLength(5);
    // Top 5 theo followers cao nhất (channel_7..channel_3)
    expect(result.auto_discovered).toEqual(['channel_7', 'channel_6', 'channel_5', 'channel_4', 'channel_3']);
    expect(scrapeSpy).toHaveBeenCalledTimes(5);
  });

  it('không dispatch lại tác giả đã có profile trong DB', async () => {
    const { service, aiClient } = build(['already_tracked']);
    aiClient.fetchSearch.mockResolvedValueOnce({
      videos: [buildVideo({ post_id: '1', author_username: 'already_tracked', author_followers: 50000 })],
      cursor: 0,
      has_more: false,
    });
    const scrapeSpy = jest.spyOn(service, 'scrapeProfile').mockResolvedValue(undefined);

    const result = await service.searchKeyword('kw', 30, 'VN');

    expect(result.auto_discovered).toEqual([]);
    expect(scrapeSpy).not.toHaveBeenCalled();
  });

  it('searchKeyword KHÔNG chờ scrapeProfile hoàn tất (fire-and-forget, không chặn response)', async () => {
    const { service, aiClient } = build();
    aiClient.fetchSearch.mockResolvedValueOnce({
      videos: [buildVideo({ post_id: '1', author_username: 'slow_channel', author_followers: 50000 })],
      cursor: 0,
      has_more: false,
    });
    let resolveScrape!: () => void;
    const pending = new Promise<void>((resolve) => { resolveScrape = resolve; });
    jest.spyOn(service, 'scrapeProfile').mockReturnValue(pending as any);

    // searchKeyword phải resolve dù scrapeProfile('slow_channel') còn treo — nếu bị await
    // nhầm thì test này sẽ timeout thay vì pass.
    await expect(service.searchKeyword('kw', 30, 'VN')).resolves.toBeDefined();
    resolveScrape();
  });
});

describe('KuaishouScraperService.searchKeyword — auto-discover: lọc author_eid rỗng', () => {
  it('bỏ qua tác giả không parse được author_eid, không gọi scrapeProfile("")', async () => {
    const prisma: any = {
      scraperKuaishouSearchVideo: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      scraperKuaishouProfile: {
        findMany: jest.fn(async () => []),
      },
    };
    const aiClient: any = {
      fetchSearch: jest.fn().mockResolvedValueOnce({
        videos: [
          { post_id: '1', author_eid: '', view_count: 999999 } as Partial<ParsedKuaishouSearchVideo>,
          { post_id: '2', author_eid: 'real_eid', view_count: 20000 } as Partial<ParsedKuaishouSearchVideo>,
        ],
        cursor: null,
        has_more: false,
      }),
    };
    const notifications: any = { broadcastToActiveUsers: jest.fn() };
    const readService: any = { keywordSuggest: jest.fn() };
    const aiIntegration: any = { translateSearchKeyword: jest.fn() };
    const service = new KuaishouScraperService(prisma, aiClient, notifications, readService, aiIntegration);
    const scrapeSpy = jest.spyOn(service, 'scrapeProfile').mockResolvedValue(undefined);

    const result = await service.searchKeyword('kw', 30);

    expect(scrapeSpy).not.toHaveBeenCalledWith('');
    expect(result.auto_discovered).toEqual(['real_eid']);
  });
});

describe('TiktokScraperService — Growth Alert (recordMetricsAndMaybeAlert)', () => {
  function build(previousFollowers: bigint | null, freshFollowers: bigint) {
    const created: any[] = [];
    const prisma: any = {
      scraperTikTokProfile: {
        findUniqueOrThrow: jest.fn(async () => ({
          followers_count: freshFollowers,
          following_count: 0n,
          likes_count: 0n,
        })),
      },
      scraperTikTokProfileMetrics: {
        findFirst: jest.fn(async () =>
          previousFollowers === null ? null : { followers_count: previousFollowers },
        ),
        create: jest.fn(async ({ data }: any) => { created.push(data); return data; }),
      },
    };
    const notifications: any = { broadcastToActiveUsers: jest.fn() };
    const readService: any = { keywordSuggest: jest.fn() };
    const service = new TiktokScraperService(prisma, {} as any, notifications, readService);
    return { service, notifications, created };
  }

  it('báo động khi followers tăng >= 20% so với snapshot trước', async () => {
    const { service, notifications } = build(1000n, 1300n); // +30%
    await (service as any).recordMetricsAndMaybeAlert(1n, 'kenh_a');

    expect(notifications.broadcastToActiveUsers).toHaveBeenCalledTimes(1);
    const [type, title] = notifications.broadcastToActiveUsers.mock.calls[0];
    expect(type).toBe('GROWTH_ALERT');
    expect(title).toContain('kenh_a');
  });

  it('KHÔNG báo động khi mức tăng dưới ngưỡng 20%', async () => {
    const { service, notifications } = build(1000n, 1100n); // +10%
    await (service as any).recordMetricsAndMaybeAlert(1n, 'kenh_b');

    expect(notifications.broadcastToActiveUsers).not.toHaveBeenCalled();
  });

  it('KHÔNG báo động ở lần cào đầu tiên (chưa có snapshot trước đó)', async () => {
    const { service, notifications } = build(null, 5000n);
    await (service as any).recordMetricsAndMaybeAlert(1n, 'kenh_c');

    expect(notifications.broadcastToActiveUsers).not.toHaveBeenCalled();
  });

  it('luôn ghi snapshot mới bất kể có vượt ngưỡng báo động hay không', async () => {
    const { service, created } = build(1000n, 1010n); // +1%, không đủ ngưỡng
    await (service as any).recordMetricsAndMaybeAlert(1n, 'kenh_d');

    expect(created).toHaveLength(1);
    expect(created[0].followers_count).toBe(1010n);
  });
});

describe('XiaohongshuScraperService.searchKeyword — auto-discover: is_tracked mặc định false', () => {
  it('gọi scrapeProfile(userId, false, false) — ép is_tracked=false dù schema default của model này là true', async () => {
    const prisma: any = {
      scraperXiaohongshuVideo: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      scraperXiaohongshuProfile: {
        findMany: jest.fn(async () => []),
      },
    };
    const aiClient: any = {
      fetchSearch: jest.fn().mockResolvedValueOnce({
        videos: [{ note_id: 'n1', author_id: 'user_new', liked_count: 1000 } as Partial<ParsedXhsVideo>],
        cursor: undefined,
        has_more: false,
      }),
    };
    const readService: any = { keywordSuggest: jest.fn() };
    const aiIntegration: any = { translateSearchKeyword: jest.fn() };
    const service = new XiaohongshuScraperService(prisma, aiClient, readService, aiIntegration);
    const scrapeSpy = jest.spyOn(service, 'scrapeProfile').mockResolvedValue(undefined);

    const result = await service.searchKeyword('kw', 20);

    expect(result.auto_discovered).toEqual(['user_new']);
    expect(scrapeSpy).toHaveBeenCalledWith('user_new', false, false);
  });
});

/**
 * Auto Re-run Saved Keyword — cron riêng gọi lại searchKeyword() thủ công cho
 * top từ khoá đã search nhiều nhất (tái dùng keywordSuggest('') sẵn có), có
 * floor (bỏ từ khoá tìm 1 lần rồi bỏ) + cap (kiểm soát chi phí TikHub dồn từ
 * auto-discover bên trong searchKeyword()).
 */
describe('TiktokScraperService.autoRerunTopKeywords', () => {
  function build() {
    const readService: any = { keywordSuggest: jest.fn() };
    const notifications: any = { broadcastToActiveUsers: jest.fn() };
    const service = new TiktokScraperService({} as any, {} as any, notifications, readService);
    return { service, readService };
  }

  afterEach(() => jest.clearAllMocks());

  it('chỉ rerun từ khoá đạt floor hit-count (MIN_HIT_COUNT_FOR_AUTO_RERUN), bỏ từ khoá dưới ngưỡng', async () => {
    const { service, readService } = build();
    readService.keywordSuggest.mockResolvedValueOnce({
      suggestions: [
        { keyword: 'pho mai', count: 10 },
        { keyword: 'tim 1 lan', count: 1 },
      ],
    });
    const searchSpy = jest.spyOn(service, 'searchKeyword').mockResolvedValue({ created: 0, updated: 0, auto_discovered: [] });

    const result = await service.autoRerunTopKeywords();

    expect(result.keywords).toEqual(['pho mai']);
    expect(searchSpy).toHaveBeenCalledWith('pho mai');
    expect(searchSpy).not.toHaveBeenCalledWith('tim 1 lan');
  });

  it('giới hạn tối đa MAX_AUTO_RERUN_KEYWORDS_PER_CRON từ khoá mỗi lần chạy', async () => {
    const { service, readService } = build();
    readService.keywordSuggest.mockResolvedValueOnce({
      suggestions: Array.from({ length: 6 }, (_, i) => ({ keyword: `kw${i}`, count: 20 - i })),
    });
    const searchSpy = jest.spyOn(service, 'searchKeyword').mockResolvedValue({ created: 0, updated: 0, auto_discovered: [] });

    const result = await service.autoRerunTopKeywords();

    expect(result.keywords).toHaveLength(3);
    expect(searchSpy).toHaveBeenCalledTimes(3);
  });

  it('cộng dồn created/updated từ tất cả từ khoá đã rerun', async () => {
    const { service, readService } = build();
    readService.keywordSuggest.mockResolvedValueOnce({
      suggestions: [{ keyword: 'a', count: 10 }, { keyword: 'b', count: 5 }],
    });
    jest.spyOn(service, 'searchKeyword')
      .mockResolvedValueOnce({ created: 3, updated: 1, auto_discovered: [] })
      .mockResolvedValueOnce({ created: 2, updated: 4, auto_discovered: [] });

    const result = await service.autoRerunTopKeywords();

    expect(result.created).toBe(5);
    expect(result.updated).toBe(5);
  });

  it('1 từ khoá lỗi không chặn các từ khoá còn lại', async () => {
    const { service, readService } = build();
    readService.keywordSuggest.mockResolvedValueOnce({
      suggestions: [{ keyword: 'loi', count: 10 }, { keyword: 'ok', count: 5 }],
    });
    jest.spyOn(service, 'searchKeyword')
      .mockRejectedValueOnce(new Error('TikHub timeout'))
      .mockResolvedValueOnce({ created: 1, updated: 0, auto_discovered: [] });

    const result = await service.autoRerunTopKeywords();

    expect(result.keywords).toEqual(['loi', 'ok']);
    expect(result.created).toBe(1);
  });
});

describe('XiaohongshuScraperService.autoRerunTopKeywords — keywordSuggest trả array trực tiếp', () => {
  it('xử lý đúng shape khác biệt (không phải {suggestions: [...]} như 4 platform còn lại)', async () => {
    const readService: any = {
      keywordSuggest: jest.fn().mockResolvedValueOnce([
        { keyword: 'lam dep', count: 8 },
        { keyword: 'mot lan', count: 1 },
      ]),
    };
    // Từ khoá lưu trong DB là tiếng Việt → cron phải dịch sang tiếng Trung để query,
    // nhưng vẫn truyền tiếng Việt gốc làm displayKeyword để lần lưu sau đọc được.
    const aiIntegration: any = {
      translateSearchKeyword: jest.fn().mockResolvedValue({
        original: 'lam dep',
        translated: '美容',
        source: 'test',
      }),
    };
    const service = new XiaohongshuScraperService({} as any, {} as any, readService, aiIntegration);
    const searchSpy = jest.spyOn(service, 'searchKeyword').mockResolvedValue({ created: 0, updated: 0, auto_discovered: [] });

    const result = await service.autoRerunTopKeywords();

    expect(result.keywords).toEqual(['lam dep']);
    expect(aiIntegration.translateSearchKeyword).toHaveBeenCalledWith('lam dep');
    expect(searchSpy).toHaveBeenCalledWith('美容', 20, 'lam dep');
  });
});

import { extractYoutubeVideoId } from '../youtube-url.util';
import { YoutubeVideoStatsService } from '../youtube-video-stats.service';
import { TaskPublishedLinkStatsService, isLinkStatsFresh, LINK_STATS_FRESH_MS } from '../task-published-link-stats.service';
import {
  classifyPublishedLinksWinFail,
  pickWinningLink,
  summarizeWinFailCounts,
  VIEW_WIN_THRESHOLD,
} from '../published-link-win-fail.util';

// Thống kê traffic link đã đăng để tính win/fail: parse ID → gọi API theo platform → phân loại win/fail (>10.000 view).

function fbLink(views: number, status: 'success' | 'failed' | 'unsupported' = 'success') {
  return { platform: 'FACEBOOK', stats: { views, status } };
}

function link(platform: string, views: number, status: 'success' | 'failed' | 'unsupported' = 'success') {
  return { platform, stats: { views, status } };
}

describe('extractYoutubeVideoId', () => {
  it('link watch?v= chuẩn', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('link watch?v= kèm query khác (list, t...)', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=30s')).toBe('dQw4w9WgXcQ');
  });

  it('link youtu.be rút gọn', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('link youtu.be kèm query (si=...)', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc123')).toBe('dQw4w9WgXcQ');
  });

  it('link Shorts', () => {
    expect(extractYoutubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });

  it('link embed', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('link m.youtube.com (mobile)', () => {
    expect(extractYoutubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('không phải link YouTube → null', () => {
    expect(extractYoutubeVideoId('https://www.facebook.com/reel/123')).toBeNull();
    expect(extractYoutubeVideoId('https://www.tiktok.com/@x/video/123')).toBeNull();
  });

  it('URL sai định dạng → null, không throw', () => {
    expect(extractYoutubeVideoId('not a url')).toBeNull();
  });

  it('youtube.com nhưng không mang ID nhận diện được → null', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/channel/UC1234567890')).toBeNull();
  });
});

// fetchStatsForUrl() — kéo view/like/comment cho video YouTube công khai bất kỳ qua YouTube Data API v3, không cần connect trước.
describe('YoutubeVideoStatsService.fetchStatsForUrl', () => {
  const ORIGINAL_ENV = process.env.YOUTUBE_API_KEY;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    process.env.YOUTUBE_API_KEY = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  it('thiếu YOUTUBE_API_KEY → unsupported, không gọi API', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result).toEqual({ status: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL không nhận diện được video ID → unsupported, không gọi API', async () => {
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/channel/UC123');

    expect(result).toEqual({ status: 'unsupported' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gọi API thành công → trả đúng views/likes/comments, gọi đúng endpoint + video ID + key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ statistics: { viewCount: '12345', likeCount: '678', commentCount: '90' } }] }),
    });
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result).toEqual({ status: 'success', views: 12345, likes: 678, comments: 90 });
    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(calledUrl.searchParams.get('id')).toBe('dQw4w9WgXcQ');
    expect(calledUrl.searchParams.get('key')).toBe('test-key');
    expect(calledUrl.searchParams.get('part')).toBe('statistics');
  });

  it('video không tồn tại (items rỗng) → failed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/watch?v=deleted123');

    expect(result.status).toBe('failed');
  });

  it('API trả lỗi HTTP (vd key sai/quota hết) → failed, không throw', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'quotaExceeded' });
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('403');
  });

  it('fetch throw exception (lỗi mạng) → failed, không throw ra ngoài', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = new YoutubeVideoStatsService();

    const result = await service.fetchStatsForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result).toEqual({ status: 'failed', error: 'network down' });
  });

  it('link youtu.be rút gọn vẫn nhận diện được video ID', async () => {
    // youtu.be nằm trong SHORT_LINK_HOSTS nên resolveShortLink() cũng tự gọi fetch() 1 lần trước
    // (để follow redirect) — cả 2 lần gọi đều đi qua cùng 1 fetchMock, nên phải lọc đúng lệnh gọi
    // tới googleapis.com thay vì giả định gọi đầu tiên là gọi YouTube Data API.
    fetchMock.mockResolvedValue({
      ok: true,
      url: 'https://youtu.be/dQw4w9WgXcQ',
      json: async () => ({ items: [{ statistics: { viewCount: '1', likeCount: '0', commentCount: '0' } }] }),
    });
    const service = new YoutubeVideoStatsService();

    await service.fetchStatsForUrl('https://youtu.be/dQw4w9WgXcQ');

    const apiCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes('googleapis.com'));
    expect(apiCall).toBeDefined();
    const calledUrl = new URL(apiCall![0]);
    expect(calledUrl.searchParams.get('id')).toBe('dQw4w9WgXcQ');
  });
});

// Dispatcher theo platform — chỉ route đúng service; platform chưa hỗ trợ luôn trả "unsupported".
describe('TaskPublishedLinkStatsService.fetchStatsForLink', () => {
  function build() {
    const facebookOwnedPages: any = { fetchStatsForUrl: jest.fn() };
    const youtubeVideoStats: any = { fetchStatsForUrl: jest.fn() };
    const instagramOwnedAccounts: any = { fetchStatsForUrl: jest.fn() };
    const service = new TaskPublishedLinkStatsService(facebookOwnedPages, youtubeVideoStats, instagramOwnedAccounts);
    return { service, facebookOwnedPages, youtubeVideoStats, instagramOwnedAccounts };
  }

  it('platform không phải Facebook/Instagram/YouTube → unsupported, không gọi service nào', async () => {
    const { service, facebookOwnedPages, youtubeVideoStats, instagramOwnedAccounts } = build();

    const result = await service.fetchStatsForLink('TikTok', 'https://tiktok.com/x');

    expect(result.status).toBe('unsupported');
    expect(facebookOwnedPages.fetchStatsForUrl).not.toHaveBeenCalled();
    expect(youtubeVideoStats.fetchStatsForUrl).not.toHaveBeenCalled();
    expect(instagramOwnedAccounts.fetchStatsForUrl).not.toHaveBeenCalled();
  });

  it('platform Facebook (không phân biệt hoa/thường) → route sang facebookOwnedPages', async () => {
    const { service, facebookOwnedPages } = build();
    facebookOwnedPages.fetchStatsForUrl.mockResolvedValue({ status: 'success', views: 100, likes: 2, comments: 3, shares: 4 });

    const result = await service.fetchStatsForLink('facebook', 'https://facebook.com/reel/1');

    expect(facebookOwnedPages.fetchStatsForUrl).toHaveBeenCalledWith('https://facebook.com/reel/1');
    expect(result).toEqual(expect.objectContaining({ status: 'success', views: 100, likes: 2, comments: 3, shares: 4 }));
  });

  it('platform YouTube → route sang youtubeVideoStats, shares luôn 0 (API không có field này)', async () => {
    const { service, youtubeVideoStats } = build();
    youtubeVideoStats.fetchStatsForUrl.mockResolvedValue({ status: 'success', views: 500, likes: 10, comments: 1 });

    const result = await service.fetchStatsForLink('YouTube', 'https://youtube.com/watch?v=x');

    expect(youtubeVideoStats.fetchStatsForUrl).toHaveBeenCalledWith('https://youtube.com/watch?v=x');
    expect(result).toEqual(expect.objectContaining({ status: 'success', views: 500, likes: 10, comments: 1, shares: 0 }));
  });

  it('YouTube trả failed → giữ nguyên status + error, không throw', async () => {
    const { service, youtubeVideoStats } = build();
    youtubeVideoStats.fetchStatsForUrl.mockResolvedValue({ status: 'failed', error: 'quota hết' });

    const result = await service.fetchStatsForLink('YOUTUBE', 'https://youtube.com/watch?v=x');

    expect(result).toEqual(expect.objectContaining({ status: 'failed', error: 'quota hết', views: 0 }));
  });

  it('service con throw exception → dispatcher bắt lại, trả failed thay vì crash', async () => {
    const { service, youtubeVideoStats } = build();
    youtubeVideoStats.fetchStatsForUrl.mockRejectedValue(new Error('boom'));

    const result = await service.fetchStatsForLink('YouTube', 'https://youtube.com/watch?v=x');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('boom');
  });

  it('platform Instagram (không phân biệt hoa/thường) → route sang instagramOwnedAccounts, shares luôn 0 (Graph API không có field này)', async () => {
    const { service, instagramOwnedAccounts } = build();
    instagramOwnedAccounts.fetchStatsForUrl.mockResolvedValue({ status: 'success', views: 800, likes: 20, comments: 5 });

    const result = await service.fetchStatsForLink('instagram', 'https://www.instagram.com/reel/ABC123/');

    expect(instagramOwnedAccounts.fetchStatsForUrl).toHaveBeenCalledWith('https://www.instagram.com/reel/ABC123/');
    expect(result).toEqual(expect.objectContaining({ status: 'success', views: 800, likes: 20, comments: 5, shares: 0 }));
  });

  it('Instagram trả unsupported (kênh chưa kết nối) → giữ nguyên status, không throw', async () => {
    const { service, instagramOwnedAccounts } = build();
    instagramOwnedAccounts.fetchStatsForUrl.mockResolvedValue({ status: 'unsupported' });

    const result = await service.fetchStatsForLink('INSTAGRAM', 'https://www.instagram.com/reel/ABC123/');

    expect(result).toEqual(expect.objectContaining({ status: 'unsupported', views: 0 }));
  });
});

// isLinkStatsFresh() — bỏ qua link vừa cào gần đây, tránh dội API Facebook/YouTube khi duyệt qua nhiều người.
describe('isLinkStatsFresh', () => {
  it('chưa từng cào (không có stats/fetched_at) → không mới, cần cào', () => {
    expect(isLinkStatsFresh(null)).toBe(false);
    expect(isLinkStatsFresh(undefined)).toBe(false);
    expect(isLinkStatsFresh({})).toBe(false);
  });

  it('fetched_at trong ngưỡng LINK_STATS_FRESH_MS → còn mới, khỏi cào lại', () => {
    const now = new Date('2026-08-25T10:00:00.000Z');
    const fetched_at = new Date(now.getTime() - LINK_STATS_FRESH_MS / 2).toISOString();
    expect(isLinkStatsFresh({ fetched_at }, now)).toBe(true);
  });

  it('fetched_at vượt ngưỡng LINK_STATS_FRESH_MS → hết mới, cần cào lại', () => {
    const now = new Date('2026-08-25T10:00:00.000Z');
    const fetched_at = new Date(now.getTime() - LINK_STATS_FRESH_MS - 1).toISOString();
    expect(isLinkStatsFresh({ fetched_at }, now)).toBe(false);
  });

  it('fetched_at là chuỗi không hợp lệ → coi như chưa cào, cần cào lại', () => {
    expect(isLinkStatsFresh({ fetched_at: 'not-a-date' })).toBe(false);
  });
});

describe('classifyPublishedLinksWinFail', () => {
  it('win khi có 1 link cào thành công > ngưỡng — trả về view của link cao nhất', () => {
    expect(classifyPublishedLinksWinFail([fbLink(12000)])).toEqual({
      status: 'win',
      views: 12000,
    });
  });

  it('biên: đúng ngưỡng (10000) là fail, ngưỡng + 1 là win', () => {
    expect(classifyPublishedLinksWinFail([fbLink(VIEW_WIN_THRESHOLD)]).status).toBe('fail');
    expect(classifyPublishedLinksWinFail([fbLink(VIEW_WIN_THRESHOLD + 1)]).status).toBe('win');
  });

  it('pending khi không có link nào', () => {
    expect(classifyPublishedLinksWinFail([])).toEqual({ status: 'pending', views: 0 });
    expect(classifyPublishedLinksWinFail(null)).toEqual({ status: 'pending', views: 0 });
    expect(classifyPublishedLinksWinFail(undefined)).toEqual({ status: 'pending', views: 0 });
  });

  it('pending khi có link nhưng chưa có stats (chưa fetch)', () => {
    expect(classifyPublishedLinksWinFail([{ platform: 'FACEBOOK' }]).status).toBe('pending');
  });

  it('pending khi fetch lỗi (failed)', () => {
    expect(classifyPublishedLinksWinFail([fbLink(99999, 'failed')]).status).toBe('pending');
  });

  it('pending khi unsupported', () => {
    expect(classifyPublishedLinksWinFail([fbLink(99999, 'unsupported')]).status).toBe('pending');
  });

  it('KHÔNG cộng dồn nhiều link — nhiều link nhỏ cộng lại vượt ngưỡng vẫn là fail', () => {
    const result = classifyPublishedLinksWinFail([
      fbLink(6000, 'success'),
      fbLink(5000, 'success'),
      fbLink(999999, 'failed'),
    ]);
    expect(result).toEqual({ status: 'fail', views: 6000 });
  });

  it('win nếu 1 trong nhiều link vượt ngưỡng (view trả về = link cao nhất)', () => {
    const result = classifyPublishedLinksWinFail([
      fbLink(2000, 'success'),
      fbLink(12000, 'success'),
      fbLink(999999, 'failed'),
    ]);
    expect(result).toEqual({ status: 'win', views: 12000 });
  });

  it('xét mọi nền tảng đã cào thành công, không chỉ Facebook', () => {
    expect(classifyPublishedLinksWinFail([link('YOUTUBE', 12000)])).toEqual({ status: 'win', views: 12000 });
    expect(classifyPublishedLinksWinFail([link('INSTAGRAM', 12000)])).toEqual({ status: 'win', views: 12000 });
    // link Facebook 1000 view + link YouTube 12000 view → win nhờ link YouTube.
    expect(
      classifyPublishedLinksWinFail([fbLink(1000), link('YOUTUBE', 12000)]),
    ).toEqual({ status: 'win', views: 12000 });
  });

  it('nền tảng chưa hỗ trợ cào (stats không "success") không kéo thành win/fail', () => {
    expect(
      classifyPublishedLinksWinFail([{ platform: 'TIKTOK', stats: { views: 999999, status: 'unsupported' } }]).status,
    ).toBe('pending');
  });
});

describe('pickWinningLink', () => {
  const l = (platform: string, views: number, url: string, status: 'success' | 'failed' | 'unsupported' = 'success') => ({
    platform,
    url,
    stats: { views, status },
  });

  it('trả về link có view CAO NHẤT khi view đó > ngưỡng (url + platform chuẩn hoá + views)', () => {
    expect(
      pickWinningLink([l('FACEBOOK', 3000, 'https://fb/a'), l('YouTube', 12000, 'https://yt/b')]),
    ).toEqual({ url: 'https://yt/b', platform: 'YOUTUBE', views: 12000 });
  });

  it('không link nào > ngưỡng (kể cả đúng ngưỡng) → null', () => {
    expect(pickWinningLink([l('FACEBOOK', VIEW_WIN_THRESHOLD, 'https://fb/a')])).toBeNull();
  });

  it('bỏ qua link chưa cào thành công', () => {
    expect(
      pickWinningLink([l('FACEBOOK', 999999, 'https://fb/a', 'failed'), l('FACEBOOK', 11000, 'https://fb/b')]),
    ).toEqual({ url: 'https://fb/b', platform: 'FACEBOOK', views: 11000 });
  });

  it('rỗng / null / undefined → null', () => {
    expect(pickWinningLink([])).toBeNull();
    expect(pickWinningLink(null)).toBeNull();
    expect(pickWinningLink(undefined)).toBeNull();
  });

  it('trim url + upper-case platform', () => {
    expect(
      pickWinningLink([{ platform: '  youtube ', url: '  https://yt/x  ', stats: { views: 20000, status: 'success' } }]),
    ).toEqual({ url: 'https://yt/x', platform: 'YOUTUBE', views: 20000 });
  });
});

describe('summarizeWinFailCounts', () => {
  it('đếm đúng từng loại', () => {
    expect(summarizeWinFailCounts(['win', 'win', 'fail', 'pending', 'pending', 'pending'])).toEqual({
      win: 2,
      fail: 1,
      pending: 3,
    });
  });

  it('mảng rỗng trả về 0 cho cả 3', () => {
    expect(summarizeWinFailCounts([])).toEqual({ win: 0, fail: 0, pending: 0 });
  });
});

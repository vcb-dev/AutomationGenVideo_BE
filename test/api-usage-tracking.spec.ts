import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { HttpService } from '@nestjs/axios';
import {
  buildUsageRows,
  pageFromClientPath,
  parseUsageHeader,
  recordUsageFromResponse,
  resolveFeature,
  resolvePage,
  resolvePlatform,
  setUsageSink,
  trackAiUsage,
  trackFetchUsage,
  untrackFetchUsage,
  UsageRow,
} from '../src/common/api-usage/api-usage-tracking';
import { requestContextMiddleware, runWithUsageTag } from '../src/common/api-usage/request-context';
import { ApiUsageRecorder } from '../src/common/api-usage/api-usage.module';

/**
 * Chốt chung ghi chi phí TikHub/Gemini của MỌI lượt BE gọi AI service (menu Khám phá Video).
 * AI gửi chi phí của từng request qua header X-Api-Usage; interceptor trên mọi bản axios ghép với
 * ngữ cảnh bên BE (người bấm, trang FE gửi qua X-Client-Page, route) rồi ghi vào api_usage_logs.
 */
const USER = '11111111-1111-4111-8111-111111111111';
const TIKTOK_POSTS = { provider: 'tikhub', endpoint: '/api/v1/tiktok/app/v3/fetch_user_post_videos', cached: false, status: 200, calls: 3, cost_usd: 0.003, input_tokens: 0, output_tokens: 0 };

function fakeAdapter(status: number, usage: unknown[] | null) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response = {
      data: { ok: status < 400 }, status, statusText: String(status), config, request: {},
      headers: usage ? { 'x-api-usage': JSON.stringify(usage) } : {},
    } as AxiosResponse;
    if (status >= 400) throw new AxiosError('AI lỗi', 'ERR_BAD_RESPONSE', config, {}, response);
    return response;
  };
}

function aiClient(status = 200, usage: unknown[] | null = [TIKTOK_POSTS]): AxiosInstance {
  const instance = axios.create({ adapter: fakeAdapter(status, usage) as any });
  trackAiUsage(instance);
  return instance;
}

/** Chạy fn như đang ở trong một request BE (đi qua requestContextMiddleware). */
function inRequest<T>(req: any, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => requestContextMiddleware(req, {} as any, () => { fn().then(resolve, reject); }));
}

const req = (over: Record<string, any> = {}) => ({
  method: 'POST', originalUrl: '/api/scraper/tiktok/profiles/9/scrape?force=1',
  headers: { 'x-client-page': '/dashboard/internalChannels' }, user: { id: USER }, ...over,
});

let rows: UsageRow[] = [];
beforeEach(() => {
  rows = [];
  setUsageSink(async (r) => { rows.push(...r); });
});
afterEach(() => setUsageSink(null));

describe('Đọc header chi phí AI gửi về', () => {
  it('header hợp lệ → danh sách lượt gọi; hỏng/lạ → bỏ qua, không ném', () => {
    expect(parseUsageHeader(JSON.stringify([TIKTOK_POSTS]))).toHaveLength(1);
    expect(parseUsageHeader('{không phải json')).toEqual([]);
    expect(parseUsageHeader(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseUsageHeader(JSON.stringify([{ provider: 'tikhub' }]))).toEqual([]); // thiếu endpoint
    expect(parseUsageHeader(undefined)).toEqual([]);
  });
});

describe('Xếp lượt gọi vào trang của menu Khám phá Video', () => {
  it.each([
    ['/dashboard/search-video', 'SEARCH'],
    ['/dashboard/ai/search', 'SEARCH'],
    ['/dashboard/internalChannels', 'INTERNAL_CHANNELS'],
    ['/dashboard/internalOverview', 'INTERNAL_CHANNELS'],
    ['/dashboard/externalChannels/tiktok', 'EXTERNAL_CHANNELS'],
    ['/dashboard/video-library?tab=content', 'COLLECTION'],
    ['/dashboard/ai/content-transform', null],
    [null, null],
  ])('trang FE %s → %s', (path, page) => {
    expect(pageFromClientPath(path)).toBe(page);
  });

  const base = { aiPath: '/api/scraper/tiktok/fetch/profile-posts/', requestRoute: 'POST /api/scraper/tiktok/profiles/9/scrape', clientPage: null, userId: USER, hasRequest: true };

  it('kênh nội bộ và khám phá kênh gọi CÙNG endpoint vẫn tách được nhờ trang FE', () => {
    expect(resolvePage({ ...base, clientPage: '/dashboard/internalChannels' })).toBe('INTERNAL_CHANNELS');
    expect(resolvePage({ ...base, clientPage: '/dashboard/externalChannels/tiktok' })).toBe('EXTERNAL_CHANNELS');
  });

  it('nhãn của code thắng trang FE; không có trang thì đoán theo route BE', () => {
    expect(resolvePage({ ...base, clientPage: '/dashboard/search-video', tag: { page: 'COLLECTION' } })).toBe('COLLECTION');
    expect(resolvePage({ ...base, requestRoute: 'POST /api/video-library/proposals' })).toBe('COLLECTION');
    expect(resolvePage({ ...base, requestRoute: 'POST /api/ai/search' })).toBe('SEARCH');
  });

  it('cron (không có request): chỉ tính vào Khám phá Video khi gọi endpoint cào/tìm kiếm', () => {
    expect(resolvePage({ ...base, requestRoute: null, userId: null, hasRequest: false })).toBe('AUTO');
    expect(resolvePage({ ...base, aiPath: '/api/content/transcribe-upload/', requestRoute: null, hasRequest: false })).toBe('OTHER');
  });

  it('request từ trang ngoài menu → OTHER (không cộng vào chi phí Khám phá Video)', () => {
    expect(resolvePage({ ...base, requestRoute: 'POST /api/social-publishing/sync', clientPage: '/dashboard/posts' })).toBe('OTHER');
  });
});

describe('Bước tốn chi phí và nền tảng', () => {
  it.each([
    ['/api/scraper/tiktok/fetch/profile-posts/', 'TIKHUB', undefined, 'CHANNEL_SYNC'],
    ['/api/scraper/fanpages/fetch/reels/', 'TIKHUB', undefined, 'CHANNEL_SYNC'],
    ['/api/scraper/douyin/fetch/resolve-video-author/', 'TIKHUB', undefined, 'CHANNEL_SYNC'],
    ['/api/scraper/threads/fetch/search-top/', 'TIKHUB', undefined, 'PLATFORM_SEARCH'],
    ['/api/search/', 'TIKHUB', undefined, 'SEARCH'],
    ['/api/search/user-videos/', 'TIKHUB', undefined, 'CHANNEL_VIDEOS'],
    ['/api/scraper/video-detail/', 'TIKHUB', undefined, 'VIDEO_DETAIL'],
    ['/api/scraper/play-url/', 'TIKHUB', undefined, 'PLAY_URL'],
    ['/api/channels/check-by-username/', 'TIKHUB', undefined, 'CHANNEL_LOOKUP'],
    ['/api/videos/channel-hashtag-stats/', 'TIKHUB', undefined, 'CHANNEL_LOOKUP'],
    ['/api/scraped-video/script-from-video/', 'GEMINI', undefined, 'SCRIPT_GEMINI'],
    ['/api/scraped-video/script-from-video/', 'TIKHUB', undefined, 'SCRIPT_DOWNLOAD'],
    ['/api/scraper/video-detail/', 'TIKHUB', 'PROPOSAL_DETAIL', 'PROPOSAL_DETAIL'],
    ['/api/x/', 'GEMINI', 'SCRIPT', 'SCRIPT_GEMINI'],
  ])('%s (%s, nhãn %s) → %s', (aiPath, provider, tag, feature) => {
    expect(resolveFeature(aiPath, provider, tag)).toBe(feature);
  });

  it('nền tảng lấy từ nhãn → endpoint TikHub → endpoint AI; fanpages = facebook', () => {
    expect(resolvePlatform('/api/v1/tiktok/app/v3/fetch_user_post_videos', null)).toBe('tiktok');
    expect(resolvePlatform('gemini-3.1-flash-lite', '/api/scraper/fanpages/fetch/reels/')).toBe('facebook');
    expect(resolvePlatform('gemini-3.1-flash-lite', null, 'Douyin')).toBe('douyin');
    expect(resolvePlatform('/api/v1/tikhub/user/get_user_info', null)).toBeNull();
  });

  it('dòng ghi: gộp số lượt, người bấm, nhãn content — người trong nhãn thắng người của request', () => {
    const [row] = buildUsageRows([TIKTOK_POSTS], {
      ...{ aiPath: '/api/scraped-video/script-from-video/', requestRoute: 'POST /api/video-library/direct', clientPage: null, userId: 'u-request', hasRequest: true },
      tag: { page: 'COLLECTION', feature: 'SCRIPT', userId: USER, contentId: 'c1', videoId: 'v1' },
    });
    expect(row).toMatchObject({
      provider: 'TIKHUB', feature: 'SCRIPT_DOWNLOAD', page: 'COLLECTION', platform: 'tiktok', calls: 3, cost_usd: 0.003,
      user_id: USER, approved_content_id: 'c1', video_id: 'v1', ai_path: '/api/scraped-video/script-from-video/',
      request_route: 'POST /api/video-library/direct',
    });
  });
});

describe('Interceptor trên bản axios gọi AI', () => {
  it('lượt gọi trong request → ghi kèm trang FE, người bấm, route (bỏ query)', async () => {
    const client = aiClient();
    await inRequest(req(), () => client.post('http://ai.local/api/scraper/tiktok/fetch/profile-posts/', {}));
    expect(rows).toEqual([expect.objectContaining({
      page: 'INTERNAL_CHANNELS', feature: 'CHANNEL_SYNC', platform: 'tiktok', calls: 3, cost_usd: 0.003,
      user_id: USER, request_route: 'POST /api/scraper/tiktok/profiles/9/scrape',
      ai_path: '/api/scraper/tiktok/fetch/profile-posts/',
    })]);
  });

  it('việc chạy nền sau khi request đã trả lời vẫn giữ ngữ cảnh', async () => {
    const client = aiClient();
    let background!: Promise<unknown>;
    await inRequest(req({ headers: { 'x-client-page': '/dashboard/externalChannels/tiktok' } }), async () => {
      background = new Promise((r) => setTimeout(r, 5)).then(() => client.get('http://ai.local/api/scraper/tiktok/fetch/profile-posts/'));
    });
    await background;
    expect(rows[0]).toMatchObject({ page: 'EXTERNAL_CHANNELS', user_id: USER });
  });

  it('cron gọi AI (không có request) → trang Tự động, không người bấm', async () => {
    await aiClient().get('http://ai.local/api/scraper/tiktok/fetch/profile-posts/');
    expect(rows[0]).toMatchObject({ page: 'AUTO', user_id: null, request_route: null });
  });

  it('nhãn gắn ngoài request (cron của Bộ sưu tập) vẫn được áp', async () => {
    const client = aiClient();
    await runWithUsageTag({ page: 'COLLECTION', feature: 'SCRIPT', contentId: 'c9' }, () =>
      client.post('http://ai.local/api/scraped-video/script-from-video/', {}));
    expect(rows[0]).toMatchObject({ page: 'COLLECTION', feature: 'SCRIPT_DOWNLOAD', approved_content_id: 'c9' });
  });

  it('AI trả lỗi (502) vẫn ghi chi phí đã tốn, lỗi vẫn được ném cho bên gọi', async () => {
    await expect(aiClient(502).post('http://ai.local/api/scraped-video/script-from-video/', {})).rejects.toThrow('AI lỗi');
    expect(rows).toHaveLength(1);
  });

  it('không có header chi phí → không ghi gì; gắn lại interceptor lần nữa không ghi trùng', async () => {
    const client = aiClient(200, null);
    await client.get('http://ai.local/api/health/');
    expect(rows).toEqual([]);
    const twice = aiClient();
    trackAiUsage(twice);
    await twice.get('http://ai.local/api/search/');
    expect(rows).toHaveLength(1);
  });

  it('lưu lỗi / chưa có nơi lưu → lượt gọi AI vẫn bình thường', async () => {
    setUsageSink(async () => { throw new Error('DB mất kết nối'); });
    await expect(aiClient().get('http://ai.local/api/search/')).resolves.toBeDefined();
    setUsageSink(null);
    expect(() => recordUsageFromResponse({ headers: { 'x-api-usage': JSON.stringify([TIKTOK_POSTS]) }, config: {} } as any)).not.toThrow();
  });
});

describe('Module gọi AI bằng fetch (vd tracked-channels)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { untrackFetchUsage(); globalThis.fetch = realFetch; });

  function stubFetch(usage: unknown[] | null) {
    const response = { ok: true, status: 200, headers: { get: (name: string) => (name === 'x-api-usage' && usage ? JSON.stringify(usage) : null) } };
    globalThis.fetch = jest.fn(async () => response) as any;
    return response;
  }

  it('ghi chi phí từ header, trả NGUYÊN đối tượng Response cho bên gọi', async () => {
    const response = stubFetch([TIKTOK_POSTS]);
    trackFetchUsage();
    const got = await inRequest(req({ headers: { 'x-client-page': '/dashboard/externalChannels/tiktok' } }), () =>
      fetch('http://ai.local/api/channels/check-by-username/', { method: 'POST' }));
    expect(got).toBe(response);
    expect(rows).toEqual([expect.objectContaining({ page: 'EXTERNAL_CHANNELS', feature: 'CHANNEL_LOOKUP', user_id: USER, ai_path: '/api/channels/check-by-username/' })]);
  });

  it('fetch THẬT của Node tới một server HTTP thật: đọc header, thân phản hồi vẫn đọc được bình thường', async () => {
    const http = await import('http');
    const server = http.createServer((_q, res) => {
      res.setHeader('x-api-usage', JSON.stringify([TIKTOK_POSTS]));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success: true }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    try {
      trackFetchUsage();
      const res = await inRequest(req(), () => fetch(`http://127.0.0.1:${port}/api/channels/check-by-username/`, { method: 'POST' }));
      expect(await res.json()).toEqual({ success: true });
      expect(rows).toEqual([expect.objectContaining({ page: 'INTERNAL_CHANNELS', feature: 'CHANNEL_LOOKUP', calls: 3 })]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('không có header (gọi dịch vụ khác) → không ghi; bọc lại lần nữa không ghi trùng; gỡ được lớp bọc', async () => {
    stubFetch(null);
    trackFetchUsage();
    await fetch('https://www.facebook.com/x');
    expect(rows).toEqual([]);
    stubFetch([TIKTOK_POSTS]);
    trackFetchUsage();
    trackFetchUsage();
    await fetch(new URL('http://ai.local/api/videos/channel-hashtag-stats/?u=1'));
    expect(rows).toHaveLength(1);
    const stub = (globalThis.fetch as any).original;
    untrackFetchUsage();
    expect(globalThis.fetch).toBe(stub);
  });
});

const SECRET = 'test-jwt-secret';
const config: any = { get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined) };

describe('ApiUsageRecorder — gắn vào mọi bản axios khi app khởi động', () => {
  it('route không gắn guard đăng nhập (vd POST /ai/search): vẫn ghi đúng người nhờ đọc token', async () => {
    const { JwtService } = await import('@nestjs/jwt');
    const token = new JwtService({ secret: SECRET }).sign({ sub: USER });
    const prisma: any = { apiUsageLog: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) } };
    const recorder = new ApiUsageRecorder(prisma, { getProviders: () => [] } as any, config);
    recorder.onApplicationBootstrap();
    const client = aiClient();
    const base = { method: 'POST', originalUrl: '/api/ai/search', headers: { 'x-client-page': '/dashboard/search-video' } as any };

    await inRequest({ ...base, headers: { ...base.headers, authorization: `Bearer ${token}` } }, () => client.post('http://ai.local/api/search/', {}));
    await inRequest({ ...base, cookies: { vcbi_at: token } }, () => client.post('http://ai.local/api/search/', {}));
    await inRequest({ ...base, headers: { ...base.headers, authorization: 'Bearer token-gia' } }, () => client.post('http://ai.local/api/search/', {}));
    await new Promise((r) => setImmediate(r));

    const saved = prisma.apiUsageLog.createMany.mock.calls.map((c: any) => c[0].data[0]);
    expect(saved.map((r: any) => [r.page, r.user_id])).toEqual([['SEARCH', USER], ['SEARCH', USER], ['SEARCH', null]]);
    recorder.onModuleDestroy();
  });

  it('dò HttpService của từng module (bản axios riêng) và lưu vào api_usage_logs', async () => {
    const prisma: any = { apiUsageLog: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) } };
    const http = new HttpService(axios.create({ adapter: fakeAdapter(200, [TIKTOK_POSTS]) as any }));
    const discovery: any = { getProviders: () => [{ instance: http }, { instance: {} }, { instance: null }] };
    const recorder = new ApiUsageRecorder(prisma, discovery, config);
    recorder.onApplicationBootstrap();

    await http.axiosRef.get('http://ai.local/api/search/');
    await new Promise((r) => setImmediate(r));

    expect(prisma.apiUsageLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ feature: 'SEARCH', calls: 3 })] });
    recorder.onModuleDestroy();
  });

  it('ghi DB lỗi chỉ log, không ném', async () => {
    const prisma: any = { apiUsageLog: { createMany: jest.fn(async () => { throw new Error('DB mất kết nối'); }) } };
    const recorder = new ApiUsageRecorder(prisma, { getProviders: () => [] } as any, config);
    await expect(recorder.save(buildUsageRows([TIKTOK_POSTS], { aiPath: null, requestRoute: null, clientPage: null, userId: null, hasRequest: false })))
      .resolves.toBeUndefined();
  });
});

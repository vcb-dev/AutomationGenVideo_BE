import type { AxiosInstance, AxiosResponse } from 'axios';
import type { Request } from 'express';
import { currentUsageContext, UsageTag } from './request-context';

/**
 * Chốt chung ghi chi phí TikHub/Gemini cho MỌI lượt BE gọi AI service.
 *
 * AI đo mọi lượt gọi TikHub/Gemini trong một request rồi gửi về qua header X-Api-Usage. Interceptor
 * gắn trên mọi bản axios của BE đọc header đó, ghép với ngữ cảnh bên BE (người bấm, màn hình FE gửi
 * qua X-Client-Page, route) rồi ghi vào api_usage_logs. Không module nào phải tự ghi.
 */

export const USAGE_HEADER = 'x-api-usage';
export const CLIENT_PAGE_HEADER = 'x-client-page';

/** Trang trong menu Khám phá Video. OTHER = ngoài menu → không cộng vào chi phí Khám phá Video. */
export const COST_PAGE_LABEL: Record<string, string> = {
  SEARCH: 'Tìm kiếm Video',
  INTERNAL_CHANNELS: 'Kênh nội bộ',
  EXTERNAL_CHANNELS: 'Khám phá kênh',
  COLLECTION: 'Bộ sưu tập',
  AUTO: 'Tự động (cron)',
  OTHER: 'Ngoài Khám phá Video',
};

export const COST_FEATURE_LABEL: Record<string, string> = {
  PROPOSAL_DETAIL: 'Lấy số liệu video khi đề xuất / thêm thẳng',
  SCRIPT_DOWNLOAD: 'Tải video dự phòng qua TikHub',
  SCRIPT_GEMINI: 'Gemini viết kịch bản',
  SEARCH: 'Tìm kiếm video',
  PLATFORM_SEARCH: 'Tìm kiếm theo nền tảng',
  CHANNEL_SYNC: 'Đồng bộ kênh (hồ sơ, bài đăng)',
  CHANNEL_VIDEOS: 'Lấy video của kênh',
  CHANNEL_LOOKUP: 'Tra cứu kênh',
  VIDEO_DETAIL: 'Lấy chi tiết video',
  PLAY_URL: 'Lấy link phát video',
  OTHER: 'Khác',
};

export interface AiUsageEvent {
  provider: string;
  endpoint: string;
  cached?: boolean;
  status?: number | null;
  calls?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface UsageRow {
  provider: string;
  feature: string;
  page: string;
  endpoint: string;
  platform: string | null;
  cached: boolean;
  http_status: number | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  user_id: string | null;
  video_id: string | null;
  approved_content_id: string | null;
  ai_path: string | null;
  request_route: string | null;
}

export interface UsageSource {
  aiPath: string | null;
  requestRoute: string | null;
  clientPage: string | null;
  userId: string | null;
  hasRequest: boolean;
  tag?: UsageTag;
}

/** Header hỏng/lạ → bỏ qua (mảng rỗng), không bao giờ ném. */
export function parseUsageHeader(value: unknown): AiUsageEvent[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const data = JSON.parse(value);
    return Array.isArray(data) ? data.filter((e) => e && typeof e.endpoint === 'string' && typeof e.provider === 'string') : [];
  } catch {
    return [];
  }
}

/** Đường dẫn trang FE (X-Client-Page) → trang trong menu Khám phá Video. */
export function pageFromClientPath(path: string | null | undefined): string | null {
  const p = String(path || '').split('?')[0];
  if (/^\/dashboard\/(search-video|ai\/search)(\/|$)/.test(p)) return 'SEARCH';
  if (/^\/dashboard\/(internalChannels|internalOverview)(\/|$)/.test(p)) return 'INTERNAL_CHANNELS';
  if (/^\/dashboard\/(externalChannels|channel-analysis|facebook|instagram|tiktok|douyin|xiaohongshu|youtube)(\/|$)/.test(p)) {
    return 'EXTERNAL_CHANNELS';
  }
  if (/^\/dashboard\/video-library(\/|$)/.test(p)) return 'COLLECTION';
  return null;
}

/** Endpoint AI thuộc các trang Khám phá Video (cào/tra cứu kênh, tìm kiếm, chi tiết/kịch bản video). */
function isDiscoveryAiPath(aiPath: string | null): boolean {
  return /^\/api\/(scraper|search|scraped-video|channels)\//.test(aiPath || '') || (aiPath || '').startsWith('/api/videos/channel-');
}

export function resolvePage(src: UsageSource): string {
  if (src.tag?.page) return src.tag.page;
  const fromClient = pageFromClientPath(src.clientPage);
  if (fromClient) return fromClient;
  const route = (src.requestRoute || '').replace(/^[A-Z]+ /, '').replace(/^\/api(?=\/)/, '');
  if (/^\/(video-library|approved-content|extension)(\/|$)/.test(route)) return 'COLLECTION';
  if (/^\/ai\/search(\/|$)/.test(route)) return 'SEARCH';
  // Không đi qua request nào = cron. Chỉ tính cron của các trang Khám phá Video.
  if (!src.hasRequest) return isDiscoveryAiPath(src.aiPath) ? 'AUTO' : 'OTHER';
  return 'OTHER';
}

export function resolveFeature(aiPath: string | null, provider: string, tagFeature?: string): string {
  if (tagFeature === 'SCRIPT') return provider === 'GEMINI' ? 'SCRIPT_GEMINI' : 'SCRIPT_DOWNLOAD';
  if (tagFeature) return tagFeature;
  const p = aiPath || '';
  if (p.startsWith('/api/scraped-video/script-from-video')) return provider === 'GEMINI' ? 'SCRIPT_GEMINI' : 'SCRIPT_DOWNLOAD';
  if (p.startsWith('/api/search/user-videos')) return 'CHANNEL_VIDEOS';
  if (p.startsWith('/api/search/')) return 'SEARCH';
  if (/^\/api\/scraper\/[a-z]+\/fetch\/search/.test(p)) return 'PLATFORM_SEARCH';
  if (/^\/api\/scraper\/[a-z]+\/fetch\/(profile|channel|reels|resolve-video-author)/.test(p)) return 'CHANNEL_SYNC';
  if (p.startsWith('/api/scraper/video-detail')) return 'VIDEO_DETAIL';
  if (p.startsWith('/api/scraper/play-url')) return 'PLAY_URL';
  if (p.startsWith('/api/channels/') || p.startsWith('/api/videos/channel-')) return 'CHANNEL_LOOKUP';
  return 'OTHER';
}

/** Nền tảng: nhãn của code → endpoint TikHub (/api/v1/<nền tảng>/...) → endpoint AI (/api/scraper/<nền tảng>/...). */
export function resolvePlatform(endpoint: string, aiPath: string | null, tagPlatform?: string): string | null {
  if (tagPlatform) return tagPlatform.toLowerCase().slice(0, 20);
  const fromTikhub = /^\/api\/v1\/([a-z_]+)\//.exec(endpoint || '')?.[1];
  if (fromTikhub && fromTikhub !== 'tikhub') return fromTikhub.slice(0, 20);
  const fromAi = /^\/api\/scraper\/([a-z]+)\/fetch\//.exec(aiPath || '')?.[1];
  if (fromAi) return (fromAi === 'fanpages' ? 'facebook' : fromAi).slice(0, 20);
  return null;
}

export function buildUsageRows(events: AiUsageEvent[], src: UsageSource): UsageRow[] {
  const page = resolvePage(src);
  return events.map((e) => {
    const provider = e.provider === 'gemini' ? 'GEMINI' : 'TIKHUB';
    return {
      provider,
      feature: resolveFeature(src.aiPath, provider, src.tag?.feature),
      page,
      endpoint: String(e.endpoint).slice(0, 200),
      platform: resolvePlatform(e.endpoint, src.aiPath, src.tag?.platform),
      cached: Boolean(e.cached),
      http_status: typeof e.status === 'number' ? e.status : null,
      calls: Math.max(1, Math.round(Number(e.calls) || 1)),
      input_tokens: Math.max(0, Math.round(Number(e.input_tokens) || 0)),
      output_tokens: Math.max(0, Math.round(Number(e.output_tokens) || 0)),
      cost_usd: Math.max(0, Number(e.cost_usd) || 0),
      user_id: src.tag?.userId || src.userId || null,
      video_id: src.tag?.videoId ? src.tag.videoId.slice(0, 255) : null,
      approved_content_id: src.tag?.contentId || null,
      ai_path: src.aiPath ? src.aiPath.slice(0, 200) : null,
      request_route: src.requestRoute ? src.requestRoute.slice(0, 200) : null,
    };
  });
}

type UsageSink = (rows: UsageRow[]) => Promise<void>;
let sink: UsageSink | null = null;

/** Đọc người dùng từ token cho request CHƯA qua guard đăng nhập (vd POST /ai/search không gắn
 *  JwtAuthGuard nên không có req.user). Chỉ để ghi thống kê — không đổi hành vi đăng nhập. */
type UserResolver = (req: Request) => string | null;
let userResolver: UserResolver | null = null;

export function setUserResolver(fn: UserResolver | null): void {
  userResolver = fn;
}

function userIdOf(req: Request | undefined): string | null {
  if (!req) return null;
  const fromGuard = (req as any).user?.id;
  if (fromGuard) return String(fromGuard);
  try {
    return userResolver?.(req) ?? null;
  } catch {
    return null;
  }
}

/** ApiUsageRecorder đặt nơi lưu khi app khởi động xong. */
export function setUsageSink(fn: UsageSink | null): void {
  sink = fn;
}

function pathOf(url: string): string | null {
  try {
    return new URL(url, 'http://placeholder.local').pathname;
  } catch {
    return null;
  }
}

function headerOf(req: Request | undefined, name: string): string | null {
  const v = req?.headers?.[name];
  return typeof v === 'string' ? v.slice(0, 300) : null;
}

/** Ghi các lượt gọi AI đo được (từ header) kèm ngữ cảnh hiện tại. Không bao giờ ném. */
function recordUsageEvents(headerValue: unknown, url: string): void {
  try {
    const events = parseUsageHeader(headerValue);
    if (!events.length || !sink) return;
    const ctx = currentUsageContext();
    const req = ctx?.req;
    const rows = buildUsageRows(events, {
      aiPath: pathOf(url),
      requestRoute: req ? `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}` : null,
      clientPage: headerOf(req, CLIENT_PAGE_HEADER),
      userId: userIdOf(req),
      hasRequest: Boolean(req),
      tag: ctx?.tag,
    });
    sink(rows).catch(() => undefined);
  } catch {
    // bỏ qua: thống kê là phụ
  }
}

/** Đọc header chi phí của một phản hồi axios gọi AI và ghi lại — lỗi thống kê không được làm hỏng lượt gọi. */
export function recordUsageFromResponse(response: Pick<AxiosResponse, 'headers' | 'config'> | undefined): void {
  const config = response?.config;
  recordUsageEvents(response?.headers?.[USAGE_HEADER], `${config?.baseURL ?? ''}${config?.url ?? ''}`);
}

const FETCH_MARK = Symbol.for('vcb.apiUsage.fetch');

/**
 * Bọc `fetch` toàn cục: vài module gọi AI bằng fetch thay vì axios (vd tracked-channels). Chỉ đọc
 * header chi phí nếu có — không đụng thân phản hồi, trả nguyên đối tượng Response cho bên gọi.
 */
export function trackFetchUsage(): void {
  const current = globalThis.fetch as any;
  if (typeof current !== 'function' || current[FETCH_MARK]) return;
  const wrapped = async (input: any, init?: any) => {
    const response = await current(input, init);
    try {
      const header = response?.headers?.get?.(USAGE_HEADER);
      if (header) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? '');
        recordUsageEvents(header, url);
      }
    } catch {
      // bỏ qua: thống kê là phụ
    }
    return response;
  };
  (wrapped as any)[FETCH_MARK] = true;
  (wrapped as any).original = current;
  globalThis.fetch = wrapped as typeof fetch;
}

/** Gỡ lớp bọc fetch (khi app dừng / trong test). */
export function untrackFetchUsage(): void {
  const current = globalThis.fetch as any;
  if (current?.[FETCH_MARK] && typeof current.original === 'function') globalThis.fetch = current.original;
}

const tracked = new WeakSet<object>();

/** Gắn interceptor ghi chi phí vào một bản axios (gắn lại lần nữa thì bỏ qua). */
export function trackAiUsage(instance: AxiosInstance | undefined | null): void {
  if (!instance?.interceptors || tracked.has(instance)) return;
  tracked.add(instance);
  instance.interceptors.response.use(
    (response) => {
      recordUsageFromResponse(response);
      return response;
    },
    (error) => {
      // AI trả lỗi (vd 502 khi Gemini hỏng) vẫn có thể đã tốn TikHub/Gemini
      if (error?.response) recordUsageFromResponse(error.response);
      return Promise.reject(error);
    },
  );
}

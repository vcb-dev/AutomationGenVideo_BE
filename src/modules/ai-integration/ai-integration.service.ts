import { Injectable, Logger, HttpException, HttpStatus, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PlayUrlNoCreditError } from './play-url-errors';
import { buildVoiceUsageDateRange } from './voice-usage-range';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { catchError, firstValueFrom, lastValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { TransformStatus, UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';
import { AnalyzeContentDto } from './dto/paast-analyze.dto';
import { HistoryQueryDto } from './dto/paast-history-query.dto';
import { INTERNAL_TOKEN_HEADER } from '../characters/guards/admin-or-internal.guard';
import {
  PaastAnalysisPayload,
  PaastStoredScore,
  PAAST_LOGIC_VERSION,
} from './interfaces/paast-analysis.interface';
import {
  buildPaastUpgradeSystemPrompt,
  buildPaastUpgradeUserPrompt,
} from './paast-upgrade.util';
import { CreateTransformDto } from './dto/content-transform.dto';
import { ContentTransformHistoryQueryDto } from './dto/content-transform-history-query.dto';
import { UpgradeTransformDto } from './dto/content-transform-upgrade.dto';
import { RescoreDto } from './dto/content-transform-rescore.dto';

/** Chi tiết 1 video do AI service lấy về (TikHub) — xem fetchVideoDetail(). */
export interface VideoDetailResult {
  platform: string;
  title: string;
  description: string;
  author_name: string;
  author_username: string;
  thumbnail_url: string;
  views_count: number;
  likes_count: number;
  comments_count: number;
  shares_count: number;
}

/** Một tiêu chí PAAST đang `miss` — dùng làm input cho upgradeAnalysis(). */
interface MissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Types dùng riêng cho phần "chuyển đổi content" (gộp từ module content-transform)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Kết quả chấm điểm lưu vào ContentTransformHistory.score_result và trả cho FE — chính là
 * payload PAAST nguyên bản (layers + total_score + cta_warning), không đổi tên field.
 */
type ContentTransformScoreResult = PaastAnalysisPayload;

/**
 * Trạng thái chấm điểm của 1 bản ghi, dùng chung cho /transform, /rescore, /upgrade và các
 * endpoint lịch sử:
 *  - `null`    : bản ghi chưa từng có output_text (vd transform hỏng ngay từ bước viết) —
 *                không áp dụng khái niệm chấm điểm.
 *  - `pending` : ĐÃ có kịch bản kết quả nhưng CHƯA chấm điểm. Đây là trạng thái bình thường
 *                ngay sau /transform kể từ khi tách "viết kịch bản" và "chấm điểm" thành 2
 *                request riêng — KHÔNG phải lỗi, người dùng bấm "Chấm điểm content" để chấm.
 *  - `success` : đã chấm xong, có scoreResult theo khung PAAST.
 *  - `failed`  : lần chấm vừa rồi thất bại (sau khi đã tự retry), hoặc bản ghi dùng hệ điểm cũ.
 */
type ContentTransformScoreStatus = 'success' | 'failed' | 'pending' | null;

/** Bản ghi cũ chấm bằng hệ 7 nhóm/23 tiêu chí + Hard Gate (đã ngừng dùng) không có `layers`. */
function isPaastScoreResult(raw: any): raw is ContentTransformScoreResult {
  return !!raw && typeof raw === 'object' && !!raw.layers && !!raw.layers.prefer;
}

@Injectable()
export class AiIntegrationService {
  private readonly logger = new Logger(AiIntegrationService.name);
  private readonly aiServiceUrl: string;
  /**
   * URL riêng cho các endpoint /api/voice/* (TTS + clone giọng Minimax). Các
   * endpoint này chỉ gọi API cloud Minimax, không cần torch/GPU/NAS như
   * smart-mix video — nên deploy được thẳng trên Railway (build tự động qua
   * push, xem AutomationGenVideo_AI/.github/workflows/deploy-railway.yml),
   * khác với AI_SERVICE_URL chung (trỏ máy local qua Cloudflare Tunnel, dùng
   * cho các tính năng cần torch/NAS).
   *
   * Không cần cấu hình gì thêm trên Railway: khi BE tự chạy trên Railway
   * (nhận biết qua RAILWAY_ENVIRONMENT_NAME — biến Railway tự bơm vào mọi
   * service, không cần khai báo tay), mặc định gọi thẳng service
   * automationgenvideo-ai qua Private Networking (<service>.railway.internal
   * — hostname cố định theo tên service, tự có sẵn, không cần bấm "Generate
   * Domain"). Chạy local dev (không có RAILWAY_ENVIRONMENT_NAME) → fallback
   * về AI_SERVICE_URL như cũ. Set tay AI_SERVICE_URL_VOICE nếu cần override.
   */
  private readonly voiceAiServiceUrl: string;
  private static readonly RAILWAY_VOICE_AI_INTERNAL_URL =
    'http://automationgenvideo-ai.railway.internal:8080';
  private readonly minimaxApiKey?: string;
  /**
   * Đơn giá quy đổi "điểm âm thanh" MiniMax ra tiền: VND cho mỗi 1000 ký tự tính phí.
   * Set qua env MINIMAX_VND_PER_1K_CHARS (VD gói 250.000đ/500.000 ký tự → 500).
   * Để 0 nếu chưa biết giá — FE sẽ ẩn phần hiển thị tiền.
   */
  private readonly minimaxVndPer1kChars: number;

  // ── Phần "chuyển đổi content" (gộp từ module content-transform) ──
  // Rate limit đơn giản, in-memory, theo user — 5 lần/phút cho cả transform + upgrade gộp
  // chung 1 ngân sách. Không dùng ThrottlerModule global (đang theo dõi theo IP, phù hợp
  // chống spam theo mạng LAN NAT chứ không phải theo user) — mục này cần giới hạn ĐÚNG theo
  // user để tránh 1 người spam tốn chi phí AI, bất kể IP dùng chung với ai. Chưa cần Redis/DB
  // vì hiện chạy 1 instance duy nhất; nếu sau này scale nhiều instance sẽ cần thay bằng store
  // dùng chung (Redis) — ghi chú lại để không quên.
  private readonly contentTransformRateLimitHits = new Map<string, number[]>();
  private readonly CONTENT_TRANSFORM_RATE_LIMIT_MAX = 5;
  private readonly CONTENT_TRANSFORM_RATE_LIMIT_WINDOW_MS = 60_000;

  // ── Chống bấm trùng /upgrade cho cùng 1 history_id — in-memory Set, tự dọn trong finally.
  private readonly contentTransformProcessingUpgrades = new Set<string>();

  // ── Tương tự cho /rescore. Cần thiết hơn hẳn kể từ khi tách luồng: chấm điểm giờ là 1 nút
  // riêng người dùng chủ động bấm (thay vì chạy tự động trong /transform), nên khả năng bấm 2
  // lần liên tiếp trong lúc lượt đầu còn đang chạy là có thật.
  private readonly contentTransformProcessingScores = new Set<string>();

  // ── Timeout cho /upgrade — gọi endpoint gộp .../api/ai/transform-content/upgrade/ (viết lại
  // RỒI chấm PAAST bản mới trong CÙNG 1 request Django, xem callContentTransformUpgradeAiService).
  // Trước đây đây là 2 request riêng, mỗi request tự retry 3x120s = tối đa 720s cộng dồn. Giờ
  // chỉ 1 request nhưng Django cần đủ ngân sách cho CẢ 2 lượt LLM nối tiếp bên trong (chia theo
  // tỷ lệ 40% viết / 60% chấm, xem PaastAnalysisService.upgrade_scripted) — 420s (7 phút) đủ dư
  // so với mức thường gặp (viết ~thực đo dưới 60s, chấm thường dưới 60s khi không phải retry).
  private readonly CONTENT_TRANSFORM_UPGRADE_TIMEOUT_MS = 420_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly driveStorage: GoogleDriveStorageService,
  ) {
    this.aiServiceUrl = resolveAiServiceUrl(this.configService);
    const runningOnRailway = !!this.configService.get<string>('RAILWAY_ENVIRONMENT_NAME');
    this.voiceAiServiceUrl = this.configService.get<string>(
      'AI_SERVICE_URL_VOICE',
      runningOnRailway ? AiIntegrationService.RAILWAY_VOICE_AI_INTERNAL_URL : this.aiServiceUrl,
    );
    this.minimaxApiKey = this.configService.get<string>('MINIMAX_API_KEY');
    this.minimaxVndPer1kChars = Number(this.configService.get<string>('MINIMAX_VND_PER_1K_CHARS', '0')) || 0;
    this.logger.log(`AI Service URL: ${this.aiServiceUrl}`);
    this.logger.log(`Voice AI Service URL: ${this.voiceAiServiceUrl}`);
    if (!this.minimaxApiKey) {
      this.logger.warn('MINIMAX_API_KEY chưa được set — TTS/clone giọng sẽ lỗi (key giữ ở BE, gửi sang AI qua header X-Minimax-Key)');
    }
  }

  /**
   * Key MiniMax giữ ở .env của BE và gửi kèm từng request voice sang AI service qua
   * header X-Minimax-Key — AI không còn giữ key trong .env của nó.
   */
  private minimaxHeaders(): Record<string, string> {
    return this.minimaxApiKey ? { 'X-Minimax-Key': this.minimaxApiKey } : {};
  }




  /**

   * Search videos using AI Service (v2 API)

   */

  async searchVideos(

    platform: string,

    keyword: string,

    minLikes = 0,

    minViews = 0,

    maxResults = 30,

    useCache = true,

    asyncMode = false,

    searchType = 'posts',

    page = 1,

    minComments = 0,

    searchMode = 'hashtag',

    sessionId?: string,

  ): Promise<any> {

    const url = `${this.aiServiceUrl}/api/search/`;

    this.logger.log(`Calling AI Service: ${url} with platform=${platform}, type=${searchType}, mode=${searchMode}, keyword=${keyword}, page=${page}`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.post(url, {

          platform,

          keyword,

          min_likes: minLikes,

          min_views: minViews,

          min_comments: minComments,

          max_results: maxResults,

          use_cache: useCache,

          async_mode: asyncMode,

          search_type: searchType,

          page,

          search_mode: searchMode,

          session_id: sessionId,

        }, {

          timeout: 3600000 // 60 minutes timeout for scraping

        }).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`AI Service Search Error: ${error.message}`, error.response?.data);

            throw new HttpException(

              error.response?.data || 'Failed to connect to AI Service',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      this.logger.error(`Search failed: ${error.message}`);

      throw error;

    }

  }



  /**

   * Get videos from a specific user/channel

   */

  async getUserVideos(

    platform: string,

    username: string,

    maxResults = 9999, // Unlimited by default

    untilDate?: string,

    startDate?: string,

    endDate?: string,

    forceRefresh: boolean = false,

    channelUrl?: string, // URL đầy đủ từ link_channel (VD: https://www.facebook.com/profile.php?id=...)

  ): Promise<any> {

    const url = `${this.aiServiceUrl}/api/search/user-videos/`;

    this.logger.log(`Calling AI Service: ${url} for user=${username}, max_results=${maxResults}, start=${startDate}, end=${endDate}, force_refresh=${forceRefresh}`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.post(url, {

          platform,

          username,

          max_results: maxResults,

          until_date: untilDate,

          start_date: startDate,

          end_date: endDate,

          force_refresh: forceRefresh,

          ...(channelUrl ? { channel_url: channelUrl } : {}), // URL đầy đủ từ link_channel (Facebook profile.php?id=...)

        }, {

          timeout: 3600000 // 60 minutes timeout for large channels

        }).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`AI Service User Videos Error: ${error.message}`, error.response?.data);

            throw new HttpException(

              error.response?.data || 'Failed to connect to AI Service',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      this.logger.error(`User videos fetch failed: ${error.message}`);

      throw error;

    }

  }

  /**
   * Analyze Facebook competitor channel (Gemini insights via AI Service)
   */
  async analyzeFacebookCompetitor(
    url: string,
    maxPosts = 200,
    forceMethod: 'auto' | 'graph' | 'apify' = 'apify',
    language = 'vi',
    startDate?: string,
    endDate?: string,
    forceRefresh = false,
  ): Promise<any> {
    const endpoint = `${this.aiServiceUrl}/api/facebook/competitor-insights/`;
    this.logger.log(
      `Calling AI Service competitor insights: ${endpoint} url=${url}, max_posts=${maxPosts}, method=${forceMethod}, lang=${language}, start=${startDate}, end=${endDate}, force=${forceRefresh}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService
          .post(
            endpoint,
            {
              url,
              max_posts: maxPosts,
              force_method: forceMethod,
              language,
              start_date: startDate || undefined,
              end_date: endDate || undefined,
              force_refresh: forceRefresh,
            },
            {
              timeout: 600000,
            },
          )
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.error(
                `AI Service competitor insights error: ${error.message}`,
                error.response?.data,
              );
              throw new HttpException(
                error.response?.data || 'Failed to connect to AI Service (competitor insights)',
                error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }),
          ),
      );

      return data;
    } catch (error: any) {
      this.logger.error(`Competitor insights failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Compute Facebook channel metrics (viral posts, ads, charts) via AI Service (Apify data).
   * NOTE: This endpoint does NOT call Gemini, so it should be fast.
   */
  async facebookChannelMetrics(
    url: string,
    maxPosts = 200,
    forceMethod: 'auto' | 'graph' | 'apify' = 'apify',
    startDate?: string,
    endDate?: string,
    forceRefresh = false,
  ): Promise<any> {
    const endpoint = `${this.aiServiceUrl}/api/facebook/channel-metrics/`;
    this.logger.log(
      `Calling AI Service channel metrics: ${endpoint} url=${url}, max_posts=${maxPosts}, method=${forceMethod}, start=${startDate}, end=${endDate}, force=${forceRefresh}`,
    );

    try {
      const { data } = await lastValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/facebook/channel-metrics/`,
          {
            url,
            max_posts: maxPosts,
            force_method: forceMethod,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            force_refresh: forceRefresh,
          },
          { timeout: 600000 },
        ),
      );
      return data;
    } catch (error: any) {
      this.logger.error(`Channel metrics failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generic channel insights (Gemini) for all platforms.
   */
  async channelInsights(platform: string, usernameOrUrl: string, maxPosts = 200, language = 'vi', startDate?: string, endDate?: string, forceRefresh = false): Promise<any> {
    const endpoint = `${this.aiServiceUrl}/api/channel/insights/`;
    this.logger.log(
      `Calling AI Service generic insights: ${endpoint} platform=${platform}, user=${usernameOrUrl}, max_posts=${maxPosts}, lang=${language}, start=${startDate}, end=${endDate}, force=${forceRefresh}`,
    );

    try {
      const { data } = await lastValueFrom(
        this.httpService.post(
          endpoint,
          {
            platform,
            username: usernameOrUrl,
            max_posts: maxPosts,
            language,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            force_refresh: forceRefresh,
          },
          { timeout: 600000 },
        ),
      );
      return data;
    } catch (error: any) {
      this.logger.error(`Generic insights failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generic channel metrics for all platforms (no Gemini).
   */
  async channelMetrics(platform: string, usernameOrUrl: string, maxPosts = 200, startDate?: string, endDate?: string, forceRefresh = false): Promise<any> {
    const endpoint = `${this.aiServiceUrl}/api/channel/metrics/`;
    this.logger.log(
      `Calling AI Service generic metrics: ${endpoint} platform=${platform}, user=${usernameOrUrl}, max_posts=${maxPosts}, start=${startDate}, end=${endDate}, force=${forceRefresh}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService
          .post(
            endpoint,
            {
              platform,
              username: usernameOrUrl,
              max_posts: maxPosts,
              start_date: startDate || undefined,
              end_date: endDate || undefined,
              force_refresh: forceRefresh,
            },
            {
              timeout: 600000,
              headers: { 'Content-Type': 'application/json' },
            },
          )
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.error(`AI Service generic metrics error: ${error.message}`, error.response?.data);
              throw new HttpException(
                error.response?.data || 'Failed to connect to AI Service (generic metrics)',
                error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }),
          ),
      );
      return data;
    } catch (error: any) {
      this.logger.error(`Generic metrics failed: ${error.message}`);
      throw error;
    }
  }



  /**

   * Check task status (for async searches)

   */

  async checkTaskStatus(taskId: string): Promise<any> {

    const url = `${this.aiServiceUrl}/api/search/status/${taskId}/`;

    this.logger.log(`Checking task status: ${taskId}`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.get(url).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`Task Status Error: ${error.message}`);

            throw new HttpException(

              error.response?.data || 'Failed to check task status',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      throw error;

    }

  }



  /**

   * Get videos by channel from database (optimized for analytics)

   */

  async getVideosByChannel(

    platform: string,

    username: string,

    limit = 20,

    sortBy = 'views',

    order = 'desc',

    period?: string

  ): Promise<any> {

    const url = `${this.aiServiceUrl}/api/videos/by-channel/`;

    const params = new URLSearchParams({

      platform,

      username,

      limit: limit.toString(),

      sort_by: sortBy,

      order

    });



    if (period) {

      params.append('period', period);

    }



    const fullUrl = `${url}?${params.toString()}`;

    this.logger.log(`Getting channel videos: ${fullUrl}`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.get(fullUrl).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`Get Videos By Channel Error: ${error.message}`);

            throw new HttpException(

              error.response?.data || 'Failed to get channel videos',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      throw error;

    }

  }



  /**

   * Get search history

   */

  async getSearchHistory(platform?: string, limit = 50): Promise<any> {

    const url = `${this.aiServiceUrl}/api/search/history/`;

    const params = new URLSearchParams();



    if (platform) params.append('platform', platform);

    params.append('limit', limit.toString());



    const fullUrl = `${url}?${params.toString()}`;

    this.logger.log(`Getting search history: ${fullUrl}`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.get(fullUrl).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`Search History Error: ${error.message}`);

            throw new HttpException(

              error.response?.data || 'Failed to get search history',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      throw error;

    }

  }



  /**

   * Get AI service statistics

   */

  async getStats(): Promise<any> {

    const url = `${this.aiServiceUrl}/api/stats/`;

    this.logger.log(`Getting AI service stats`);



    try {

      const { data } = await firstValueFrom(

        this.httpService.get(url).pipe(

          catchError((error: AxiosError) => {

            this.logger.error(`Stats Error: ${error.message}`);

            throw new HttpException(

              error.response?.data || 'Failed to get stats',

              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      throw error;

    }

  }



  /**

   * Health check for AI service

   */

  async getChannelCoverage(year: number, month: number) {
    // Chuẩn hóa platform name để group
    const normalizePlatform = (p: string) => {
      const l = (p || '').toLowerCase();
      if (l.includes('facebook'))  return 'Facebook';
      if (l.includes('tiktok'))    return 'TikTok';
      if (l.includes('youtube'))   return 'YouTube';
      if (l.includes('instagram') || l === 'ig') return 'Instagram';
      if (l.includes('thread'))    return 'Threads';
      if (l.includes('zalo'))      return 'Zalo';
      if (p) return p;
      return 'Khác';
    };

    // Chỉ lấy kênh đang hoạt động và có đủ name, platform, team, owner
    const allChannels = await this.prisma.$queryRawUnsafe(`
      SELECT id, name, platform, team_traffic as team, owner, status
      FROM huyk_channels
      WHERE status IN ('Đang hoạt động', 'ON')
        AND name IS NOT NULL AND TRIM(name) <> ''
        AND platform IS NOT NULL AND TRIM(platform) <> ''
        AND team_traffic IS NOT NULL AND TRIM(team_traffic) <> ''
        AND owner IS NOT NULL AND TRIM(owner) <> ''
      ORDER BY platform, name
    `) as any[];

    // Kênh có data trong social_video_report tháng này — group by platform + name
    const withData = await this.prisma.$queryRawUnsafe(`
      SELECT LOWER(TRIM(platform)) as platform_key,
        LOWER(TRIM(channel_name)) as channel_key,
        SUM(views) views, COUNT(*) videos, MAX(followers) followers
      FROM social_video_report
      WHERE year=${year} AND month=${month}
      GROUP BY LOWER(TRIM(platform)), LOWER(TRIM(channel_name))
    `) as any[];

    // Key: normalized_platform::channel_name
    const dataMap = new Map(withData.map((r: any) => [
      `${normalizePlatform(r.platform_key)}::${r.channel_key}`,
      r,
    ]));

    // Gán coverage status cho từng kênh
    const enriched = allChannels.map((ch: any) => {
      const platformNorm = normalizePlatform(ch.platform);
      const nameKey = (ch.name || '').toLowerCase().trim();
      const data = dataMap.get(`${platformNorm}::${nameKey}`);
      return {
        ...ch,
        platform_norm: platformNorm,
        has_data: !!data,
        views: data ? Number(data.views) : 0,
        videos: data ? Number(data.videos) : 0,
        followers: data ? Number(data.followers) : 0,
      };
    });

    // Tổng hợp theo platform
    const byPlatform: Record<string, { platform: string; total: number; has_data: number; no_data: number; coverage_pct: number; total_views: number }> = {};
    for (const ch of enriched) {
      const p = ch.platform_norm;
      if (!byPlatform[p]) byPlatform[p] = { platform: p, total: 0, has_data: 0, no_data: 0, coverage_pct: 0, total_views: 0 };
      byPlatform[p].total++;
      if (ch.has_data) { byPlatform[p].has_data++; byPlatform[p].total_views += ch.views; }
      else byPlatform[p].no_data++;
    }
    for (const stat of Object.values(byPlatform)) {
      stat.coverage_pct = stat.total > 0 ? Math.round((stat.has_data / stat.total) * 100) : 0;
    }

    const totalChannels = enriched.length;
    const hasDataCount  = enriched.filter((c: any) => c.has_data).length;

    return {
      year, month,
      summary: {
        total_channels: totalChannels,
        has_data: hasDataCount,
        no_data: totalChannels - hasDataCount,
        coverage_pct: totalChannels > 0 ? Math.round((hasDataCount / totalChannels) * 100) : 0,
        total_views: enriched.reduce((a: number, c: any) => a + c.views, 0),
      },
      by_platform: Object.values(byPlatform).sort((a, b) => b.total - a.total),
      channels_with_data: enriched.filter((c: any) => c.has_data).sort((a: any, b: any) => b.views - a.views),
      channels_no_data:   enriched.filter((c: any) => !c.has_data).sort((a: any, b: any) => (a.platform_norm).localeCompare(b.platform_norm)),
    };
  }

  async getSocialStats(year: number, month: number, platform?: string, team?: string): Promise<any> {
    const safeP = (platform || '').replace(/'/g, '');
    const safeT = (team || '').replace(/'/g, '');
    const platformFilter = safeP ? `AND LOWER(platform) LIKE LOWER('%${safeP}%')` : '';
    const teamFilter     = safeT ? `AND LOWER(team) LIKE LOWER('%${safeT}%')` : '';

    const [summary, byPlatform, byTeam, topViews, topLikes, topComments] = await Promise.all([
      // Tổng hợp
      this.prisma.$queryRawUnsafe(`
        SELECT
          COUNT(DISTINCT username)::text AS channels,
          COALESCE(SUM(views),0)::text    AS total_views,
          COALESCE(SUM(likes),0)::text    AS total_likes,
          COALESCE(SUM(comments),0)::text AS total_comments,
          COALESCE(SUM(shares),0)::text   AS total_shares,
          COUNT(*)::text                  AS total_videos
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${platformFilter} ${teamFilter}
      `),
      // Theo platform
      this.prisma.$queryRawUnsafe(`
        SELECT platform,
          COUNT(DISTINCT username)::text AS channels,
          COALESCE(SUM(views),0)::text   AS views,
          COALESCE(SUM(likes),0)::text   AS likes,
          COUNT(*)::text                 AS videos
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${teamFilter}
        GROUP BY platform ORDER BY SUM(views) DESC
      `),
      // Theo team
      this.prisma.$queryRawUnsafe(`
        SELECT COALESCE(NULLIF(team,''),'Chưa phân team') AS team,
          COUNT(DISTINCT username)::text AS channels,
          COALESCE(SUM(views),0)::text   AS views,
          COALESCE(SUM(likes),0)::text   AS likes,
          COUNT(*)::text                 AS videos
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${platformFilter}
        GROUP BY team ORDER BY SUM(views) DESC LIMIT 10
      `),
      // Top 10 views
      this.prisma.$queryRawUnsafe(`
        SELECT platform, channel_name, username, team, owner,
               title, video_url, views::text, likes::text, comments::text, published_at::text
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${platformFilter} ${teamFilter}
        ORDER BY views DESC LIMIT 10
      `),
      // Top 10 likes
      this.prisma.$queryRawUnsafe(`
        SELECT platform, channel_name, username, team,
               title, video_url, views::text, likes::text, comments::text, published_at::text
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${platformFilter} ${teamFilter}
        ORDER BY likes DESC LIMIT 10
      `),
      // Top 10 comments
      this.prisma.$queryRawUnsafe(`
        SELECT platform, channel_name, username, team,
               title, video_url, views::text, likes::text, comments::text, published_at::text
        FROM social_video_report
        WHERE year=${year} AND month=${month} ${platformFilter} ${teamFilter}
        ORDER BY comments DESC LIMIT 10
      `),
    ]);

    return {
      year, month, platform: platform || 'all', team: team || 'all',
      summary:      (summary as any[])[0] || {},
      by_platform:  byPlatform,
      by_team:      byTeam,
      top_views:    topViews,
      top_likes:    topLikes,
      top_comments: topComments,
    };
  }

  async getHuykChannels(platform?: string, team?: string, limit = 200): Promise<any> {
    const safeP = (platform || '').replace(/'/g, '');
    const safeT = (team || '').replace(/'/g, '');
    return this.prisma.$queryRawUnsafe(`
      SELECT
        TRIM(name) AS display_name,
        COALESCE(NULLIF(TRIM(platform), ''), 'Khác') AS platform,
        TRIM(COALESCE(channel_id, '')) AS username,
        link_channel,
        COALESCE(NULLIF(TRIM(team_traffic), ''), '—') AS team,
        TRIM(COALESCE(owner, '')) AS owner_name,
        email AS owner_email
      FROM huyk_channels
      WHERE status IN ('Đang hoạt động', 'ON')
        AND name IS NOT NULL
        AND TRIM(name) != ''
      ${safeP ? `AND LOWER(platform) LIKE LOWER('%${safeP}%')` : ''}
      ${safeT ? `AND LOWER(team_traffic) LIKE LOWER('%${safeT}%')` : ''}
      ORDER BY platform, name
      LIMIT ${limit}
    `);
  }

  async chat(message: string, history: { role: string; content: string }[]): Promise<any> {
    this.logger.log(`[AI Analytics] Question: ${message}`);
    try {
      // Proxy sang Python AI service — toàn bộ logic xử lý ở đó
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/chat/analytics/`,
          { message, history },
          { timeout: 60000 },   // 60s timeout — đủ cho 2 lần gọi DeepSeek
        ).pipe(catchError((err: AxiosError) => {
          this.logger.error(`[AI Analytics] Python service error: ${err.message}`);
          throw err;
        }))
      );
      return data;
    } catch (err) {
      this.logger.error(`[AI Analytics ERROR] ${err.message}`);
      return { reply: 'Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.', type: 'chat' };
    }
  }


  async healthCheck(): Promise<any> {

    const url = `${this.aiServiceUrl}/api/health/`;



    try {

      const { data } = await firstValueFrom(

        this.httpService.get(url).pipe(

          catchError((error: AxiosError) => {

            throw new HttpException(

              'AI Service is not available',

              HttpStatus.SERVICE_UNAVAILABLE,

            );

          }),

        ),

      );

      return data;

    } catch (error) {

      throw error;

    }

  }



  // Collections methods

  async getCollections(): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/`;

    const { data } = await firstValueFrom(this.httpService.get(url));

    return data;

  }



  async createCollection(collectionData: any): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/`;

    const { data } = await firstValueFrom(this.httpService.post(url, collectionData));

    return data;

  }



  async getCollection(id: string): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/${id}/`;

    const { data } = await firstValueFrom(this.httpService.get(url));

    return data;

  }



  async updateCollection(id: string, collectionData: any): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/${id}/`;

    const { data } = await firstValueFrom(this.httpService.patch(url, collectionData));

    return data;

  }



  async deleteCollection(id: string): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/${id}/`;

    const { data } = await firstValueFrom(this.httpService.delete(url));

    return data;

  }



  async addVideoToCollection(id: string, videoData: any): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/${id}/add_video/`;

    const { data } = await firstValueFrom(this.httpService.post(url, videoData));

    return data;

  }



  async removeVideoFromCollection(id: string, videoId: string): Promise<any> {

    const url = `${this.aiServiceUrl}/api/collections/${id}/remove-video/${videoId}/`;

    const { data } = await firstValueFrom(this.httpService.delete(url));

    return data;

  }

  /**
   * Proxy avatar image to bypass CORS and URL expiry issues
   * Instagram CDN URLs have signature tokens that expire
   */
  async proxyAvatar(imageUrl: string, res: any): Promise<void> {
    try {
      if (!imageUrl) {
        res.status(400).send('Missing url parameter');
        return;
      }

      // Validate URL is from allowed domains
      const allowedDomains = [
        // Instagram
        'cdninstagram.com',
        'instagram.com',
        'fbcdn.net',
        'scontent.cdninstagram.com',
        'scontent-',
        // TikTok
        'tiktokcdn.com',
        'tiktok.com',
        'muscdn.com',
        'musical.ly',
        // Google user content (Lark employee profile photos)
        'googleusercontent.com',
        'lh3.googleusercontent.com',
        'lh4.googleusercontent.com',
        'lh5.googleusercontent.com',
        'lh6.googleusercontent.com',
      ];

      const isAllowed = allowedDomains.some(domain => imageUrl.includes(domain));
      if (!isAllowed) {
        this.logger.warn(`Blocked proxy request for non-allowed domain: ${imageUrl}`);
        res.status(403).send('Domain not allowed');
        return;
      }

      const isGoogleContent = imageUrl.includes('googleusercontent.com');
      // Fetch the image - headers giống browser để tránh CDN block
      const response = await firstValueFrom(
        this.httpService.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': isGoogleContent ? 'https://www.google.com/' : 'https://www.instagram.com/',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
          },
        })
      );

      if (!response.data || response.data.byteLength === 0) {
        this.logger.warn('Proxy avatar: empty response from CDN');
        res.status(404).send('Image not found');
        return;
      }

      const contentType = response.headers['content-type'] || 'image/jpeg';
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });

      res.send(Buffer.from(response.data));
    } catch (error: any) {
      const status = error?.response?.status;
      const msg = error?.response?.data ? '(CDN returned error)' : error.message;
      this.logger.warn(`Proxy avatar failed [${status || 'err'}]: ${msg}`);
      res.status(status === 403 || status === 404 ? status : 500).send('Failed to fetch image');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Mix-Video Methods (Business Logic Layer)
  // ═══════════════════════════════════════════════════════════════

  // ─── NEW Smart Mix Methods (20-30x faster!) ───

  /**
   * Smart Mix - High performance mix using pre-processing
   * Performance: 5-13 seconds (vs 2-3 minutes with old mix)
   */
  async smartMix(body: any, audioFile: any): Promise<any> {
    const FormData = require('form-data');

    try {
      console.log('========== SMART MIX DEBUG ==========');
      console.log('Starting smart mix (5-13s expected)...');

      const formData = new FormData();

      // Add audio file
      formData.append('audio', audioFile.buffer, {
        filename: audioFile.originalname,
        contentType: audioFile.mimetype,
      });

      // Add params
      formData.append('num_outputs', body.num_outputs || '5');
      formData.append('width', body.width || '540');
      formData.append('height', body.height || '960');
      formData.append('use_gpu', body.use_gpu || 'auto');
      formData.append('use_a4_formula', body.use_a4_formula || 'false');
      formData.append('use_a4_formula', body.use_a4_formula || 'false');  // ✅ A4 Formula support

      console.log('Calling AI Smart Mix at:', `${this.aiServiceUrl}/api/videos/smart-mix/`);
      console.log('Smart Mix Config:', {
        num_outputs: body.num_outputs,
        use_a4_formula: body.use_a4_formula,
        use_gpu: body.use_gpu
      });
      console.log('Smart Mix Config:', {
        num_outputs: body.num_outputs,
        use_a4_formula: body.use_a4_formula,
        use_gpu: body.use_gpu
      });

      const response = await this.httpService.axiosRef.post(
        `${this.aiServiceUrl}/api/videos/smart-mix/`,
        formData,
        {
          headers: formData.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 120000, // 2 min timeout (much shorter than old 10 min!)
        }
      );

      console.log('Smart mix started:', response.data);
      return response.data;

    } catch (error: any) {
      console.error('========== SMART MIX ERROR ==========');
      console.error('Error:', error.message);
      console.error('Response:', error.response?.data);

      throw new HttpException(
        error.response?.data?.error || error.message || 'Smart mix failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get smart mix status
   */
  async smartMixStatus(progressId: string): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.aiServiceUrl}/api/videos/smart-mix/status/${progressId}/`
      );
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.error || error.message || 'Failed to get status',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Index folders - One-time setup for smart mix
   */
  async indexFolders(body: any): Promise<any> {
    try {
      console.log('Indexing folders:', body.folders);

      const response = await this.httpService.axiosRef.post(
        `${this.aiServiceUrl}/api/videos/index-folders/`,
        body,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 600000, // 10 min for initial indexing
        }
      );

      console.log('Indexing result:', response.data);
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.error || error.message || 'Failed to index folders',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.aiServiceUrl}/api/videos/cache-stats/`
      );
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.error || error.message || 'Failed to get cache stats',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ─── OLD Mix Methods (DEPRECATED) ───

  /**
   * Scan folder to count videos
   * Forwards to AI Service
   */
  async scanFolder(folderPath: string): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.post(
        `${this.aiServiceUrl}/api/videos/scan-folder/`,
        { path: folderPath },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.error || error.message || 'Failed to scan folder',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Manual mix video - User provides 10 folder paths
   * Forwards folder paths + audio to AI Service
   */
  async mixVideo(
    body: any,
    audioFile: any
  ): Promise<any> {
    const FormData = require('form-data');
    const fs = require('fs');

    try {
      console.log('========== MIX VIDEO DEBUG ==========');
      console.log('Body received:', body);
      console.log('Audio file:', audioFile);

      // Extract folder paths from body
      const folderPaths: string[] = [];
      for (let i = 0; i < 10; i++) {
        const path = body[`folder_paths_${i}`];
        if (path && path.trim()) {
          folderPaths.push(path.trim());
        }
      }

      console.log('Extracted folder paths:', folderPaths);

      if (folderPaths.length === 0) {
        throw new Error('At least one folder path is required');
      }

      // Prepare FormData for AI Service
      const formData = new FormData();

      // Add audio file (from buffer since multer uses memory storage)
      formData.append('audio', audioFile.buffer, {
        filename: audioFile.originalname,
        contentType: audioFile.mimetype,
      });

      // Add folder paths
      folderPaths.forEach((path, index) => {
        formData.append(`folder_paths_${index}`, path);
      });

      // Add optional params
      formData.append('width', body.width || '720');
      formData.append('height', body.height || '1280');
      formData.append('num_outputs', body.num_outputs || '5');
      formData.append('videos_per_folder', body.videos_per_folder || '10'); // Limit videos/folder
      formData.append('fast_mode', body.fast_mode === 'true' ? 'true' : 'false'); // NEW: Fast Mode

      // Call AI Service
      console.log('Calling AI Service at:', `${this.aiServiceUrl}/api/videos/mix/`);
      console.log('Videos per folder limit:', body.videos_per_folder || 10);
      console.log('Fast mode:', body.fast_mode === 'true');

      const response = await this.httpService.axiosRef.post(
        `${this.aiServiceUrl}/api/videos/mix/`,
        formData,
        {
          headers: formData.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600000, // 10 minutes (was 30s)
        }
      );

      console.log('AI Service response:', response.data);

      return response.data;

    } catch (error: any) {
      console.error('========== MIX VIDEO ERROR ==========');
      console.error('Error:', error);
      console.error('Error message:', error.message);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);

      throw new HttpException(
        error.response?.data?.error || error.message || 'Mix video failed',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Auto mix video - BE orchestrates the entire flow
   * 1. Scan base folder for subfolders
   * 2. Call AI Service to batch scan metadata (with PostgreSQL cache)
   * 3. Select best 10 folders (most videos)
   * 4. Call AI Service mix endpoint with selected folders
   */
  async mixVideoAuto(
    mixDto: { base_folder_path: string; num_outputs?: number; width?: number; height?: number; min_videos_per_folder?: number },
    audioFile: any
  ): Promise<any> {
    const { base_folder_path, num_outputs = 5, width = 720, height = 1280, min_videos_per_folder = 1 } = mixDto;

    this.logger.log(`Mix-Video-Auto: Orchestrating mix for base folder: ${base_folder_path}`);

    try {
      // Step 1: Read subfolders from base folder (BE logic)
      const fs = await import('fs');
      const path = await import('path');

      if (!fs.existsSync(base_folder_path)) {
        throw new HttpException(
          `Base folder not found: ${base_folder_path}`,
          HttpStatus.NOT_FOUND
        );
      }

      const entries = fs.readdirSync(base_folder_path, { withFileTypes: true });
      const subfolders = entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(base_folder_path, entry.name));

      if (subfolders.length < 10) {
        throw new HttpException(
          `Need at least 10 subfolders. Found: ${subfolders.length}`,
          HttpStatus.BAD_REQUEST
        );
      }

      this.logger.log(`Found ${subfolders.length} subfolders`);

      // Step 2: Call AI Service to batch scan metadata (with cache!)
      this.logger.log('Calling AI Service to scan folders metadata...');
      const scanUrl = `${this.aiServiceUrl}/api/videos/scan-folder-batch/`;

      const { data: scanResult } = await firstValueFrom(
        this.httpService.post(scanUrl, {
          folder_paths: subfolders,
          use_cache: true,
          recursive: true
        }, {
          timeout: 300000 // 5 minutes for large folders
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`Scan batch error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to scan folders',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );

      this.logger.log(
        `Scan complete: ${scanResult.total_videos} videos in ${scanResult.total_folders} folders. ` +
        `Cache hit rate: ${scanResult.cache_stats?.hit_rate}%`
      );

      // Step 3: Select best 10 folders (BE business logic)
      const validFolders = scanResult.results.filter(
        (folder: any) => folder.video_count >= min_videos_per_folder
      );

      if (validFolders.length < 10) {
        throw new HttpException(
          `Need at least 10 folders with >= ${min_videos_per_folder} videos. Found: ${validFolders.length}`,
          HttpStatus.BAD_REQUEST
        );
      }

      // Sort by video count descending and take top 10
      validFolders.sort((a: any, b: any) => b.video_count - a.video_count);
      const selectedFolders = validFolders.slice(0, 10);

      this.logger.log(
        `Selected 10 folders with total ${selectedFolders.reduce((sum: number, f: any) => sum + f.video_count, 0)} videos`
      );

      // Step 4: Call AI Service mix endpoint with selected folders
      const mixUrl = `${this.aiServiceUrl}/api/videos/mix/`;
      const FormData = (await import('form-data')).default;

      const formData = new FormData();
      formData.append('audio', audioFile.buffer, {
        filename: audioFile.originalname,
        contentType: audioFile.mimetype
      });

      selectedFolders.forEach((folder: any, index: number) => {
        formData.append(`folder_paths_${index}`, folder.path);
      });

      formData.append('width', width.toString());
      formData.append('height', height.toString());
      formData.append('num_outputs', num_outputs.toString());

      this.logger.log('Calling AI Service to mix videos...');

      const { data: mixResult } = await firstValueFrom(
        this.httpService.post(mixUrl, formData, {
          headers: formData.getHeaders(),
          timeout: 3600000 // 60 minutes for mixing
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`Mix error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to start mix',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );

      // Return progress_id and metadata
      return {
        progress_id: mixResult.progress_id,
        selected_folders: selectedFolders.map((f: any) => ({
          name: f.name,
          video_count: f.video_count
        })),
        total_videos: selectedFolders.reduce((sum: number, f: any) => sum + f.video_count, 0),
        cache_stats: scanResult.cache_stats
      };

    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Mix-Video-Auto error: ${error.message}`);
      throw new HttpException(
        error.message || 'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get mix video status
   */
  async getMixStatus(progressId: string): Promise<any> {
    const url = `${this.aiServiceUrl}/api/videos/mix/status/${progressId}/`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url).pipe(
          catchError((error: AxiosError) => {
            throw new HttpException(
              error.response?.data || 'Failed to get status',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      return data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cancel mix video
   */
  async cancelMix(progressId: string): Promise<any> {
    const url = `${this.aiServiceUrl}/api/videos/mix/cancel/${progressId}/`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {}).pipe(
          catchError((error: AxiosError) => {
            throw new HttpException(
              error.response?.data || 'Failed to cancel',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      return data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Mix video with folder uploads
   * Handles multipart/form-data với folder_0..folder_9 và audio
   */
  async mixVideoUpload(req: any): Promise<any> {
    const FormData = require('form-data');
    const multer = require('multer');
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    return new Promise(async (resolve, reject) => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-upload-'));
      const storage = multer.diskStorage({
        destination: (req: any, file: any, cb: any) => {
          cb(null, tempDir);
        },
        filename: (req: any, file: any, cb: any) => {
          cb(null, file.originalname);
        }
      });

      const upload = multer({ storage }).any();

      upload(req, req.res, async (err: any) => {
        if (err) {
          this.logger.error(`Upload error: ${err.message}`);
          fs.rmSync(tempDir, { recursive: true, force: true });
          return reject(new HttpException('Upload failed', HttpStatus.BAD_REQUEST));
        }

        try {
          const files = req.files || [];
          const body = req.body || {};

          // Group files by folder slots
          const folderSlots: { [key: string]: any[] } = {};
          let audioFile: any = null;

          files.forEach((file: any) => {
            if (file.fieldname === 'audio') {
              audioFile = file;
            } else if (file.fieldname.startsWith('folder_')) {
              if (!folderSlots[file.fieldname]) {
                folderSlots[file.fieldname] = [];
              }
              folderSlots[file.fieldname].push(file);
            }
          });

          if (!audioFile) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return reject(new HttpException('Audio file is required', HttpStatus.BAD_REQUEST));
          }

          const filledSlots = Object.keys(folderSlots).filter(k => folderSlots[k].length > 0);
          if (filledSlots.length === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return reject(new HttpException('At least one folder with videos is required', HttpStatus.BAD_REQUEST));
          }

          this.logger.log(`Received ${filledSlots.length} folder slots with ${files.length - 1} total videos`);

          // Create FormData để forward sang AI Service
          const formData = new FormData();

          // Append audio
          formData.append('audio', fs.createReadStream(audioFile.path), {
            filename: audioFile.originalname,
            contentType: audioFile.mimetype
          });

          // Append video files cho từng slot
          Object.keys(folderSlots).forEach(slotKey => {
            folderSlots[slotKey].forEach((file: any) => {
              formData.append(slotKey, fs.createReadStream(file.path), {
                filename: file.originalname,
                contentType: file.mimetype
              });
            });
          });

          // Append params
          formData.append('width', body.width || '720');
          formData.append('height', body.height || '1280');
          formData.append('num_outputs', body.num_outputs || '5');

          // Call AI Service
          const url = `${this.aiServiceUrl}/api/videos/mix-upload/`;
          this.logger.log(`Calling AI Service: ${url}`);

          const { data } = await firstValueFrom(
            this.httpService.post(url, formData, {
              headers: formData.getHeaders(),
              timeout: 3600000, // 1 hour
              maxContentLength: Infinity,
              maxBodyLength: Infinity
            }).pipe(
              catchError((error: AxiosError) => {
                this.logger.error(`AI Service error: ${error.message}`, error.response?.data);
                throw new HttpException(
                  error.response?.data || 'Failed to mix videos',
                  error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
                );
              })
            )
          );

          // Cleanup temp files
          fs.rmSync(tempDir, { recursive: true, force: true });

          resolve({
            progress_id: data.progress_id,
            uploaded_slots: filledSlots.map(k => parseInt(k.replace('folder_', ''))),
            total_videos: files.length - 1, // Exclude audio
            estimated_time: '5-10 minutes'
          });

        } catch (error: any) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (error instanceof HttpException) {
            reject(error);
          } else {
            this.logger.error(`Mix upload error: ${error.message}`);
            reject(new HttpException(
              error.message || 'Internal server error',
              HttpStatus.INTERNAL_SERVER_ERROR
            ));
          }
        }
      });
    });
  }

  /**
   * Get available voices, including custom cloned ones and system ones.
   */
  async listVoices(): Promise<any> {
    const url = `${this.voiceAiServiceUrl}/api/voice/list/`;
    this.logger.log(`Calling AI Service: GET ${url}`);
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error listing voices: ${error.message}`);
            throw new HttpException(
              error.response?.data || 'Failed to list voices',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      // Kèm đơn giá để FE hiển thị ước tính tiền ngay tại ô nhập kịch bản
      if (data && typeof data === 'object') {
        data.pricing = { vnd_per_1k_chars: this.minimaxVndPer1kChars };
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to list voices', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Clone a voice from uploaded sample audio
   */
  async cloneVoice(file: any, voiceName: string, gender = 'female'): Promise<any> {
    const FormData = require('form-data');
    const url = `${this.voiceAiServiceUrl}/api/voice/clone/`;
    this.logger.log(`Calling AI Service: POST ${url} for voiceName=${voiceName}`);

    try {
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });
      formData.append('voice_name', voiceName);
      formData.append('gender', gender || 'female');

      const { data } = await firstValueFrom(
        this.httpService.post(url, formData, {
          headers: { ...formData.getHeaders(), ...this.minimaxHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // AI service retries upload+clone up to 3x60s each on network blips to
          // api.minimax.io (worst case ~360s) — keep this above that ceiling.
          timeout: 480000,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error cloning voice: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to clone voice',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to clone voice', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Start voice cloning as a background job on the AI service (returns job_id
   * immediately). Mạng tới api.minimax.io có thể chập chờn vài phút — clone
   * đồng bộ (cloneVoice ở trên) dễ khiến FE/BE tự timeout dù MiniMax cuối cùng
   * vẫn xử lý xong. Dùng cloneVoiceStatus() để poll kết quả.
   */
  async cloneVoiceStart(file: any, voiceName: string, gender = 'female'): Promise<any> {
    const FormData = require('form-data');
    const url = `${this.voiceAiServiceUrl}/api/voice/clone/start/`;
    this.logger.log(`Calling AI Service: POST ${url} for voiceName=${voiceName}`);

    try {
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });
      formData.append('voice_name', voiceName);
      formData.append('gender', gender || 'female');

      const { data } = await firstValueFrom(
        this.httpService.post(url, formData, {
          headers: { ...formData.getHeaders(), ...this.minimaxHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // Chỉ upload file + spawn job nền trên AI service, không chờ clone
          // xong — nên không cần timeout dài như bản đồng bộ.
          timeout: 60000,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error starting voice clone: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to start voice clone',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to start voice clone', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Poll status of a background voice-clone job started via cloneVoiceStart(). */
  async cloneVoiceStatus(jobId: string, userId?: string): Promise<any> {
    const url = `${this.voiceAiServiceUrl}/api/voice/clone/status/${jobId}/`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, { timeout: 15000 }).pipe(
          catchError((error: AxiosError) => {
            throw new HttpException(
              error.response?.data || 'Failed to get voice clone status',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      // Ghi log 1 lần khi job hoàn tất — job_id unique nên các lần poll sau bị
      // bỏ qua (P2002). Lỗi ghi log không được làm hỏng response poll.
      if (userId && data?.status === 'completed') {
        try {
          await this.prisma.aiVoiceUsage.create({
            data: {
              user_id: userId,
              kind: 'clone',
              voice_id: data.voice?.voice_id ?? null,
              job_id: jobId,
            },
          });
        } catch (logErr: any) {
          if (logErr?.code !== 'P2002') {
            this.logger.warn(`Failed to log clone usage for user ${userId}: ${logErr.message}`);
          }
        }
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to get voice clone status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Xoá hẳn một giọng đã clone: AI service xoá trên MiniMax rồi xoá bản ghi Voice.
   *
   * Timeout 60s (dài hơn poll status 15s): đường truyền tới api.minimax.io hay
   * chập chờn nên delete_voice bên AI đã có sẵn 3 lần thử x 30s.
   */
  async deleteClonedVoice(voiceId: string): Promise<any> {
    const url = `${this.voiceAiServiceUrl}/api/voice/delete/${encodeURIComponent(voiceId)}/`;
    this.logger.log(`Calling AI Service: DELETE ${url}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.delete(url, { headers: this.minimaxHeaders(), timeout: 60000 }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error deleting voice: ${error.message}`, error.response?.data as any);
            throw new HttpException(
              error.response?.data || 'Failed to delete voice',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to delete voice', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate task-auto video script (adapt content đã "win" cho sản phẩm mới).
   * AI Service chịu trách nhiệm đọc file nguồn + build prompt + gọi DeepSeek;
   * BE chỉ nhận kết quả về để cache/lưu (xem VideoScriptService).
   */
  async generateVideoScript(params: {
    fileUrl?: string | null;
    scriptText?: string | null;
    contentTitle?: string | null;
    contentLine?: string | null;
    contentMarket?: string | null;
    productName?: string | null;
    productSku?: string | null;
    productPrice?: string | null;
    productMaterial?: string | null;
    productPriceSegment?: string | null;
    productLine?: string | null;
    productMarket?: string | null;
  }): Promise<any> {
    const url = `${this.aiServiceUrl}/api/task-auto/video-script/generate/`;
    this.logger.log(`Calling AI Service: ${url} for productName=${params.productName}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, params, {
          timeout: 120000, // DeepSeek generation can take a while
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service video-script error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to generate video script',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to generate video script', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Dịch caption/mô tả 1 video đã cào (scraper subsystem) sang tiếng Việt +
   * phân tích ngắn cấu trúc video gốc — dùng cho luồng duyệt video vào
   * VideoLibrary/ApprovedContent (xem VideoLibraryService.approveIntoLibrary()).
   * KHÔNG dùng chung endpoint với generateVideoScript() — đó là adapt content
   * đã win cho sản phẩm mới, không hợp với video cào về không gắn sản phẩm nào.
   */
  async analyzeScrapedVideo(params: {
    platform: string;
    title: string;
    description: string;
    hashtags?: string[];
    viewsCount?: number;
    likesCount?: number;
    commentsCount?: number;
  }): Promise<{ vietnamese_content: string; script_outline: string; hashtags: string[] }> {
    const url = `${this.aiServiceUrl}/api/scraped-video/script/generate/`;
    this.logger.log(`Calling AI Service: ${url} for platform=${params.platform}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          platform: params.platform,
          title: params.title,
          description: params.description,
          hashtags: params.hashtags,
          views_count: params.viewsCount,
          likes_count: params.likesCount,
          comments_count: params.commentsCount,
        }, {
          timeout: 120000,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service scraped-video script error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to analyze scraped video',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to analyze scraped video', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Dịch từ khoá tìm kiếm (tiếng Việt/Anh) sang tiếng Trung giản thể — dùng cho các nền tảng
   * Trung Quốc (Douyin/Xiaohongshu/Kuaishou/Bilibili) vốn chỉ ra kết quả tốt với query tiếng Trung.
   *
   * Endpoint AI đã tự bỏ qua khi text vốn đã là tiếng Trung (trả source='already_chinese'),
   * nên caller cứ gọi thẳng không cần tự kiểm tra.
   *
   * KHÔNG ném lỗi ra ngoài: dịch chỉ là bước phụ trợ, nếu AI service chết thì trả lại text gốc
   * để luồng tìm kiếm/cron vẫn chạy được thay vì vỡ nguyên request.
   */
  async translateSearchKeyword(
    text: string,
  ): Promise<{ original: string; translated: string; source: string }> {
    const original = (text || '').trim();
    if (!original) return { original: '', translated: '', source: 'empty' };

    const url = `${this.aiServiceUrl}/api/search/translate/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, { text: original }, { timeout: 20000 }).pipe(
          catchError((error: AxiosError) => {
            this.logger.warn(`AI Service search/translate lỗi: ${error.message}`);
            throw error;
          }),
        ),
      );
      const translated = (data?.translated || '').trim();
      if (!translated) return { original, translated: original, source: 'fallback_empty' };
      return { original, translated, source: data?.source || 'unknown' };
    } catch {
      // Fail-open: giữ nguyên text gốc, caller vẫn tìm được (chỉ là kết quả kém hơn).
      return { original, translated: original, source: 'failed' };
    }
  }

  /**
   * Lấy chi tiết 1 video (view/tim/bình luận/chia sẻ/tiêu đề/ảnh bìa) theo (platform, video_id).
   *
   * Dùng cho luồng đề xuất video: extension chỉ moi được mã video từ URL, còn số liệu đọc trên
   * trang thì không đáng tin (bảng tin nhúng JSON của nhiều video, trang SPA thì state đã cũ).
   *
   * Fail-open: hỏng thì trả null, KHÔNG ném — đề xuất vẫn phải đi tiếp, chỉ là thiếu số liệu.
   * Facebook không hỗ trợ (TikHub không có endpoint nào cho Facebook).
   */
  async fetchVideoDetail(params: {
    platform: string;
    videoId?: string;
    videoUrl?: string;
  }): Promise<VideoDetailResult | null> {
    const platform = (params.platform || '').toLowerCase().trim();
    if (!platform) return null;

    const url = `${this.aiServiceUrl}/api/scraper/video-detail/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService
          .post(
            url,
            {
              platform,
              video_id: params.videoId || '',
              video_url: params.videoUrl || '',
            },
            // Ngan hon thoi gian cho cua route FE de FE khong bo cuoc truoc BE.
            { timeout: 30000 },
          )
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.warn(`AI Service scraper/video-detail lỗi: ${error.message}`);
              throw error;
            }),
          ),
      );
      if (!data?.success || !data?.data) {
        this.logger.log(
          `[video-detail] ${platform} không lấy được: ${data?.error || 'không rõ lý do'}`,
        );
        return null;
      }
      return data.data as VideoDetailResult;
    } catch {
      return null;
    }
  }

  /**
   * Lấy link phát trực tiếp (mp4) để BE làm trung gian phát video ngay trên web hệ thống.
   *
   * Chỉ có tác dụng với Douyin/Kuaishou/Xiaohongshu — 5 nền tảng còn lại dùng mã nhúng chính
   * chủ nên FE không gọi tới đây. Link CÓ HẠN (~3 giờ) nên KHÔNG được lưu vào DB, chỉ cache.
   *
   * Fail-open: hỏng thì trả null để chỗ gọi báo lỗi tử tế, không ném.
   */
  async fetchVideoPlayUrl(params: {
    platform: string;
    videoId?: string;
    videoUrl?: string;
    /** Bỏ qua bộ đệm phía AI. Dùng khi vừa gặp 403 vì link cũ hết hạn — không có cờ này
     *  thì AI trả lại đúng cái link vừa hỏng và vòng thử lại của controller thành vô nghĩa. */
    forceRefresh?: boolean;
  }): Promise<string | null> {
    const platform = (params.platform || '').toLowerCase().trim();
    if (!platform) return null;

    const url = `${this.aiServiceUrl}/api/scraper/play-url/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService
          .post(
            url,
            {
              platform,
              video_id: params.videoId || '',
              video_url: params.videoUrl || '',
              force_refresh: params.forceRefresh === true,
            },
            { timeout: 30000 },
          )
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.warn(`AI Service scraper/play-url lỗi: ${error.message}`);
              throw error;
            }),
          ),
      );
      if (!data?.success || !data?.play_url) {
        // Het so du TikHub thi keu THAT TO: ca 4 nen tang chet cung luc, va cach chua la nap
        // tien chu khong phai sua code. Gom chung vao mot dong log 'khong lay duoc' nhu truoc
        // khien viec do loi di rat lech huong.
        if (data?.reason === 'no_credit') {
          this.logger.error(
            `[play-url] TAI KHOAN TIKHUB DA HET SO DU — moi video cua douyin/tiktok/xiaohongshu/kuaishou ` +
            `deu se khong phat duoc cho toi khi nap them. https://user.tikhub.io/users/add_credit`,
          );
          throw new PlayUrlNoCreditError();
        }
        this.logger.log(`[play-url] ${platform} khong lay duoc: ${data?.reason || 'khong ro'}`);
        return null;
      }
      return String(data.play_url);
    } catch (err) {
      // Loi het so du phai di tiep len tren de controller bao dung nguyen nhan cho nguoi dung.
      if (err instanceof PlayUrlNoCreditError) throw err;
      return null;
    }
  }

  /**
   * Dịch lại content/hashtags hiện có (vd sau khi user sửa tay) sang một ngôn ngữ đã biết trước —
   * không đọc lại file nguồn, không sinh script mới, chỉ dịch (xem VideoScriptService.translate()).
   */
  async translateVideoScript(params: {
    content: string;
    hashtags: string[];
    language?: string;
    market?: string;
  }): Promise<any> {
    const url = `${this.aiServiceUrl}/api/task-auto/video-script/translate/`;
    this.logger.log(
      `Calling AI Service: ${url} for language=${params.language ?? "(auto từ market=" + params.market + ")"}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, params, {
          timeout: 120000,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service video-script translate error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to translate video script',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to translate video script', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Đưa file audio TTS từ AI service về nơi công khai:
   * 1. Rewrite host của audio_url về aiServiceUrl (AI có thể trả localhost nếu máy
   *    chạy AI chưa set AI_SERVICE_URL trong .env của nó).
   * 2. Upload lên Google Drive công ty → link vĩnh viễn, không phụ thuộc máy AI.
   * Không bao giờ throw — TTS đã thành công thì tệ nhất người dùng vẫn nhận link qua tunnel.
   *
   * Trả kèm fileId (khi upload Drive thành công) để FE phát/tải audio qua proxy
   * BE (streamTtsAudio) — link Drive uc?export=download KHÔNG stream chuẩn cho
   * trình duyệt: <audio> không đọc được duration (hiện 00:00), <a download>
   * cross-origin bị bỏ qua và điều hướng sang Drive hay lỗi.
   */
  private async publishTtsAudio(aiAudioUrl: string): Promise<{ url: string; fileId: string | null }> {
    let sourceUrl = aiAudioUrl;
    try {
      const parsed = new URL(aiAudioUrl);
      // Chỉ rewrite link media NỘI BỘ của AI (/media/...) — AI có nhánh fallback trả
      // thẳng URL CDN của MiniMax (link ngoài, vẫn phát được); rewrite link đó sẽ tạo
      // ra đường dẫn tunnel không tồn tại.
      // KHÔNG dùng thẳng /media/minimax_tts/<file> — Django chỉ serve /media qua static()
      // khi DEBUG=True, trên server thật (DEBUG=False) link này 404 nên uploadFromUrl()
      // luôn fail âm thầm và Drive không bao giờ nhận được file dù đã cấu hình đúng.
      // Dùng route whitelist /api/voice/tts/file/<file> (serve_minimax_tts_file) — hoạt
      // động cả khi DEBUG=False.
      const mediaMatch = /^\/media\/minimax_tts\/(tts_[0-9a-f]{32}\.mp3)$/i.exec(parsed.pathname);
      if (mediaMatch) {
        sourceUrl = `${this.voiceAiServiceUrl.replace(/\/$/, '')}/api/voice/tts/file/${mediaMatch[1]}`;
      }
    } catch {
      return { url: aiAudioUrl, fileId: null };
    }

    try {
      let filename =
        (sourceUrl.split('/').pop() || '').split('?')[0] || `tts_${Date.now()}.mp3`;
      // Proxy stream (streamTtsAudio) chỉ phục vụ file tên tts_*.mp3 — ép prefix
      // cho cả nhánh fallback URL CDN MiniMax (tên file bất kỳ).
      if (!/^tts_/i.test(filename)) filename = `tts_${Date.now()}.mp3`;
      // Gom toàn bộ audio TTS về 1 nơi: Root/TTS Audio/{YYYY-MM-DD}/ (cùng kiểu
      // với Scraper Cào Dữ Liệu) thay vì rải vào từng folder ngày dùng chung.
      const folderId = await this.driveStorage.resolveDatedFolder('TTS Audio');
      const driveUrl = await this.driveStorage.uploadFromUrl(sourceUrl, filename, 'audio/mpeg', {
        folderId,
      });
      if (driveUrl) {
        this.logger.log(`TTS audio uploaded to Drive: ${driveUrl}`);
        // uploadFromUrl trả URL dạng uc?...&id=<fileId> — lấy lại fileId từ đó
        // để khỏi đổi chữ ký hàm dùng chung với các module scraper.
        let fileId: string | null = null;
        try {
          fileId = new URL(driveUrl).searchParams.get('id');
        } catch { /* giữ fileId null — FE fallback về link Drive */ }
        return { url: driveUrl, fileId };
      }
    } catch (err: any) {
      this.logger.warn(`TTS audio Drive upload failed, falling back to source URL: ${err.message}`);
    }
    return { url: sourceUrl, fileId: null };
  }

  /**
   * Upload thẳng bytes TTS (base64 AI trả kèm response POST /voice/tts/) lên
   * Drive — không GET ngược lại đĩa cục bộ của AI như publishTtsAudio() (fragile
   * trên Railway multi-replica, xem generateTTS()). Drive lỗi/chưa cấu hình →
   * nhúng bytes vào data: URL để FE phát/tải trực tiếp, không phụ thuộc AI hay
   * Drive nữa. Không bao giờ throw, luôn trả được ít nhất data: URL.
   */
  private async publishTtsAudioFromBase64(base64: string): Promise<{ url: string; fileId: string | null }> {
    const dataUrl = `data:audio/mpeg;base64,${base64}`;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return { url: dataUrl, fileId: null };

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpPath = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      const folderId = await this.driveStorage.resolveDatedFolder('TTS Audio');
      const uploaded = await this.driveStorage.uploadFromPath(tmpPath, path.basename(tmpPath), 'audio/mpeg', undefined, { folderId });
      return { url: uploaded.url, fileId: uploaded.fileId };
    } catch (err: any) {
      this.logger.warn(`TTS audio Drive upload (base64) failed, falling back to data URL: ${err.message}`);
      return { url: dataUrl, fileId: null };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* tmp file có thể chưa từng tạo */ }
    }
  }

  /**
   * Stream file TTS audio từ Drive về trình duyệt (phát trực tiếp hoặc tải về).
   * Route này công khai vì thẻ <audio> không gửi được JWT header — bù lại chỉ
   * phục vụ đúng file TTS (tên tts_*.mp3, mimeType audio/*), không cho lấy file
   * Drive tùy ý qua service account.
   */
  async streamTtsAudio(fileId: string, res: any, download = false, rangeHeader?: string, downloadName?: string): Promise<void> {
    let file: Awaited<ReturnType<GoogleDriveStorageService['openReadStream']>>;
    try {
      file = await this.driveStorage.openReadStream(fileId, rangeHeader);
    } catch (err: any) {
      this.logger.warn(`streamTtsAudio: cannot open Drive file ${fileId}: ${err.message}`);
      throw new HttpException('Audio file not found', HttpStatus.NOT_FOUND);
    }

    const isTtsAudio = /^tts_[\w.-]+\.mp3$/i.test(file.name) && (file.mimetype || '').startsWith('audio/');
    if (!isTtsAudio) {
      (file.stream as any).destroy?.();
      throw new HttpException('Not a TTS audio file', HttpStatus.FORBIDDEN);
    }

    res.status(file.status);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.contentRange) res.setHeader('Content-Range', file.contentRange);
    const length = file.contentLength ?? (file.status === 200 && file.size ? file.size : undefined);
    if (length) res.setHeader('Content-Length', String(length));
    // Tên file khi tải về: ưu tiên tên FE truyền qua ?filename= (vd "HuyK_2026-07-16_1435.mp3"
    // — dễ đọc hơn tên tts_<hex>.mp3 trên Drive). Sanitize để chống header injection /
    // ký tự cấm trên Windows; tên có dấu tiếng Việt gửi qua filename* (RFC 5987).
    let outName = file.name;
    if (download && downloadName) {
      const cleaned = downloadName.replace(/[\r\n\/\\:*?"<>|]+/g, ' ').trim().slice(0, 150);
      if (cleaned) outName = /\.mp3$/i.test(cleaned) ? cleaned : `${cleaned}.mp3`;
    }
    const asciiName = outName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const utf8Name = encodeURIComponent(outName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    );
    // Drive đứt kết nối giữa chừng → kết thúc response thay vì để trình duyệt chờ treo
    (file.stream as any).on?.('error', (err: any) => {
      this.logger.warn(`streamTtsAudio: stream error for ${fileId}: ${err?.message}`);
      try { res.end(); } catch { /* response có thể đã đóng */ }
    });
    file.stream.pipe(res);
  }

  /**
   * Generate Text-to-Speech using Minimax
   */
  async generateTTS(text: string, voiceId: string, speed = 1.0, pitch = 0, volume = 100, language?: string, userId?: string): Promise<any> {
    const url = `${this.voiceAiServiceUrl}/api/voice/tts/`;
    this.logger.log(`Calling AI Service: POST ${url} for voiceId=${voiceId}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          text,
          voice_id: voiceId,
          speed,
          pitch,
          volume,
          language
        }, {
          headers: this.minimaxHeaders(),
          timeout: 300000, // TTS on long text can take a while; module default (30s) is too short
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service error in TTS: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to generate voice',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
          })
        )
      );
      // AI trả kèm audio_base64 (bytes thật của file vừa sinh) — dùng thẳng bytes
      // đó để upload Drive thay vì GET ngược lại route local-disk của AI
      // (publishTtsAudio/streamTtsAudioFromAi): route đó chỉ đọc được file nếu
      // request rơi đúng instance/đĩa vừa ghi, trên Railway (nhiều replica, không
      // volume dùng chung) gần như luôn 404 ngay cả khi gọi lại tức thì — xác
      // minh thực tế 2026-07-20, audio_file_id luôn null và /tts/stream 404.
      if (data?.success && data.audio_base64) {
        const published = await this.publishTtsAudioFromBase64(String(data.audio_base64));
        data.audio_url = published.url;
        // Có audio_file_id → FE phát/tải qua GET ai/voice/tts/audio/:fileId (proxy
        // BE stream chuẩn từ Drive). Drive lỗi/chưa cấu hình → audio_url là
        // data: URL nhúng thẳng bytes — FE phát/tải trực tiếp, không phụ thuộc AI
        // hay Drive nữa (audio_file_name bỏ hẳn, route đó không còn dùng).
        data.audio_file_id = published.fileId;
        delete data.audio_base64;
      } else if (data?.success && data.audio_url) {
        // Fallback cho AI chưa deploy bản trả audio_base64 (rollout lệch giữa 2
        // service) — giữ nguyên đường đi cũ, vẫn còn nguy cơ 404 như trên.
        const published = await this.publishTtsAudio(String(data.audio_url));
        data.audio_url = published.url;
        data.audio_file_id = published.fileId;
        if (!published.fileId) {
          const m = /(tts_[0-9a-f]{32}\.mp3)$/i.exec(published.url);
          data.audio_file_name = m ? m[1] : null;
        }
      }
      // Ghi log tiêu dùng cho trang Tổng quan AI — usage_characters là số ký tự
      // MiniMax thực tính phí (đơn vị "điểm âm thanh" của gói). Lỗi ghi log không
      // được làm hỏng response TTS đã thành công.
      if (userId && data?.success) {
        try {
          await this.prisma.aiVoiceUsage.create({
            data: {
              user_id: userId,
              kind: 'tts',
              voice_id: voiceId,
              characters: Number(data.usage_characters) || 0,
              duration_ms: Number(data.duration) || 0,
            },
          });
        } catch (logErr: any) {
          this.logger.warn(`Failed to log TTS usage for user ${userId}: ${logErr.message}`);
        }
      }
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to generate voice', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Tổng hợp tiêu dùng MiniMax voice (điểm ký tự TTS + số giọng đã clone),
   * kèm phân rã theo từng user — nguồn dữ liệu cho trang Tổng quan Tiện ích AI.
   */
  async getVoiceUsageStats(dateFrom?: string, dateTo?: string): Promise<any> {
    const where: any = {};
    const range = buildVoiceUsageDateRange(dateFrom, dateTo);
    if (range) where.created_at = range;

    const rows = await this.prisma.aiVoiceUsage.findMany({
      where,
      include: { user: { select: { id: true, full_name: true, email: true } } },
      orderBy: { created_at: 'desc' },
    });

    const byUser = new Map<string, any>();
    let totalCharacters = 0;
    let totalTts = 0;
    let totalClones = 0;

    for (const row of rows) {
      let entry = byUser.get(row.user_id);
      if (!entry) {
        entry = {
          user_id: row.user_id,
          full_name: row.user?.full_name ?? row.user_id,
          email: row.user?.email ?? '',
          characters: 0,
          tts_count: 0,
          clone_count: 0,
          last_used_at: row.created_at,
        };
        byUser.set(row.user_id, entry);
      }
      if (row.kind === 'tts') {
        entry.characters += row.characters;
        entry.tts_count += 1;
        totalCharacters += row.characters;
        totalTts += 1;
      } else if (row.kind === 'clone') {
        entry.clone_count += 1;
        totalClones += 1;
      }
      if (row.created_at > entry.last_used_at) entry.last_used_at = row.created_at;
    }

    // Quy đổi điểm đã tiêu ra tiền theo đơn giá cấu hình (0 = chưa cấu hình, FE ẩn phần tiền)
    const toVnd = (chars: number) => Math.round((chars / 1000) * this.minimaxVndPer1kChars);
    const byUserList = [...byUser.values()]
      .map((u) => ({ ...u, cost_vnd: toVnd(u.characters) }))
      .sort((a, b) => b.characters - a.characters);

    return {
      success: true,
      pricing: { vnd_per_1k_chars: this.minimaxVndPer1kChars },
      total: {
        characters: totalCharacters,
        tts_count: totalTts,
        clone_count: totalClones,
        cost_vnd: toVnd(totalCharacters),
      },
      by_user: byUserList,
    };
  }

  /**
   * Fallback không-Drive: stream file TTS thẳng từ AI service về trình duyệt.
   * Dùng khi Drive chưa cấu hình/upload lỗi (generateTTS trả audio_file_name).
   * AI serve file qua /api/voice/tts/file/<filename> — route thường, hoạt động
   * cả khi DEBUG=False (link /media/... chỉ sống khi DEBUG=True).
   */
  async streamTtsAudioFromAi(filename: string, res: any, download = false, downloadName?: string, rangeHeader?: string): Promise<void> {
    if (!/^tts_[0-9a-f]{32}\.mp3$/i.test(filename || '')) {
      throw new HttpException('Invalid TTS filename', HttpStatus.BAD_REQUEST);
    }
    let response: any;
    try {
      response = await this.httpService.axiosRef.get(
        `${this.voiceAiServiceUrl}/api/voice/tts/file/${filename}`,
        {
          responseType: 'stream',
          timeout: 0,
          headers: rangeHeader ? { Range: rangeHeader } : undefined,
          validateStatus: (s) => s === 200 || s === 206,
        },
      );
    } catch (error: any) {
      throw new HttpException(
        error.response?.status === 404 ? 'Audio file not found' : (error.message || 'Không kết nối được tới AI service.'),
        error.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
    // Forward nguyên trạng thái 200/206 + Content-Range của AI — <audio> của trình
    // duyệt cần Accept-Ranges/206 để đọc được duration mp3 streamed, thiếu thì player
    // kẹt ở 0:00/0:00 (cùng lỗi từng vá cho nhánh Drive, xem streamTtsAudio()).
    res.status(response.status);
    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    const contentRange = response.headers['content-range'];
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = response.headers['content-length'];
    if (contentLength) res.setHeader('Content-Length', contentLength);
    // Tên file tải về: cùng logic sanitize với streamTtsAudio (chống header injection,
    // ký tự cấm Windows; tên có dấu tiếng Việt gửi qua filename* RFC 5987).
    let outName = filename;
    if (download && downloadName) {
      const cleaned = downloadName.replace(/[\r\n\/\\:*?"<>|]+/g, ' ').trim().slice(0, 150);
      if (cleaned) outName = /\.mp3$/i.test(cleaned) ? cleaned : `${cleaned}.mp3`;
    }
    const asciiName = outName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const utf8Name = encodeURIComponent(outName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    );
    response.data.on('error', (err: any) => {
      this.logger.warn(`streamTtsAudioFromAi: stream error for ${filename}: ${err?.message}`);
      try { res.end(); } catch { /* response có thể đã đóng */ }
    });
    response.data.pipe(res);
  }

  // ═══════════════════════════════════════════════════════════════
  // Tiện ích tải video (trang dashboard/tools/video-downloader + extension VCB)
  // Quy tắc FE → BE → AI: Next route proxy same-origin của FE gọi vào đây,
  // BE mới là bên gọi sang AI service (yt-dlp) — FE không nối thẳng AI.
  // ═══════════════════════════════════════════════════════════════

  private videoDownloaderUrl(path: string): string {
    return `${this.aiServiceUrl}/api/tools/video-downloader/${path}`;
  }

  /**
   * Các endpoint video-downloader bên AI (video_management/views/video_downloader_views.py)
   * yêu cầu IsAuthenticated qua NestJWTAuthentication — cùng cơ chế token nội bộ mà
   * TiktokAiClientService/... đã dùng, chứ không forward JWT của user gọi request gốc.
   */
  private videoDownloaderAuthHeaders(): { Authorization: string } {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  /** Lỗi từ AI trả nguyên body về FE (trang đọc data.error để hiện toast). */
  private rethrowVideoDownloaderError(error: any): never {
    throw new HttpException(
      error.response?.data ?? { success: false, error: error.message || 'Không kết nối được tới AI service.' },
      error.response?.status || HttpStatus.BAD_GATEWAY,
    );
  }

  async videoDownloaderInfo(body: { url: string }): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.post(this.videoDownloaderUrl('info/'), body, {
        headers: { 'Content-Type': 'application/json', ...this.videoDownloaderAuthHeaders() },
        timeout: 120000, // yt-dlp extract info có thể chậm với link lạ
      });
      return response.data;
    } catch (error: any) {
      this.rethrowVideoDownloaderError(error);
    }
  }

  async videoDownloaderStartJob(body: { url: string; type?: string; quality?: string }): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.post(this.videoDownloaderUrl('jobs/'), body, {
        headers: { 'Content-Type': 'application/json', ...this.videoDownloaderAuthHeaders() },
        timeout: 30000,
      });
      return response.data;
    } catch (error: any) {
      this.rethrowVideoDownloaderError(error);
    }
  }

  async videoDownloaderJobStatus(jobId: string): Promise<any> {
    try {
      const response = await this.httpService.axiosRef.get(
        this.videoDownloaderUrl(`jobs/${encodeURIComponent(jobId)}/`),
        { headers: this.videoDownloaderAuthHeaders(), timeout: 30000 },
      );
      return response.data;
    } catch (error: any) {
      this.rethrowVideoDownloaderError(error);
    }
  }

  /** Stream file đã tải xong từ AI về FE, giữ Content-Disposition để FE lấy tên file. */
  async videoDownloaderJobFile(jobId: string, res: any): Promise<void> {
    try {
      const response = await this.httpService.axiosRef.get(
        this.videoDownloaderUrl(`jobs/${encodeURIComponent(jobId)}/file/`),
        { headers: this.videoDownloaderAuthHeaders(), responseType: 'stream', timeout: 0 }, // file video lớn — không giới hạn thời gian stream
      );
      res.status(response.status);
      for (const h of ['content-type', 'content-length', 'content-disposition', 'accept-ranges']) {
        const v = response.headers[h];
        if (v) res.setHeader(h, v);
      }
      response.data.on('error', (err: any) => {
        this.logger.warn(`videoDownloaderJobFile: stream error for job ${jobId}: ${err?.message}`);
        try { res.end(); } catch { /* response có thể đã đóng */ }
      });
      response.data.pipe(res);
    } catch (error: any) {
      // error.response.data lúc này là stream — không đưa vào body lỗi
      throw new HttpException(
        error.response?.status === 404 ? 'Không tìm thấy file của tiến trình tải.' : (error.message || 'Không kết nối được tới AI service.'),
        error.response?.status || HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAAST — chấm điểm content theo khung PAAST (5 lớp x 6 tiêu chí). Gộp về đây
  // (thay vì module `paast-analyzer` riêng) vì cùng là orchestration gọi AI
  // service (Django) qua aiServiceUrl, giống mọi tính năng khác trong service
  // này — tách module riêng chỉ để "gọi 1 endpoint AI khác" là thừa.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Tìm bản phân tích PAAST gần nhất khớp ĐÚNG nội dung này (nếu có) — để FE tránh gọi phân tích lại
   * khi content không đổi, kể cả sau khi user reload trang (cache trong React state bị mất khi remount,
   * nhưng bản ghi trong DB thì còn).
   *
   * Cố ý KHÔNG lọc theo user: kết quả chấm PAAST chỉ phụ thuộc nội dung, nên editor chấm xong thì
   * leader mở cùng content phải thấy lại kết quả đó thay vì tốn 1 lần gọi LLM chấm lại.
   */
  async findLatestByContent(content: string) {
    return this.prisma.paastAnalysisHistory.findFirst({
      where: { input_text: content, status: TransformStatus.SUCCESS },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Phân tích content theo khung PAAST (5 lớp x 6 tiêu chí), tính điểm 0-100, lưu lịch sử.
   */
  async analyzeContent(userId: string, dto: AnalyzeContentDto) {
    const history = await this.prisma.paastAnalysisHistory.create({
      data: {
        user_id: userId,
        input_text: dto.content,
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze/`,
          { content: dto.content },
          { timeout: 60000 },
        ),
      );

      const { layers, total_score, verdict, cta_warning } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: { layers, cta_warning, verdict },
          total_score: total_score,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST content: ${error.message}`);
      const errMsg = error.response?.data?.error || error.message || 'Lỗi không xác định trong quá trình phân tích';

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Phân tích PAAST BẢN 2 — dùng cho video kênh nội bộ.
   *
   * Khác bản 1: không có thang điểm 0–100 (chỉ đếm element + kết luận đạt/chưa) và có thêm
   * 16 hook gợi ý. Vẫn lưu chung bảng `paast_analysis_histories` vì cột `analysis_result` là
   * JSON tự do; `total_score` để null — đó chính là dấu hiệu phân biệt bản 2 với bản 1, cùng
   * với khoá `phien_ban` nằm trong JSON.
   *
   * Cố ý KHÔNG đụng analyzeContent() bản 1: task-auto đang chạy trên nó.
   */
  async analyzeContentV2(userId: string, content: string) {
    const history = await this.prisma.paastAnalysisHistory.create({
      data: { user_id: userId, input_text: content, status: TransformStatus.PENDING },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze-v2/`,
          { content },
          // Sinh 16 hook là một lệnh gọi LLM riêng ngoài 5 lệnh phân loại — đo thật mất ~14
          // giây, nên 60s của bản 1 là quá sát.
          { timeout: 150000 },
        ),
      );

      const { verdict, layers, ctaWarning, phien_ban } = response.data;
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: { phien_ban: phien_ban ?? 2, verdict, layers, ctaWarning },
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST v2: ${error.message}`);
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: error.response?.data?.error || error.message || 'Lỗi không xác định',
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Trích các tiêu chí đang `miss` từ 1 bản phân tích đã lưu (loại tiêu chí `na` của Stick
   * — không thể "nâng cấp" phần cần production bằng cách sửa text, business doc §11.2).
   */
  private extractMissingElements(analysisResult: any): MissingElement[] {
    const layers = analysisResult?.layers || {};
    const missing: MissingElement[] = [];
    const criteriaLayers: Array<[string, string]> = [
      ['action', 'criteria'],
      ['acknowledge', 'criteria'],
      ['stick', 'criteria'],
      ['trust', 'criteria'],
    ];

    for (const [layerKey, field] of criteriaLayers) {
      const criteria = layers[layerKey]?.[field] || [];
      for (const c of criteria) {
        if (c.status === 'miss') {
          missing.push({ layer: layerKey, criterion: c.code, suggestion: c.evidence || '' });
        }
      }
    }
    return missing;
  }

  /**
   * Nâng cấp content dựa trên bản phân tích đã lưu, lưu kết quả thành 1 record lịch sử mới
   * liên kết `upgraded_from_id` về bản gốc — không giả định điểm chắc chắn tăng
   * (business doc §11.1: luôn tính lại điểm toàn bộ sau khi nâng cấp).
   */
  async upgradeAnalysis(userId: string, analysisId: string) {
    const original = await this.prisma.paastAnalysisHistory.findUnique({ where: { id: analysisId } });

    if (!original) {
      throw new NotFoundException('Không tìm thấy bản phân tích PAAST này');
    }
    if (original.status !== TransformStatus.SUCCESS || !original.analysis_result) {
      throw new BadRequestException('Bản phân tích này chưa hoàn tất hoặc không có kết quả để nâng cấp');
    }

    const missingElements = this.extractMissingElements(original.analysis_result);

    const history = await this.prisma.paastAnalysisHistory.create({
      data: {
        user_id: userId,
        input_text: original.input_text,
        status: TransformStatus.PENDING,
        upgraded_from_id: original.id,
      },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/upgrade/`,
          { original_content: original.input_text, missing_elements: missingElements },
          { timeout: 90000 },
        ),
      );

      const { upgraded, changes_added, new_analysis } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          input_text: upgraded,
          analysis_result: { layers: new_analysis.layers, cta_warning: new_analysis.cta_warning, verdict: new_analysis.verdict, changes_added },
          total_score: new_analysis.total_score,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to upgrade PAAST content: ${error.message}`);
      const errMsg = error.response?.data?.error || error.message || 'Lỗi không xác định trong quá trình nâng cấp';

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  async getPaastUserHistory(userId: string, query: HistoryQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };
    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.paastAnalysisHistory.count({ where }),
      this.prisma.paastAnalysisHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  async getPaastHistoryDetail(id: string, userId: string) {
    const history = await this.prisma.paastAnalysisHistory.findUnique({ where: { id } });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }
    if (history.user_id !== userId) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }

    return history;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHUYỂN ĐỔI CONTENT — viết kịch bản theo giọng nhân vật + chấm điểm PAAST cho kịch bản đó.
  // Gộp về đây từ module `content-transform` riêng (cùng lý do đã gộp PAAST Analyzer ở trên:
  // đây cũng chỉ là orchestration gọi AI service qua aiServiceUrl, tách module riêng chỉ để
  // "gọi 1 endpoint AI khác" là thừa). Khác với PAAST Analyzer — luồng này KHÔNG dùng chung
  // endpoint /api/ai/paast/upgrade/ khi nâng cấp (xem buildPaastUpgradeSystemPrompt) vì kịch
  // bản ở đây bắt buộc giữ đúng giọng nhân vật, còn endpoint đó viết lại theo giọng trung tính.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Chặn spam: tối đa CONTENT_TRANSFORM_RATE_LIMIT_MAX lần "Chuyển đổi"/"Nâng cấp" mỗi.../user. */
  private checkContentTransformRateLimit(userId: string): void {
    const now = Date.now();
    const hits = (this.contentTransformRateLimitHits.get(userId) || []).filter(
      (t) => now - t < this.CONTENT_TRANSFORM_RATE_LIMIT_WINDOW_MS,
    );

    if (hits.length >= this.CONTENT_TRANSFORM_RATE_LIMIT_MAX) {
      throw new HttpException(
        `Bạn đã thao tác quá nhiều lần (tối đa ${this.CONTENT_TRANSFORM_RATE_LIMIT_MAX} lần/phút). Vui lòng thử lại sau ít phút.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    hits.push(now);
    this.contentTransformRateLimitHits.set(userId, hits);
  }

  /**
   * Gọi thẳng endpoint chấm điểm PAAST của AI service — cùng endpoint mà analyzeContent() ở
   * trên dùng, nhưng trả payload thô KHÔNG ghi lịch sử (paast_analysis_history), vì bản ghi
   * lịch sử ở luồng này là contentTransformHistory, không phải paastAnalysisHistory.
   *
   * `timeout_seconds` gửi kèm — trước đây thiếu field này (khác `callContentTransformAiService`
   * đã làm đúng), nên Django rơi về DEFAULT_ANALYZE_TIMEOUT_S=120 hard-code riêng của nó thay vì
   * đúng ngân sách BE thực sự chờ (timeoutMs). Hiện tại 2 mốc tình cờ trùng nhau (đều 120s) nên
   * chưa gây lỗi, nhưng lệch âm thầm ngay khi timeoutMs đổi mà quên đổi theo phía Django — cùng
   * loại bug đã từng xảy ra với transform-content (xem comment ở content_generation_views.py).
   */
  private async callPaastAnalyzeApi(content: string, timeoutMs: number): Promise<PaastAnalysisPayload> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiServiceUrl}/api/ai/paast/analyze/`,
        { content, timeout_seconds: Math.ceil(timeoutMs / 1000) },
        { timeout: timeoutMs },
      ),
    );

    const { layers, total_score, cta_warning, verdict } = response.data;
    return { layers, total_score, cta_warning, verdict };
  }

  /**
   * Chấm điểm kịch bản theo khung PAAST, tự động thử lại tối đa 3 lần (1 lần đầu + 2 retry) —
   * model reasoning đôi khi trả JSON bị cắt cụt (chạm max_tokens) hoặc timeout, phần lớn các
   * lần thử lại sau đều thành công (đã thực đo: dao động reasoning_tokens rất lớn giữa các lần
   * gọi dù cùng input). Log rõ từng lần thử để theo dõi tỷ lệ lỗi thật của tính năng theo
   * thời gian.
   *
   * Từng thử giảm timeout retry xuống 60s để chặn tổng thời gian chờ, nhưng thực đo cho thấy
   * làm vậy TĂNG tỷ lệ thất bại (input dài/phức tạp cần >60s để suy luận xong, cắt sớm ở đúng
   * lần lẽ ra sẽ thành công) — phản tác dụng so với mục tiêu "giảm lỗi thật" của retry. Giữ
   * nguyên 120s cho MỌI lần thử; chấp nhận tổng tối đa 360s (3×120s) và đã tăng timeout phía
   * FE tương ứng để không bị client huỷ ngang khi BE vẫn đang xử lý bình thường.
   *
   * PAAST chấm trên chính kịch bản kết quả, không cần input_text hay system_prompt nhân vật —
   * đó là 2 tham số hệ chấm điểm cũ (7 nhóm/23 tiêu chí) cần, nay đã bỏ.
   */
  private async scoreContentWithRetry(outputText: string, logContext = 'chấm điểm'): Promise<ContentTransformScoreResult> {
    const maxAttempts = 3;
    const timeoutsMs = [120000, 120000, 120000];
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.callPaastAnalyzeApi(outputText, timeoutsMs[attempt - 1]);
        if (attempt > 1) {
          this.logger.warn(`[${logContext}] Thành công ở lần thử ${attempt}/${maxAttempts}`);
        }
        return result;
      } catch (err: any) {
        lastError = err;

        // 4xx = lỗi TẤT ĐỊNH (request sai, content không hợp lệ...) — thử lại nguyên văn cùng
        // 1 request chắc chắn ra đúng kết quả đó, chỉ tốn thêm thời gian chờ của người dùng và
        // che mất lỗi thật. Chỉ 5xx/timeout/lỗi mạng mới đáng thử lại.
        const status = err.response?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          this.logger.error(
            `[${logContext}] Lỗi ${status} từ AI service — lỗi tất định, KHÔNG thử lại: ${this.extractContentTransformAiErrorMessage(err)}`,
          );
          throw err;
        }

        this.logger.warn(`[${logContext}] Thất bại ở lần thử ${attempt}/${maxAttempts}: ${err.message}`);
      }
    }

    this.logger.error(`[${logContext}] Thất bại cả ${maxAttempts} lần thử — trả về scoreStatus: failed. Lỗi cuối: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * Lấy message lỗi THẬT từ AI service để trả nguyên văn cho FE.
   *
   * Trước đây mọi lỗi chấm điểm đều bị thay bằng "có thể do timeout hoặc lỗi tạm thời từ AI",
   * kể cả khi nguyên nhân thật hoàn toàn khác (vd content không hợp lệ) — người dùng đọc thấy
   * "timeout" rồi bấm chấm lại vô ích vì lỗi tất định thì lần sau vẫn hệt vậy.
   */
  private extractContentTransformAiErrorMessage(err: any): string {
    return err?.response?.data?.error || err?.message || 'Lỗi không xác định khi chấm điểm';
  }

  /**
   * Tìm bản ghi ĐÃ chấm thành công cho đúng kịch bản này (của chính user đó), để tái dùng điểm
   * thay vì gọi AI chấm lại.
   *
   * Giới hạn trong bản ghi của chính user — điểm chỉ phụ thuộc nội dung nên về lý thuyết dùng
   * chung được, nhưng đọc sang bản ghi user khác là mở rộng phạm vi truy cập dữ liệu không cần
   * thiết. Cùng cách phân quyền mà findLatestByContent() ở trên đang dùng cho PAAST Analyzer.
   *
   * CÓ tính cả chính bản ghi đang chấm. Nếu loại trừ nó thì bấm "Chấm điểm lại" trên bản ghi đã
   * có điểm sẽ gọi AI chấm lại và ra điểm khác — đúng cái dao động cần loại bỏ.
   *
   * Chỉ tái dùng điểm có shape PAAST hợp lệ (`isPaastScoreResult`): bản ghi chấm bằng hệ điểm cũ
   * (7 nhóm/23 tiêu chí) vẫn có `score_result` khác null, nếu nhận bừa thì những bản ghi đó vĩnh
   * viễn không chấm lại được sang khung PAAST.
   *
   * VÀ phải đúng PAAST_LOGIC_VERSION hiện hành: điểm chấm bằng công thức đời trước không còn so
   * sánh được với điểm chấm hôm nay, tái dùng chúng sẽ khiến cùng một màn hình trộn lẫn điểm của
   * 2 hệ khác nhau mà người dùng không hề biết. Khác version ⇒ cache miss ⇒ chấm lại thật.
   */
  private async findContentTransformCachedScoreByOutput(userId: string, outputText: string) {
    const candidates = await this.prisma.contentTransformHistory.findMany({
      where: {
        user_id: userId,
        output_text: outputText,
        score_result: { not: Prisma.DbNull },
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, score_result: true },
    });

    return (
      candidates.find(
        (c) =>
          isPaastScoreResult(c.score_result) &&
          (c.score_result as any).logic_version === PAAST_LOGIC_VERSION,
      ) || null
    );
  }

  /** Gắn dấu phiên bản logic vào kết quả chấm TRƯỚC khi ghi DB — nguồn cho lần tra cache sau. */
  private withContentTransformLogicVersion(scoreResult: ContentTransformScoreResult): PaastStoredScore {
    return { ...scoreResult, logic_version: PAAST_LOGIC_VERSION };
  }

  /** Message hiển thị cho FE: giữ nguyên lỗi thật, chỉ nói "có thể do timeout" khi ĐÚNG là timeout. */
  private buildContentTransformScoreErrorMessage(err: any): string {
    const status = err?.response?.status;
    const detail = this.extractContentTransformAiErrorMessage(err);

    if (typeof status === 'number' && status >= 400 && status < 500) {
      return `Không thể chấm điểm nội dung này: ${detail}`;
    }
    return `Không thể chấm điểm nội dung này (có thể do timeout hoặc lỗi tạm thời từ AI). Vui lòng thử chấm điểm lại. Chi tiết: ${detail}`;
  }

  /** Danh sách nhân vật đang active (loại system prompt khỏi payload trả về). */
  async getCharacters() {
    return this.prisma.character.findMany({
      where: { is_active: true },
      orderBy: { order_index: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        avatar_url: true,
        is_active: true,
        order_index: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Chạy chuyển đổi content bằng AI và lưu vào lịch sử.
   */
  async transformContent(userId: string, dto: CreateTransformDto) {
    this.checkContentTransformRateLimit(userId);

    // Lấy nhân vật + system_prompt qua API nội bộ GET /characters/:id thay vì đọc thẳng DB.
    // fetchCharacterViaApi tự ném NotFoundException khi endpoint trả 404.
    const character = await this.fetchContentTransformCharacterViaApi(dto.character_id);

    // Create pending history record
    const history = await this.prisma.contentTransformHistory.create({
      data: {
        user_id: userId,
        character_id: character.id,
        input_text: dto.input_text,
        input_type: dto.input_type || 'TEXT',
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      // Lần gọi 1 — viết kịch bản. max_tokens 16000 vì deepseek-v4-flash là model reasoning,
      // tốn token cho bước suy luận nội bộ (reasoning_content) TRƯỚC KHI ra "content" cuối
      // cùng, và số token suy luận DAO ĐỘNG NGẪU NHIÊN rất lớn giữa các lần gọi dù cùng 1 input
      // (thực đo: 3450 → 6924 token chỉ trong 3 lần gọi liên tiếp). Tự động thử lại tối đa 3 lần
      // (writeContentTransformWithRetry) — trước đây bước này KHÔNG có retry, 1 lần thất bại
      // (thường do timeout, xem callContentTransformAiService) là cả request thất bại ngay dù
      // thử lại thường sẽ thành công.
      const outputText = await this.writeContentTransformWithRetry(character.system_prompt, dto.input_text, 16000, 'transform-write');
      const durationMs = Date.now() - startTime;

      // CHỦ Ý KHÔNG chấm điểm ở đây. Trước đây request này gọi AI 2 lượt nối nhau (viết kịch
      // bản rồi chấm điểm), mỗi lượt tự retry tới 3x120s => tối đa ~720s cho 1 lần bấm nút —
      // quá nặng và rất dễ bị huỷ giữa chừng, kéo theo mất luôn kết quả viết đã xong. Giờ tách
      // đôi: /transform chỉ viết (tối đa ~360s), người dùng bấm "Chấm điểm content" để gọi
      // /rescore chấm sau. Bản ghi lưu ngay với score_result = null và trả scoreStatus
      // 'pending' để FE biết là "chưa chấm", không phải "chấm thất bại".
      const updatedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          output_text: outputText,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-v4-flash',
          duration_ms: durationMs,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return this.attachContentTransformScoreFields(updatedHistory);
    } catch (error: any) {
      this.logger.error(`Failed to transform content: ${error.message}`);
      let errMsg = error.message || 'Lỗi không xác định trong quá trình xử lý';
      if (error.response?.data?.error) {
        errMsg = error.response.data.error;
      }

      const failedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return this.attachContentTransformScoreFields(failedHistory);
    }
  }

  /**
   * Lấy nhân vật (kèm system_prompt) qua HTTP nội bộ tới chính endpoint GET /characters/:id
   * thay vì đọc thẳng DB bằng Prisma — theo yêu cầu về nguồn dữ liệu duy nhất.
   *
   * Endpoint đó chỉ mở cho ADMIN/MANAGER, trong khi /ai/content-transform/transform mọi role đã
   * đăng nhập đều dùng được — nên KHÔNG thể forward JWT của user (MEMBER sẽ bị 403). Thay vào
   * đó gắn header x-internal-token để AdminOrInternalGuard nhận diện đây là lệnh gọi nội bộ
   * server-to-server. Nhờ vậy rào chắn với người dùng thật vẫn nguyên vẹn: MEMBER vẫn không
   * tự gọi được /characters/:id để đọc trộm system_prompt.
   *
   * Nhận cả id lẫn slug (findOneAdmin tra theo OR) — giữ đúng hành vi cũ của transformContent.
   */
  private async fetchContentTransformCharacterViaApi(idOrSlug: string): Promise<{
    id: string;
    name: string;
    slug: string;
    system_prompt: string;
  }> {
    const port = this.configService.get<string>('PORT', '3000');
    const selfBaseUrl = this.configService.get<string>('SELF_API_URL', `http://127.0.0.1:${port}/api`);
    const internalToken = this.configService.get<string>('INTERNAL_API_TOKEN');

    if (!internalToken) {
      throw new HttpException(
        'Thiếu cấu hình INTERNAL_API_TOKEN — không thể lấy dữ liệu nhân vật qua API nội bộ',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${selfBaseUrl}/characters/${encodeURIComponent(idOrSlug)}`, {
          headers: { [INTERNAL_TOKEN_HEADER]: internalToken },
          timeout: 10000,
        }),
      );
      return response.data;
    } catch (error: any) {
      // 404 từ endpoint nội bộ = không có nhân vật → giữ đúng lỗi cũ mà FE đang xử lý.
      if (error.response?.status === HttpStatus.NOT_FOUND) {
        throw new NotFoundException('Không tìm thấy nhân vật phù hợp');
      }
      this.logger.error(`Không lấy được nhân vật qua API nội bộ: ${error.message}`);
      throw new HttpException(
        'Không lấy được dữ liệu nhân vật, vui lòng thử lại',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Gọi endpoint AI service dùng cho cả viết kịch bản, và sửa nâng cấp của luồng chuyển đổi
   * content (khác endpoint /api/ai/paast/* dùng cho PAAST Analyzer ở trên).
   *
   * `timeout_seconds` gửi kèm để AI service (Django) dùng ĐÚNG giá trị BE thực sự muốn cho lệnh
   * gọi DeepSeek, tránh AI service tự cắt ở mốc mặc định hard-code riêng của nó (60s) trong khi
   * BE tưởng đã cho phép tới timeoutMs.
   */
  private async callContentTransformAiService(
    systemPrompt: string,
    inputText: string,
    options?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  ): Promise<string> {
    const url = `${this.aiServiceUrl}/api/ai/transform-content/`;
    const timeoutMs = options?.timeoutMs ?? 30000;

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          system_prompt: systemPrompt,
          input_text: inputText,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          // Giây, không phải ms — khớp với tham số `timeout` (int, giây) của _call_deepseek_raw
          // bên Django. Làm tròn lên để không vô tình cho AI service ít thời gian hơn BE thật sự chờ.
          timeout_seconds: Math.ceil(timeoutMs / 1000),
        },
        {
          timeout: timeoutMs,
        },
      ),
    );

    return response.data.output_text;
  }

  /**
   * Gọi callContentTransformAiService (viết kịch bản mới HOẶC viết lại kịch bản khi nâng cấp)
   * với tự động thử lại tối đa 3 lần — cùng pattern với scoreContentWithRetry. Trước đây bước
   * viết KHÔNG có retry nào: 1 lần thất bại là cả request /transform hoặc /upgrade thất bại
   * ngay, dù đây là đúng loại lỗi timeout ngẫu nhiên mà thử lại thường sẽ thành công.
   */
  private async writeContentTransformWithRetry(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    logContext: string,
  ): Promise<string> {
    const maxAttempts = 3;
    const timeoutMs = 120000;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.callContentTransformAiService(systemPrompt, userPrompt, { maxTokens, timeoutMs });
        if (attempt > 1) {
          this.logger.warn(`[${logContext}] Thành công ở lần thử ${attempt}/${maxAttempts}`);
        }
        return result;
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`[${logContext}] Thất bại ở lần thử ${attempt}/${maxAttempts}: ${err.message}`);
      }
    }

    this.logger.error(`[${logContext}] Thất bại cả ${maxAttempts} lần thử. Lỗi cuối: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * Gọi endpoint gộp .../api/ai/transform-content/upgrade/ — viết lại kịch bản (giữ giọng nhân
   * vật) RỒI chấm PAAST bản mới, cả 2 lượt gọi LLM chạy TRONG 1 request Django duy nhất (Django
   * tự chia ngân sách thời gian nội bộ 40% viết / 60% chấm — xem
   * PaastAnalysisService.upgrade_scripted bên Django).
   *
   * Trước đây upgradeContent() tự gọi 2 request HTTP tuần tự (writeContentTransformWithRetry rồi
   * scoreContentWithRetry), mỗi request lại tự retry riêng tới 3 lần — tối đa 6 round-trip cho 1
   * lần bấm nút "Nâng cấp". Giờ dùng đúng 1 round-trip, khớp nguyên tắc mà /api/ai/paast/upgrade/
   * (PAAST Analyzer độc lập) đã áp dụng từ trước — xem upgradeAnalysis() ở trên.
   *
   * KHÔNG tự retry ở tầng BE nữa (khác 2 hàm cũ): cả bước viết lẫn bước chấm giờ đã tự thử lại
   * TẠI CHỖ bên trong Django (_write_scripted_upgrade, _classify_group) — nếu BE retry lại nguyên
   * request này khi chỉ bước chấm lỗi, sẽ VIẾT LẠI TỪ ĐẦU dù bước viết đã xong, phá đúng nguyên
   * tắc "lỗi chấm không được làm mất kết quả viết" mà luồng này cần giữ (xem cách hàm gọi hàm này
   * xử lý `score_error` KHÔNG throw, chỉ trả kèm response — response 502/500 CHỈ xảy ra khi bước
   * viết thất bại, tức là chưa có gì để mất).
   */
  private async callContentTransformUpgradeAiService(
    writeSystemPrompt: string,
    writeUserPrompt: string,
    maxTokens: number,
  ): Promise<{ outputText: string; scoreResult: ContentTransformScoreResult | null; scoreError: string | null }> {
    const timeoutMs = this.CONTENT_TRANSFORM_UPGRADE_TIMEOUT_MS;
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiServiceUrl}/api/ai/transform-content/upgrade/`,
        {
          write_system_prompt: writeSystemPrompt,
          write_user_prompt: writeUserPrompt,
          max_tokens: maxTokens,
          // Giây, không phải ms — cùng quy ước với callContentTransformAiService/callPaastAnalyzeApi.
          timeout_seconds: Math.ceil(timeoutMs / 1000),
        },
        { timeout: timeoutMs },
      ),
    );

    const { output_text, score, score_error } = response.data;
    return {
      outputText: output_text,
      scoreResult: (score ?? null) as ContentTransformScoreResult | null,
      scoreError: score_error ?? null,
    };
  }

  /**
   * Sửa nâng cấp kịch bản: sửa các tiêu chí PAAST đang `miss` theo thứ tự ưu tiên lớp
   * (Prefer → Acknowledge → Trust → Action → Stick, xem paast-upgrade.util.ts).
   * Nhận id lịch sử (ưu tiên, tái dùng đúng permission check của getContentTransformHistoryDetail)
   * hoặc bộ 3 field thô (input_text/character_id/output_text). Sau khi có kịch bản mới, tự
   * động chấm điểm lại để so sánh điểm cũ/mới.
   */
  async upgradeContent(userId: string, roles: UserRole[], dto: UpgradeTransformDto) {
    this.checkContentTransformRateLimit(userId);

    // Chống bấm trùng: nếu history_id này đang có 1 lần /upgrade chạy dở, từ chối ngay thay vì
    // xử lý song song (có thể tạo 2 bản ghi upgrade trùng lặp, tốn gấp đôi chi phí AI).
    const lockKey = dto.history_id;
    if (lockKey) {
      if (this.contentTransformProcessingUpgrades.has(lockKey)) {
        throw new ConflictException('Bản ghi này đang được nâng cấp, vui lòng chờ hoàn tất trước khi thử lại.');
      }
      this.contentTransformProcessingUpgrades.add(lockKey);
    }

    try {
      let inputText: string;
      let characterId: string;
      let currentOutputText: string;
      let previousScoreResult: ContentTransformScoreResult | null = null;
      let ownerUserId = userId;

      if (dto.history_id) {
        const history = await this.getContentTransformHistoryDetail(dto.history_id, userId, roles);
        if (!history.output_text) {
          throw new BadRequestException('Bản ghi này chưa có kịch bản kết quả để nâng cấp');
        }
        inputText = history.input_text;
        characterId = history.character_id;
        currentOutputText = history.output_text;
        previousScoreResult = history.scoreResult ?? null;
        ownerUserId = history.user_id;

        // Nâng cấp = sửa đúng các tiêu chí đang `miss`, nên bắt buộc phải có điểm trước. Từ chối
        // sớm thay vì âm thầm tự chấm baseline: FE chỉ hiện nút "Nâng cấp content theo gợi ý"
        // sau khi đã chấm xong, nên rơi vào đây nghĩa là bản ghi thật sự chưa được chấm.
        if (!previousScoreResult) {
          throw new BadRequestException(
            'Bản ghi này chưa được chấm điểm. Vui lòng bấm "Chấm điểm content" trước khi nâng cấp.',
          );
        }
      } else {
        if (!dto.input_text || !dto.character_id || !dto.output_text) {
          throw new BadRequestException(
            'Thiếu input_text/character_id/output_text — bắt buộc phải truyền history_id, hoặc đủ cả 3 field này',
          );
        }
        inputText = dto.input_text;
        characterId = dto.character_id;
        currentOutputText = dto.output_text;
      }

      // Lấy qua API nội bộ GET /characters/:id, không đọc thẳng DB — xem fetchContentTransformCharacterViaApi.
      const character = await this.fetchContentTransformCharacterViaApi(characterId);
      if (!character) {
        throw new NotFoundException('Không tìm thấy nhân vật phù hợp');
      }

      // Nếu chưa có điểm cũ sẵn (vd dùng path input_text trực tiếp), chấm điểm bản hiện tại
      // trước để biết ưu tiên sửa gì — không có điểm cũ thì không thể build prompt ưu tiên,
      // nên ở đây vẫn để lỗi (sau retry) làm fail cả request, khác với bước chấm lại bản MỚI
      // bên dưới (được cho phép fail độc lập, không kéo sập cả kết quả nâng cấp).
      if (!previousScoreResult) {
        previousScoreResult = await this.scoreContentWithRetry(currentOutputText, 'upgrade-baseline');
      }

      // Các tiêu chí đang `miss` lấy bằng đúng hàm extractMissingElements() ở trên (dùng chung
      // cho cả PAAST Analyzer lẫn luồng này) — hàm này đã loại sẵn tiêu chí `na` (cần
      // production, không sửa được bằng cách viết thêm chữ).
      const missing = this.extractMissingElements(previousScoreResult);
      const upgradeSystemPrompt = buildPaastUpgradeSystemPrompt(previousScoreResult, missing);
      const upgradeUserPrompt = buildPaastUpgradeUserPrompt(inputText, character.system_prompt, currentOutputText);

      const startTime = Date.now();
      // 1 request HTTP DUY NHẤT — viết lại kịch bản RỒI chấm PAAST bản mới chạy nối tiếp bên
      // trong Django (xem callContentTransformUpgradeAiService). Trước đây đây là 2 lượt gọi
      // writeContentTransformWithRetry + scoreContentWithRetry tuần tự, mỗi lượt tự retry riêng
      // (tối đa 6 round-trip). Lỗi ở bước viết (chưa có gì để mất) làm request này throw thẳng —
      // giữ đúng hành vi cũ. Lỗi ở bước chấm KHÔNG throw, trả kèm score_error trong response.
      const { outputText: newOutputText, scoreResult: freshScoreResult, scoreError: freshScoreError } =
        await this.callContentTransformUpgradeAiService(upgradeSystemPrompt, upgradeUserPrompt, 16000);

      let newScoreResult: ContentTransformScoreResult | null = freshScoreResult;
      let scoreStatus: 'success' | 'failed' = freshScoreError ? 'failed' : 'success';
      // Django đã tự thử lại (_classify_group) trước khi trả score_error, nên lỗi đến đây luôn
      // thuộc loại "đã thử hết cách, ngẫu nhiên" — dùng đúng văn phong retriable-fallback của
      // buildContentTransformScoreErrorMessage() để nhất quán với thông báo lỗi của /rescore,
      // dù không có đối tượng lỗi axios thật (Django trả message dạng chuỗi trong response 200).
      let scoreError: string | null = freshScoreError
        ? `Không thể chấm điểm nội dung này (có thể do timeout hoặc lỗi tạm thời từ AI). Vui lòng nâng cấp lại. Chi tiết: ${freshScoreError}`
        : null;
      let newScoreFromCache = false;

      // Tra cache SAU khi đã có kết quả (khác rescoreContent, nơi tra cache TRƯỚC để quyết định
      // có gọi AI hay không) — vì bước chấm giờ chạy TRONG CÙNG request gộp ở trên, BE không còn
      // cách nào biết trước nội dung mới để bỏ qua lượt gọi đó. Tra cache ở đây không tiết kiệm
      // được lượt gọi AI (đã lỡ chạy), nhưng vẫn giữ đúng bất biến "cùng nội dung luôn ra cùng
      // điểm" (xem findContentTransformCachedScoreByOutput) cho trường hợp hiếm bản viết lại
      // trùng y hệt một bản đã chấm trước đó. Lỗi tra cache không được làm hỏng kết quả đã có.
      try {
        const cached = await this.findContentTransformCachedScoreByOutput(ownerUserId, newOutputText);
        if (cached) {
          this.logger.log(`[upgrade-rescore] Tái dùng điểm đã chấm của bản ghi ${cached.id} cho nội dung y hệt`);
          newScoreResult = cached.score_result as unknown as ContentTransformScoreResult;
          scoreStatus = 'success';
          scoreError = null;
          newScoreFromCache = true;
        }
      } catch (err: any) {
        this.logger.warn(`[upgrade-rescore] Tra cache thất bại, dùng điểm vừa chấm: ${err?.message}`);
      }

      const durationMs = Date.now() - startTime;

      const newHistory = await this.prisma.contentTransformHistory.create({
        data: {
          user_id: ownerUserId,
          character_id: character.id,
          input_text: inputText,
          output_text: newOutputText,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-v4-flash (upgrade)',
          duration_ms: durationMs,
          score_result: (newScoreResult ? this.withContentTransformLogicVersion(newScoreResult) : null) as any,
          overall_score: newScoreResult?.total_score ?? null,
        },
        include: {
          character: {
            select: { id: true, name: true, slug: true, avatar_url: true },
          },
        },
      });

      return {
        previous: {
          output_text: currentOutputText,
          scoreResult: previousScoreResult,
        },
        upgraded: {
          ...newHistory,
          scoreResult: newHistory.score_result,
          scoreStatus,
          scoreError,
          fromCache: newScoreFromCache,
        },
      };
    } finally {
      if (lockKey) {
        this.contentTransformProcessingUpgrades.delete(lockKey);
      }
    }
  }

  /**
   * Chấm điểm 1 bản ghi đã có sẵn output_text — KHÔNG gọi lại AI viết kịch bản, chỉ chạy lượt
   * gọi AI chấm điểm (có retry) rồi cập nhật score_result/overall_score vào ĐÚNG bản ghi đó,
   * không bao giờ tạo bản ghi mới.
   *
   * Đây là bước 2 của luồng đã tách đôi: dùng cho cả lần chấm ĐẦU TIÊN (nút "Chấm điểm content"
   * ngay sau khi chuyển đổi xong, và ở tab Lịch sử với bản ghi 'pending') lẫn lần chấm LẠI khi
   * lần trước thất bại.
   */
  async rescoreContent(userId: string, roles: UserRole[], dto: RescoreDto) {
    this.checkContentTransformRateLimit(userId);

    const history = await this.getContentTransformHistoryDetail(dto.history_id, userId, roles);
    if (!history.output_text) {
      throw new BadRequestException('Bản ghi này chưa có kịch bản kết quả để chấm điểm');
    }

    // Chống bấm trùng cho cùng 1 bản ghi — cùng lý do với /upgrade: 2 lượt chấm song song chỉ
    // tốn gấp đôi chi phí AI mà kết quả sau ghi đè kết quả trước.
    if (this.contentTransformProcessingScores.has(history.id)) {
      throw new ConflictException('Bản ghi này đang được chấm điểm, vui lòng chờ hoàn tất trước khi thử lại.');
    }
    this.contentTransformProcessingScores.add(history.id);

    // PAAST chấm trực tiếp trên kịch bản kết quả — không cần lấy system_prompt của nhân vật
    // như hệ chấm điểm cũ, nên bỏ luôn lượt gọi API nội bộ GET /characters/:id ở đây.
    let scoreResult: ContentTransformScoreResult | null = null;
    let scoreError: string | null = null;
    // Bật khi kết quả trả về là điểm CŨ dùng lại, không phải lượt chấm mới — FE hiển thị ghi chú
    // để người dùng không tưởng nhầm vừa có một lượt chấm mới chạy.
    let fromCache = false;
    try {
      // Tái dùng điểm đã chấm cho ĐÚNG nội dung này nếu có — đây là cách duy nhất đảm bảo
      // "cùng nội dung luôn ra cùng điểm". Hạ temperature về 0 chỉ thu hẹp dao động chứ không
      // xoá được (thực đo 8 lượt cùng 1 kịch bản ở temperature=0 vẫn ra 3 kết quả khác nhau:
      // 80/90/93 — DeepSeek không đảm bảo tái lập, kể cả khi thêm seed cố định). Không gọi lại
      // AI còn tiết kiệm nguyên 1 lượt chấm cho thao tác bấm lại trên nội dung không đổi.
      const cached = await this.findContentTransformCachedScoreByOutput(userId, history.output_text);
      if (cached) {
        this.logger.log(`[rescore] Tái dùng điểm đã chấm của bản ghi ${cached.id} cho nội dung y hệt`);
        scoreResult = cached.score_result as unknown as ContentTransformScoreResult;
        fromCache = true;
      }

      if (!scoreResult) {
        try {
          scoreResult = await this.scoreContentWithRetry(history.output_text, 'rescore');
        } catch (err: any) {
          scoreError = this.buildContentTransformScoreErrorMessage(err);
        }
      }

      // Chỉ ghi DB khi chấm THÀNH CÔNG. Trước đây luôn ghi, nên 1 lần chấm lại thất bại sẽ set
      // score_result = null và xoá mất điểm cũ vẫn còn dùng được của bản ghi.
      if (!scoreResult) {
        return { ...history, scoreResult: history.scoreResult, scoreStatus: 'failed' as const, scoreError, fromCache: false };
      }

      const updatedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          // Luôn ghi kèm PAAST_LOGIC_VERSION — kể cả khi điểm lấy từ cache, để chính bản ghi này
          // cũng tra cache được ở lần sau mà không phải dò ngược sang bản ghi nguồn.
          score_result: this.withContentTransformLogicVersion(scoreResult) as any,
          overall_score: scoreResult.total_score ?? null,
        },
        include: {
          character: {
            select: { id: true, name: true, slug: true, avatar_url: true },
          },
        },
      });

      return { ...this.attachContentTransformScoreFields(updatedHistory), fromCache };
    } finally {
      this.contentTransformProcessingScores.delete(history.id);
    }
  }

  /**
   * Chuẩn hoá 1 bản ghi lịch sử (Prisma, field snake_case score_result) về đúng shape
   * scoreResult/scoreStatus/scoreError camelCase mà /transform, /upgrade, /rescore đã trả —
   * dùng ở GET /history, /history/member/:id, /history/:id để FE dùng chung 1 shape scoreResult
   * cho mọi nơi hiển thị.
   *
   * Bản ghi cũ chấm bằng hệ 7 nhóm/23 tiêu chí + Hard Gate (đã ngừng dùng) có shape hoàn toàn
   * khác PAAST và KHÔNG quy đổi được sang 5 lớp — bị coi như chưa có điểm, kèm thông báo mời
   * chấm lại. Cố tình không giữ code render hệ cũ ở FE chỉ để hiển thị mấy bản ghi này.
   *
   * Bản ghi có output_text nhưng score_result rỗng là trạng thái BÌNH THƯỜNG kể từ khi tách
   * /transform và /rescore (xem ContentTransformScoreStatus) — trả 'pending' chứ không phải
   * 'failed', để FE hiển thị "Chưa chấm điểm" thay vì báo lỗi cho thứ chưa từng chạy. Lần chấm
   * thất bại thật sự vẫn được báo 'failed' ngay trong response của /rescore, /upgrade.
   */
  private attachContentTransformScoreFields<T extends { output_text: string | null; score_result: any }>(
    history: T,
  ): Omit<T, 'score_result'> & {
    scoreResult: ContentTransformScoreResult | null;
    scoreStatus: ContentTransformScoreStatus;
    scoreError: string | null;
  } {
    const { score_result, ...rest } = history;
    const isLegacy = !!score_result && !isPaastScoreResult(score_result);
    const scoreResult: ContentTransformScoreResult | null = isPaastScoreResult(score_result) ? score_result : null;

    let scoreStatus: ContentTransformScoreStatus;
    let scoreError: string | null;

    if (!history.output_text) {
      // Chưa từng có kịch bản để chấm điểm (vd transform thất bại ngay từ bước viết) — không
      // áp dụng khái niệm thành công/thất bại chấm điểm cho trường hợp này.
      scoreStatus = null;
      scoreError = null;
    } else if (scoreResult) {
      scoreStatus = 'success';
      scoreError = null;
    } else if (isLegacy) {
      scoreStatus = 'failed';
      scoreError =
        'Bản ghi này được chấm bằng hệ điểm cũ (7 nhóm tiêu chí, đã ngừng sử dụng). Bấm "Chấm điểm content" để chấm theo khung PAAST.';
    } else {
      scoreStatus = 'pending';
      scoreError = null;
    }

    return { ...rest, scoreResult, scoreStatus, scoreError };
  }

  /** Lịch sử chuyển đổi content của chính user đang login. */
  async getContentTransformUserHistory(userId: string, query: ContentTransformHistoryQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: items.map((item) => this.attachContentTransformScoreFields(item)),
    };
  }

  /** Lịch sử chuyển đổi content của 1 thành viên cụ thể (Admin/Manager hoặc Leader quản lý team đó). */
  async getContentTransformMemberHistory(
    leaderId: string,
    memberId: string,
    query: ContentTransformHistoryQueryDto,
    roles: UserRole[],
  ) {
    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);

    if (!isAdmin) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Chỉ có Leader, Manager hoặc Admin mới có quyền xem lịch sử thành viên');
      }

      // Check if target user is in at least one team led by this leader
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: leaderId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const member = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { team: true },
      });

      if (!member) {
        throw new NotFoundException('Không tìm thấy thành viên này');
      }

      const memberTeams = member.team
        ? member.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = memberTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Thành viên này không thuộc bất kỳ team nào do bạn quản lý');
      }
    }

    // Reuse query building logic
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: memberId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: items.map((item) => this.attachContentTransformScoreFields(item)),
    };
  }

  /** Chi tiết 1 bản ghi lịch sử chuyển đổi content. */
  async getContentTransformHistoryDetail(id: string, userId: string, roles: UserRole[]) {
    const history = await this.prisma.contentTransformHistory.findUnique({
      where: { id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatar_url: true,
          },
        },
      },
    });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }

    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);
    if (!isAdmin && history.user_id !== userId) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này');
      }

      // Check if target user belongs to leader's team
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: userId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const targetUser = await this.prisma.user.findUnique({
        where: { id: history.user_id },
        select: { team: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Không tìm thấy người sở hữu bản ghi');
      }

      const targetTeams = targetUser.team
        ? targetUser.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = targetTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này (thành viên không thuộc team của bạn)');
      }
    }

    return this.attachContentTransformScoreFields(history);
  }

  /** Chuyển đổi file video/audio thành văn bản (dùng cho luồng chuyển đổi content). */
  async transcribeContentUpload(file: Express.Multer.File, authorization?: string): Promise<any> {
    const FormData = require('form-data');
    const url = `${this.aiServiceUrl}/api/content/transcribe-upload/`;

    const formData = new FormData();
    formData.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, formData, {
          // AI endpoint yêu cầu IsAuthenticated — forward nguyên Bearer JWT của FE,
          // AI validate bằng chung JWT_SECRET (core.authentication.NestJWTAuthentication).
          headers: { ...formData.getHeaders(), ...(authorization ? { Authorization: authorization } : {}) },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 60000, // 60s timeout
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to transcribe file: ${error.message}`);
      const errMsg = error.response?.data?.error_message || error.response?.data?.error || error.message || 'Lỗi kết nối tới AI Service';
      throw new HttpException(errMsg, error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

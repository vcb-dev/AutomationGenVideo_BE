import { Injectable, Logger, HttpException, HttpStatus, NotFoundException, BadRequestException } from '@nestjs/common';
import { PlayUrlNoCreditError } from './play-url-errors';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { catchError, firstValueFrom, lastValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { TransformStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyzeContentDto } from './dto/paast-analyze.dto';
import { HistoryQueryDto } from './dto/paast-history-query.dto';

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

@Injectable()
export class AiIntegrationService {
  private readonly logger = new Logger(AiIntegrationService.name);
  private readonly aiServiceUrl: string;
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {
    // 8001 chứ không phải 8000: Django lắng nghe ở :8001 (start-all.sh dựng
    // `runserver 0.0.0.0:8001`, .env.example cũng ghi vậy). Mặc định sai cổng thì
    // máy chưa khai biến chỉ nhận ECONNREFUSED — trông như "AI chết" chứ không lộ
    // ra là cấu hình sai. Cùng giá trị với douyin.service.ts / collection.service.ts.
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8001');
    this.logger.log(`AI Service URL: ${this.aiServiceUrl}`);
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
      if (l.includes('facebook')) return 'Facebook';
      if (l.includes('tiktok')) return 'TikTok';
      if (l.includes('youtube')) return 'YouTube';
      if (l.includes('instagram') || l === 'ig') return 'Instagram';
      if (l.includes('thread')) return 'Threads';
      if (l.includes('zalo')) return 'Zalo';
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
    const hasDataCount = enriched.filter((c: any) => c.has_data).length;

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
      channels_no_data: enriched.filter((c: any) => !c.has_data).sort((a: any, b: any) => (a.platform_norm).localeCompare(b.platform_norm)),
    };
  }

  async getSocialStats(year: number, month: number, platform?: string, team?: string): Promise<any> {
    const safeP = (platform || '').replace(/'/g, '');
    const safeT = (team || '').replace(/'/g, '');
    const platformFilter = safeP ? `AND LOWER(platform) LIKE LOWER('%${safeP}%')` : '';
    const teamFilter = safeT ? `AND LOWER(team) LIKE LOWER('%${safeT}%')` : '';

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
      summary: (summary as any[])[0] || {},
      by_platform: byPlatform,
      by_team: byTeam,
      top_views: topViews,
      top_likes: topLikes,
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
          // Tên model do AI service quyết (PAAST không truyền model nên nhận mặc định
          // của _call_deepseek_raw). Gõ cứng ở đây từng ghi sai 'deepseek-chat' cho mọi
          // dòng lịch sử — cột này để về sau truy "điểm tụt do đổi model hay đổi prompt",
          // ghi sai còn tệ hơn bỏ trống vì trông vẫn như dữ kiện đáng tin.
          model_used: response.data?.model_used ?? null,
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
          // Tên model do AI service quyết (PAAST không truyền model nên nhận mặc định
          // của _call_deepseek_raw). Gõ cứng ở đây từng ghi sai 'deepseek-chat' cho mọi
          // dòng lịch sử — cột này để về sau truy "điểm tụt do đổi model hay đổi prompt",
          // ghi sai còn tệ hơn bỏ trống vì trông vẫn như dữ kiện đáng tin.
          model_used: response.data?.model_used ?? null,
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
          // Tên model do AI service quyết (PAAST không truyền model nên nhận mặc định
          // của _call_deepseek_raw). Gõ cứng ở đây từng ghi sai 'deepseek-chat' cho mọi
          // dòng lịch sử — cột này để về sau truy "điểm tụt do đổi model hay đổi prompt",
          // ghi sai còn tệ hơn bỏ trống vì trông vẫn như dữ kiện đáng tin.
          model_used: response.data?.model_used ?? null,
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
}

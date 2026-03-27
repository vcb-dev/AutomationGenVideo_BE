import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';

import { HttpService } from '@nestjs/axios';

import { ConfigService } from '@nestjs/config';

import { catchError, firstValueFrom } from 'rxjs';

import { AxiosError } from 'axios';



@Injectable()

export class AiIntegrationService {

  private readonly logger = new Logger(AiIntegrationService.name);

  private readonly aiServiceUrl: string;



  constructor(

    private readonly httpService: HttpService,

    private readonly configService: ConfigService,

  ) {

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
      const { data } = await firstValueFrom(
        this.httpService
          .post(
            endpoint,
            {
              url,
              max_posts: maxPosts,
              force_method: forceMethod,
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
                `AI Service channel metrics error: ${error.message}`,
                error.response?.data,
              );
              throw new HttpException(
                error.response?.data || 'Failed to connect to AI Service (channel metrics)',
                error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }),
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
      const { data } = await firstValueFrom(
        this.httpService
          .post(
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
          )
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.error(`AI Service generic insights error: ${error.message}`, error.response?.data);
              throw new HttpException(
                error.response?.data || 'Failed to connect to AI Service (generic insights)',
                error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }),
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
            { timeout: 600000 },
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
      ];

      const isAllowed = allowedDomains.some(domain => imageUrl.includes(domain));
      if (!isAllowed) {
        this.logger.warn(`Blocked proxy request for non-allowed domain: ${imageUrl}`);
        res.status(403).send('Domain not allowed');
        return;
      }

      // Fetch the image - headers giống browser để tránh Instagram CDN block
      const response = await firstValueFrom(
        this.httpService.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.instagram.com/',
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

}


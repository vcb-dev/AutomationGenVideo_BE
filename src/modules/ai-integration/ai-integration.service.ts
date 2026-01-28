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
    maxResults = 20,
    useCache = true,
    asyncMode = false,
    searchType = 'posts',
  ): Promise<any> {
    const url = `${this.aiServiceUrl}/api/search/`;
    this.logger.log(`Calling AI Service: ${url} with platform=${platform}, type=${searchType}, keyword=${keyword}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          platform,
          keyword,
          min_likes: minLikes,
          min_views: minViews,
          max_results: maxResults,
          use_cache: useCache,
          async_mode: asyncMode,
          search_type: searchType,
        }, {
          timeout: 300000 // 5 minutes timeout for scraping
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
    maxResults = 9999 // Unlimited by default
  ): Promise<any> {
    const url = `${this.aiServiceUrl}/api/search/user-videos/`;
    this.logger.log(`Calling AI Service: ${url} for user=${username}, max_results=${maxResults}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          platform,
          username,
          max_results: maxResults,
        }, {
          timeout: 1800000 // 30 minutes timeout for large channels
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
}

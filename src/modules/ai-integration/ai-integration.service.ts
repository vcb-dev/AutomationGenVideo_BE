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
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
  }

  /**
   * Search videos using AI Service
   */
  async searchVideos(keyword: string, minLikes = 0, minViews = 0, sortBy = 'likes'): Promise<any> {
    const url = `${this.aiServiceUrl}/api/search`;
    this.logger.log(`Calling AI Service: ${url} with keyword=${keyword}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          keyword,
          min_likes: minLikes,
          min_views: minViews,
          sort_by: sortBy,
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
   * Download video without watermark
   */
  async downloadVideo(videoUrl: string): Promise<any> {
    const url = `${this.aiServiceUrl}/api/download`;
    this.logger.log(`Calling AI Service: ${url} for video URL`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, { url: videoUrl }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service Download Error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to connect to AI Service',
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
   * Get posts by Music ID
   */
  async getMusicPosts(musicId: string, count = 30, cursor = 0): Promise<any> {
    const url = `${this.aiServiceUrl}/api/music/posts`;
    this.logger.log(`Calling AI Service: ${url} for musicId=${musicId}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, {
          music_id: musicId,
          count,
          cursor,
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service Music Error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to connect to AI Service',
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
   * Check task status (if using async search)
   */
  async checkTaskStatus(taskId: string): Promise<any> {
    const url = `${this.aiServiceUrl}/api/search/status/${taskId}`;
    
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url).pipe(
          catchError((error: AxiosError) => {
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
}

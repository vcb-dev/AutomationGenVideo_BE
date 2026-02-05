import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface DouyinSearchDto {
  searchTerm: string;
  searchType: 'keyword' | 'hashtag';
  maxPosts?: number;
  sortBy?: 'general' | 'most_liked' | 'latest';
  publishTime?: 'all' | 'last_day' | 'last_week' | 'last_half_year';
}

export interface DouyinVideo {
  video_id: string;
  duration: number;
  caption: string;
  description: string;
  hashtags: string[];
  views_count: number | null;
  likes_count: number | null;
  comments_count: number;
  shares_count: number;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar: string;
  video_url: string;
  download_url: string;
  thumbnail_url: string;
  music_title: string;
  music_author: string;
  music_url: string;
  published_at: string | null;
}

export interface DouyinSearchResponse {
  success: boolean;
  data?: {
    videos: DouyinVideo[];
    total: number;
    searchTerm: string;
    searchType: string;
    sortBy: string;
    publishTime: string;
  };
  error?: string;
}

@Injectable()
export class DouyinService {
  private readonly logger = new Logger(DouyinService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8001');
    this.logger.log(`AI Service URL: ${this.aiServiceUrl}`);
  }

  /**
   * Search Douyin videos by keyword or hashtag
   */
  async searchVideos(searchDto: DouyinSearchDto): Promise<DouyinSearchResponse> {
    const url = `${this.aiServiceUrl}/api/douyin/search/`;
    
    this.logger.log(
      `Searching Douyin - Type: ${searchDto.searchType}, ` +
      `Term: ${searchDto.searchTerm}, Max: ${searchDto.maxPosts || 50}`
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<DouyinSearchResponse>(url, searchDto, {
          timeout: 300000, // 5 minutes timeout for scraping
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(
              `Douyin Search Error: ${error.message}`,
              error.response?.data
            );
            throw new HttpException(
              error.response?.data || 'Failed to connect to AI Service',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );

      this.logger.log(`Successfully retrieved ${data.data?.total || 0} Douyin videos`);
      return data;

    } catch (error) {
      this.logger.error(`Douyin search failed: ${error.message}`);
      throw error;
    }
  }
}

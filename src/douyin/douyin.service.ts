import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom, of } from 'rxjs';
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

export interface DouyinChannelProfile {
  username: string;
  display_name: string;
  avatar_url: string;
  follower_count: number;
  total_likes: number;
  total_videos: number;
  total_views: number;
  engagement_rate: number;
}

export interface DouyinProfileResponse {
  success: boolean;
  profile?: DouyinChannelProfile;
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
   * Search Douyin videos by keyword or hashtag.
   * Does NOT fetch user profile (to save Apify credits).
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

  /**
   * Fetch full Douyin channel profile (followers, avatar, engagement_rate).
   * Called ONLY when user clicks "Update" on a channel card.
   * Uses scrapeAdditionalUserInfo=True in Apify — costs ~5-6 events (cheap).
   */
  async fetchChannelProfile(username: string): Promise<DouyinProfileResponse> {
    const url = `${this.aiServiceUrl}/api/douyin/profile/`;

    this.logger.log(`Fetching Douyin profile for @${username}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<DouyinProfileResponse>(url, { username }, {
          timeout: 300000, // 5 min — Apify can be slow
        }).pipe(
          catchError((error: AxiosError) => {
            // 404 from AI service means "no profile found"; convert to a
            // benign response so callers can handle success=false instead of
            // catching an exception. returning an observable using `of` keeps
            // the stream type intact.
            if (error.response?.status === HttpStatus.NOT_FOUND) {
              this.logger.warn(`Douyin Profile not found for @${username}`);
              return of({ data: { success: false, error: 'No data found for this username' } } as { data: DouyinProfileResponse });
            }

            this.logger.error(`Douyin Profile Error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to fetch Douyin profile',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );

      this.logger.log(`Profile fetched for @${username}: followers=${data.profile?.follower_count}`);
      return data;

    } catch (error) {
      this.logger.error(`Douyin profile fetch failed: ${error.message}`);
      throw error;
    }
  }
}

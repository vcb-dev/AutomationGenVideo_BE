import { IsString, IsNumber, IsOptional, IsEnum, Min, Max, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Platform {
  TIKTOK = 'tiktok',
  DOUYIN = 'douyin',
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  XIAOHONGSHU = 'xiaohongshu',
  BILIBILI = 'bilibili',
  KUAISHOU = 'kuaishou',
  YOUTUBE = 'youtube',
}

export class SearchVideoDto {
  @ApiProperty({ description: 'Platform to search', enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty({ description: 'Keyword to search for (hashtag or search term)' })
  @IsString()
  keyword: string;

  @ApiPropertyOptional({ description: 'Minimum number of likes', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  min_likes?: number;

  @ApiPropertyOptional({ description: 'Minimum number of views', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  min_views?: number;

  @ApiPropertyOptional({ description: 'Maximum number of results (1-10000)', default: 20, minimum: 1, maximum: 10000 })
  @IsNumber()
  @Min(1)
  @Max(10000)
  @IsOptional()
  max_results?: number;

  @ApiPropertyOptional({ description: 'Use cached results if available', default: true })
  @IsBoolean()
  @IsOptional()
  use_cache?: boolean;

  @ApiPropertyOptional({ description: 'Run search asynchronously', default: false })
  @IsBoolean()
  @IsOptional()
  async_mode?: boolean;

  @ApiPropertyOptional({ description: 'Search type (posts, reels)', default: 'posts' })
  @IsString()
  @IsOptional()
  search_type?: string;

  @ApiPropertyOptional({ description: 'Page number for pagination (1-based). Page 2 = next 30 results.', default: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Minimum comments filter (OR with min_likes, min_views for Instagram)', default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  min_comments?: number;

  @ApiPropertyOptional({ description: 'For Instagram/Facebook: hashtag (by #tag) or keyword (by caption)', default: 'hashtag' })
  @IsString()
  @IsOptional()
  search_mode?: string;

  @ApiPropertyOptional({ description: 'Session ID for reproducible shuffling across pagination', default: '' })
  @IsString()
  @IsOptional()
  session_id?: string;
}

export class UserVideosDto {
  @ApiProperty({ description: 'Platform', enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty({ description: 'Username or user ID' })
  @IsString()
  username: string;

  @ApiPropertyOptional({ description: 'Maximum number of results (default: 20, use 9999 for all)', default: 20 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  max_results?: number;

  @ApiPropertyOptional({ description: 'Fetch videos until this date (YYYY-MM-DD) - deprecated, use start_date', example: '2024-01-01' })
  @IsString()
  @IsOptional()
  until_date?: string;

  @ApiPropertyOptional({ description: 'Start date for filtering (YYYY-MM-DD)', example: '2024-01-01' })
  @IsString()
  @IsOptional()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date for filtering (YYYY-MM-DD)', example: '2024-01-31' })
  @IsString()
  @IsOptional()
  end_date?: string;

  @ApiPropertyOptional({ description: 'Force refresh data from the platform, bypassing cache', default: false })
  @IsBoolean()
  @IsOptional()
  force_refresh?: boolean;
}

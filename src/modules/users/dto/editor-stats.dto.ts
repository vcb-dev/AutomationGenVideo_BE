import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum Platform {
  TIKTOK = 'TIKTOK',
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  DOUYIN = 'DOUYIN',
  XIAOHONGSHU = 'XIAOHONGSHU',
}

export class GetEditorStatsQueryDto {
  @ApiPropertyOptional({ enum: Platform, description: 'Filter by platform' })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}

export class ChannelStatsDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  display_name: string | null;

  @ApiProperty()
  avatar_url: string | null;

  @ApiProperty()
  total_videos: number;

  @ApiProperty()
  total_followers: number | null;

  @ApiProperty()
  total_likes: number;

  @ApiProperty()
  total_views: number;

  @ApiProperty()
  engagement_rate: number;

  @ApiProperty()
  last_synced_at: Date | null;
}

export class EditorStatsDto {
  @ApiProperty()
  total_channels: number;

  @ApiProperty({ description: 'Number of unique videos produced (content-based deduplication)' })
  total_videos_produced: number;

  @ApiProperty({ description: 'Number of times videos were posted across all channels' })
  total_videos_posted: number;

  @ApiProperty()
  total_followers: number;

  @ApiProperty()
  total_likes: number;

  @ApiProperty()
  total_views: number;

  @ApiProperty({ type: [ChannelStatsDto] })
  channels: ChannelStatsDto[];
}

export class EditorWithStatsDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty()
  avatar: string | null;

  @ApiProperty({ enum: ['ADMIN', 'MANAGER', 'LEADER', 'EDITOR', 'CONTENT'], isArray: true })
  roles: string[];

  @ApiProperty()
  is_active: boolean;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ type: EditorStatsDto })
  stats: EditorStatsDto;
}

export class MyEditorsResponseDto {
  @ApiProperty({ type: [EditorWithStatsDto] })
  editors: EditorWithStatsDto[];

  @ApiProperty()
  total_editors: number;

  @ApiProperty()
  platform_filter: string | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { Platform } from '@prisma/client';

export class PlatformStatsDto {
  @ApiProperty({ enum: Platform })
  platform: Platform;

  @ApiProperty()
  totalChannels: number;

  @ApiProperty()
  totalVideos: number;

  @ApiProperty()
  totalLikes: number;

  @ApiProperty()
  totalViews: number;

  @ApiProperty()
  totalComments: number;

  @ApiProperty()
  avgEngagementRate: number;
}

export class TrendDataDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  likes: number;

  @ApiProperty()
  views: number;

  @ApiProperty()
  comments: number;
}

export class PlatformTrendDto {
  @ApiProperty({ enum: Platform })
  platform: Platform;

  @ApiProperty({ type: [TrendDataDto] })
  trends: TrendDataDto[];

  @ApiProperty()
  likesGrowth: number; // Percentage

  @ApiProperty()
  viewsGrowth: number; // Percentage

  @ApiProperty()
  commentsGrowth: number; // Percentage;
}

export class ManagerDashboardDto {
  @ApiProperty({ type: [PlatformStatsDto] })
  platformStats: PlatformStatsDto[];

  @ApiProperty({ type: [PlatformTrendDto] })
  platformTrends: PlatformTrendDto[];

  @ApiProperty()
  totalChannelsAcrossAllPlatforms: number;

  @ApiProperty()
  totalVideosAcrossAllPlatforms: number;
}

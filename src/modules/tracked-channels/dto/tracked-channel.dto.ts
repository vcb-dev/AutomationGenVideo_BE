import { IsString, IsEnum, IsOptional, IsInt, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Platform {
  TIKTOK = 'TIKTOK',
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  DOUYIN = 'DOUYIN',
  XIAOHONGSHU = 'XIAOHONGSHU',
}

export class CreateTrackedChannelDto {
  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty()
  @IsString()
  username: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_followers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_likes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_videos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  engagement_rate?: number;
}

export class UpdateTrackedChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_followers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_likes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  total_videos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  engagement_rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

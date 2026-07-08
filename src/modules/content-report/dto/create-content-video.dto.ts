import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '@prisma/client';

export class CreateContentVideoDto {
  @ApiProperty({ example: 'team-uuid' })
  @IsString()
  @IsNotEmpty()
  team_id: string;

  @ApiProperty({ example: 'period-uuid' })
  @IsString()
  @IsNotEmpty()
  period_id: string;

  @ApiPropertyOptional({ example: 'user-uuid', description: 'Editor user ID' })
  @IsString()
  @IsOptional()
  editor_id?: string;

  @ApiPropertyOptional({ example: 'Đỗ Thị Nga', description: 'Editor full name' })
  @IsString()
  @IsOptional()
  editor?: string;

  @ApiProperty({ enum: VideoStatus, example: 'WIN' })
  @IsEnum(VideoStatus)
  status: VideoStatus;

  @ApiProperty({ example: 'Review chi tiết sản phẩm...' })
  @IsString()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analysis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  post_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  likes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shares?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnail_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  video_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  highlights?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leader_comment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  order_index?: number;
}

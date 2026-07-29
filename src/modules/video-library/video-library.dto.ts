import { IsString, IsOptional, IsNumber, IsEnum, IsUrl, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Dùng chung cho cả "đề xuất" (member, POST /video-proposals) lẫn "thêm thẳng"
// (leader/admin, POST /video-library/direct) — 2 endpoint khác nhau ở service
// method gọi + có qua hàng chờ duyệt hay không, không phải ở shape dữ liệu.
export class ProposeVideoDto {
  @ApiProperty() @IsString() video_id: string;
  @ApiProperty() @IsString() platform: string;
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiProperty() @IsUrl({ require_tld: false }) video_url: string;
  @ApiPropertyOptional() @IsString() @IsOptional() author_username?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() author_name?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() thumbnail_url?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) views_count?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) likes_count?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) comments_count?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) shares_count?: number;
  @ApiPropertyOptional() @IsArray() @IsString({ each: true }) @IsOptional() hashtags?: string[];
  @ApiPropertyOptional({ enum: ['SCRAPED', 'MANUAL'] })
  @IsEnum(['SCRAPED', 'MANUAL'])
  @IsOptional()
  source?: 'SCRAPED' | 'MANUAL';
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}

export class ReviewProposalDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsEnum(['APPROVED', 'REJECTED']) action: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsString() @IsOptional() note?: string;
}

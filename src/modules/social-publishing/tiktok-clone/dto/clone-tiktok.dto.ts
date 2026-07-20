import { IsString, IsArray, IsOptional, IsUrl, ArrayNotEmpty, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CloneTiktokDto {
  @ApiProperty({ description: 'URL video TikTok cần clone (vd: https://www.tiktok.com/@user/video/123)' })
  @IsUrl({}, { message: 'tiktokUrl phải là URL TikTok hợp lệ' })
  @IsNotEmpty()
  tiktokUrl: string;

  @ApiProperty({ description: 'Caption cho bài đăng Facebook' })
  @IsString()
  caption: string;

  @ApiProperty({ description: 'Danh sách ID các Facebook account/page để đăng' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountIds: string[];

  @ApiPropertyOptional({ description: 'URL video trực tiếp (extension cung cấp, bỏ qua bước fetch TikTok)' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'videoUrl phải là URL http/https hợp lệ' })
  videoUrl?: string;

  @ApiPropertyOptional({ description: 'URL thumbnail TikTok' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: 'Tiêu đề / mô tả gốc từ TikTok' })
  @IsOptional()
  @IsString()
  originalTitle?: string;
}

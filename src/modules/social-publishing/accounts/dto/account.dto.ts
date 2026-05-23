import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';

export class ConnectViaTokenDto {
  @ApiProperty({ enum: SocialPlatform })
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @ApiProperty()
  @IsString()
  access_token: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @ApiPropertyOptional({ description: 'Page ID (Facebook page đăng bài)' })
  @IsOptional()
  @IsString()
  page_id?: string;

  @ApiPropertyOptional({ description: 'Page access token (nếu có)' })
  @IsOptional()
  @IsString()
  page_token?: string;
}

export class GetPagesQueryDto {
  @ApiPropertyOptional({ description: 'Buộc làm mới cache' })
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class AddManualInstagramAccountDto {
  @ApiProperty({ description: 'Tên tài khoản Instagram' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Tên người dùng Instagram' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'Access token Instagram' })
  @IsString()
  access_token: string;

  @ApiPropertyOptional({ description: 'ID tài khoản cha (Facebook) - tuỳ chọn' })
  @IsOptional()
  @IsString()
  parent_id?: string;

  @ApiPropertyOptional({ description: 'URL ảnh đại diện' })
  @IsOptional()
  @IsString()
  avatar_url?: string;
}

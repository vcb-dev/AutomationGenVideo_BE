import { IsEnum, IsOptional, IsInt, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IdPhotoPosition, IdPhotoStatus } from '@prisma/client';

export class IdPhotoHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái', enum: IdPhotoStatus })
  @IsOptional()
  @IsEnum(IdPhotoStatus)
  status?: IdPhotoStatus;

  @ApiPropertyOptional({ description: 'Lọc theo cấp bậc', enum: IdPhotoPosition })
  @IsOptional()
  @IsEnum(IdPhotoPosition)
  position?: IdPhotoPosition;

  @ApiPropertyOptional({ description: 'Tìm theo tên/mã nhân viên (chứa chuỗi, không phân biệt hoa thường)' })
  @IsOptional()
  @IsString()
  search?: string;
}

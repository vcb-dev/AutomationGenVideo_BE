import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Đặt tên riêng `ContentTransformHistoryQueryDto` (thay vì trùng `HistoryQueryDto` với
 * ./paast-history-query.dto) vì cả hai cùng sống trong module ai-integration từ khi gộp
 * content-transform vào đây — trùng tên class sẽ đụng import trong ai-integration.controller.ts.
 */
export class ContentTransformHistoryQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by character ID or slug' })
  @IsOptional()
  @IsString()
  character_id?: string;

  @ApiPropertyOptional({ description: 'Filter by status (SUCCESS | FAILED)' })
  @IsOptional()
  @IsString()
  status?: string;
}

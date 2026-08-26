import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryOmsProductDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc SKU' }) @IsString() @IsOptional() q?: string;
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @ApiPropertyOptional({ default: 20, description: 'Tối đa 200 (giới hạn của OMS)' })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page_size?: number = 20;
  @ApiPropertyOptional() @Type(() => Boolean) @IsBoolean() @IsOptional() is_published?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() category_id?: string;
}

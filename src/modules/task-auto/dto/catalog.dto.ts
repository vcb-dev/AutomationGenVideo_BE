import {
  IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsInt, Min, IsArray,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─── Product ─────────────────────────────────────────────────────────────────

export class CreateProductDto {
  @ApiProperty() @IsString() sku: string
  @ApiProperty() @IsString() name: string
  @ApiPropertyOptional() @IsString() @IsOptional() image_url?: string
  @ApiPropertyOptional() @IsArray() @IsString({ each: true }) @IsOptional() image_urls?: string[]
  @ApiPropertyOptional() @IsNumber() @IsOptional() @Type(() => Number) price?: number
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string
  @ApiPropertyOptional() @IsString() @IsOptional() price_segment?: string
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) priority_score?: number
  @ApiPropertyOptional() @IsString() @IsOptional() material_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string
  @ApiPropertyOptional() @IsString() @IsOptional() image_url?: string
  @ApiPropertyOptional() @IsArray() @IsString({ each: true }) @IsOptional() image_urls?: string[]
  @ApiPropertyOptional() @IsNumber() @IsOptional() @Type(() => Number) price?: number
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string
  @ApiPropertyOptional() @IsString() @IsOptional() price_segment?: string
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() @Type(() => Number) priority_score?: number
  @ApiPropertyOptional() @IsString() @IsOptional() material_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
}

export class QueryProductDto {
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() @Type(() => Boolean) is_active?: boolean
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1
  @ApiPropertyOptional({ default: 50 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 50
}

// ─── Content ──────────────────────────────────────────────────────────────────

export class CreateContentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string
  @ApiPropertyOptional() @IsString() @IsOptional() body?: string
  @ApiPropertyOptional() @IsString() @IsOptional() script?: string
  @ApiPropertyOptional() @IsString() @IsOptional() file_content_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() voice_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional({ enum: ["GLOBAL", "VIETNAM"] })
  @IsEnum(["GLOBAL", "VIETNAM"])
  @IsOptional()
  market?: "GLOBAL" | "VIETNAM"
}

export class UpdateContentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string
  @ApiPropertyOptional() @IsString() @IsOptional() body?: string
  @ApiPropertyOptional() @IsString() @IsOptional() script?: string
  @ApiPropertyOptional() @IsString() @IsOptional() file_content_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() voice_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional({ enum: ["GLOBAL", "VIETNAM"] })
  @IsEnum(["GLOBAL", "VIETNAM"])
  @IsOptional()
  market?: "GLOBAL" | "VIETNAM"
  @ApiPropertyOptional() @IsEnum(['AVAILABLE', 'IN_TASK', 'USED', 'ARCHIVED']) @IsOptional()
  status?: 'AVAILABLE' | 'IN_TASK' | 'USED' | 'ARCHIVED'
}

export class QueryContentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() status?: string
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1
  @ApiPropertyOptional({ default: 50 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 50
}

// ─── Source ───────────────────────────────────────────────────────────────────

export class CreateSourceDto {
  @ApiProperty({ enum: ['PRODUCT_STOCK', 'COLLECTED', 'OUTRO', 'WORKSHOP', 'HUYK'] })
  @IsEnum(['PRODUCT_STOCK', 'COLLECTED', 'OUTRO', 'WORKSHOP', 'HUYK']) type: string

  @ApiProperty() @IsString() name: string
  @ApiProperty() @IsString() link: string
  @ApiPropertyOptional() @IsString() @IsOptional() code?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
}

export class UpdateSourceDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string
  @ApiPropertyOptional() @IsString() @IsOptional() link?: string
  @ApiPropertyOptional() @IsString() @IsOptional() code?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
}

export class QuerySourceDto {
  @ApiPropertyOptional() @IsString() @IsOptional() type?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() @Type(() => Boolean) is_active?: boolean
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1
  @ApiPropertyOptional({ default: 50 }) @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 50
}

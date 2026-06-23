import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsInt,
  Min,
  IsArray,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type BrandType = "DO_DA" | "TRANG_SUC";
const BRAND_TYPES: BrandType[] = ["DO_DA", "TRANG_SUC"];

// ─── Product ─────────────────────────────────────────────────────────────────

export class CreateProductDto {
  @ApiProperty() @IsString() sku: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) brand_type: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() image_url?: string;
  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  image_urls?: string[];
  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  price?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() price_segment?: string;
  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  priority_score?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() material_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() image_url?: string;
  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  image_urls?: string[];
  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  price?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() price_segment?: string;
  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  priority_score?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() material_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean;
}

export class QueryProductDto {
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional({ enum: ["global", "personal", "all"] })
  @IsString()
  @IsOptional()
  owner?: "global" | "personal" | "all";
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;
  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;
}

// ─── Content ──────────────────────────────────────────────────────────────────

export class CreateContentDto {
  @ApiProperty({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) brand_type: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() body?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() script?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() file_content_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() voice_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional({ enum: ["GLOBAL", "VIETNAM"] })
  @IsEnum(["GLOBAL", "VIETNAM"])
  @IsOptional()
  market?: "GLOBAL" | "VIETNAM";
}

export class UpdateContentDto {
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() body?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() script?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() file_content_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() voice_url?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string;
  @ApiPropertyOptional({ enum: ["GLOBAL", "VIETNAM"] })
  @IsEnum(["GLOBAL", "VIETNAM"])
  @IsOptional()
  market?: "GLOBAL" | "VIETNAM";
  @ApiPropertyOptional()
  @IsEnum(["AVAILABLE", "IN_TASK", "USED", "ARCHIVED"])
  @IsOptional()
  status?: "AVAILABLE" | "IN_TASK" | "USED" | "ARCHIVED";
}

export class QueryContentDto {
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() status?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string;
  @ApiPropertyOptional({ enum: ["global", "personal", "all"] })
  @IsString()
  @IsOptional()
  owner?: "global" | "personal" | "all";
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;
  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;
}

// ─── Source ───────────────────────────────────────────────────────────────────

export class CreateSourceDto {
  @ApiProperty({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) brand_type: BrandType;
  @ApiProperty({
    enum: ["PRODUCT_STOCK", "COLLECTED", "OUTRO", "WORKSHOP", "HUYK"],
  })
  @IsEnum(["PRODUCT_STOCK", "COLLECTED", "OUTRO", "WORKSHOP", "HUYK"])
  type: string;

  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsString() link: string;
  @ApiPropertyOptional() @IsString() @IsOptional() code?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean;
}

export class UpdateSourceDto {
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() link?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() code?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean;
}

// owner: 'global' = team_id null & user_id null; 'team' = team_id set; 'editor' = user_id set
export class QuerySourceDto {
  @ApiPropertyOptional({ enum: BRAND_TYPES }) @IsEnum(BRAND_TYPES) @IsOptional() brand_type?: BrandType;
  @ApiPropertyOptional() @IsString() @IsOptional() type?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() user_id?: string;
  @ApiPropertyOptional({ enum: ["global", "team", "editor", "all"] })
  @IsString()
  @IsOptional()
  owner?: "global" | "team" | "editor" | "all";
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;
  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;
}

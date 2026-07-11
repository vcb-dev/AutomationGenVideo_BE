import {
  IsString,
  IsOptional,
  IsArray,
  Matches,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BrandType } from "../catalog/catalog.dto";

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const BRAND_TYPES: BrandType[] = ["DO_DA", "TRANG_SUC"];

export type CatalogTier = "global" | "team" | "editor";
export type CatalogType = "product" | "content" | "source";

export class GetWarehouseQuery {
  @ApiProperty({ example: "2026-06", description: "Tháng kho (yyyy-MM)" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiPropertyOptional({ enum: BRAND_TYPES, description: "Lọc theo loại brand (đồ da / trang sức)" })
  @IsEnum(BRAND_TYPES)
  @IsOptional()
  brand_type?: BrandType;
}

export class AddToWarehouseDto {
  @ApiProperty({ example: "2026-06" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiProperty({ description: "Danh sách ID cần thêm vào kho tháng" })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class ProductWarehouseItemDto {
  @ApiProperty({ description: "ID team_product/editor_product" })
  @IsString()
  id: string;

  @ApiPropertyOptional({
    description: "Số video cụ thể cần cho sản phẩm này trong tháng (mặc định 1)",
    default: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  target_quantity?: number;
}

export class AddProductsToWarehouseDto {
  @ApiProperty({ example: "2026-06" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiPropertyOptional({
    description: "Danh sách ID cần thêm vào kho tháng (dạng cũ, target_quantity mặc định = 1)",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ids?: string[];

  @ApiPropertyOptional({
    type: [ProductWarehouseItemDto],
    description: "Danh sách sản phẩm kèm target_quantity cụ thể",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductWarehouseItemDto)
  @IsOptional()
  items?: ProductWarehouseItemDto[];
}

export class UpdateWarehouseQuantityItemDto {
  @ApiProperty({ description: "ID team_product/editor_product" })
  @IsString()
  id: string;

  @ApiProperty({ description: "Số video cụ thể cần cho sản phẩm này trong tháng" })
  @IsInt()
  @Min(1)
  target_quantity: number;
}

export class UpdateWarehouseQuantityDto {
  @ApiProperty({ example: "2026-06" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiProperty({ type: [UpdateWarehouseQuantityItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateWarehouseQuantityItemDto)
  items: UpdateWarehouseQuantityItemDto[];
}

export class RemoveFromWarehouseDto {
  @ApiProperty({ example: "2026-06" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiProperty({ description: "Danh sách ID cần xoá khỏi kho tháng" })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class PushToMonthDto {
  @ApiProperty({ example: "2026-05", description: "Tháng nguồn (tháng trước)" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "from_month phải có định dạng yyyy-MM" })
  from_month: string;

  @ApiProperty({ example: "2026-06", description: "Tháng đích (tháng này)" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "to_month phải có định dạng yyyy-MM" })
  to_month: string;

  @ApiPropertyOptional({
    description:
      "Danh sách ID muốn đẩy. Nếu bỏ trống thì đẩy toàn bộ kho tháng nguồn.",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ids?: string[];
}

export class AutoCarryDto {
  @ApiProperty({ example: "2026-06", description: "Tháng đích cần copy sang" })
  @IsString()
  @Matches(MONTH_REGEX, { message: "month phải có định dạng yyyy-MM" })
  month: string;

  @ApiPropertyOptional({
    enum: ["global", "editor"],
    description: "Tier cần auto-carry. Mặc định carry cả hai.",
  })
  @IsEnum(["global", "editor"])
  @IsOptional()
  tier?: "global" | "editor";

  @ApiPropertyOptional({
    description: "Chỉ carry cho editor_id này (chỉ dùng khi tier=editor).",
  })
  @IsString()
  @IsOptional()
  editor_id?: string;
}

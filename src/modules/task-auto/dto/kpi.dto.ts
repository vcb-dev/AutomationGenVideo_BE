import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ─── TeamKpi ──────────────────────────────────────────────────────────────────

export class KpiAllocationDto {
  @ApiProperty({ enum: ["CONTENT_LINE", "PRODUCT_LINE"] })
  @IsEnum(["CONTENT_LINE", "PRODUCT_LINE"])
  type: "CONTENT_LINE" | "PRODUCT_LINE";

  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  percent: number;
}

export class UpsertTeamKpiDto {
  @ApiProperty() @IsString() team_id: string;
  @ApiProperty() @IsString() month: string; // YYYY-MM
  @ApiPropertyOptional() @IsString() @IsOptional() note?: string;

  @ApiProperty({ type: [KpiAllocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KpiAllocationDto)
  allocations: KpiAllocationDto[];
}

// ─── EditorKpi ────────────────────────────────────────────────────────────────

const intField = () => ({ default: 0 });
const n = () => [Type(() => Number), IsInt(), Min(0)];

export class UpsertEditorKpiDto {
  @ApiProperty() @IsString() user_id: string;
  @ApiProperty() @IsString() month: string; // YYYY-MM

  // ── Video production ──
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  total_target: number; // Tổng video SX (auto-assign)
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  video_win: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  video_fail: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratio_a1: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratio_a2: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratio_a3: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratio_a4: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ratio_a5: number;

  // ── Content ──
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  kpi_extra: number; // sáng tạo (không tạo task)
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  content_new: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  content_collected: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  content_win_cover: number;

  // ── Product ──
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  product_planned: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  product_win_collect: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  video_traffic: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  video_gmv: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  video_profit: number;
}

// ─── EditorWeekendKpi (kept for backward-compat) ─────────────────────────────

export class UpsertEditorWeekendKpiDto {
  @ApiProperty() @IsString() user_id: string;
  @ApiProperty() @IsString() date: string;
  @ApiProperty({ default: 0 }) @Type(() => Number) @IsInt() @Min(0) kpi: number;
}

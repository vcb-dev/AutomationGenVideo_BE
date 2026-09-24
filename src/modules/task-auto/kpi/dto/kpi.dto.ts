import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  IsEnum,
  Matches,
  ArrayNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ─── TeamKpi ──────────────────────────────────────────────────────────────────

export class TeamKpiAllocationDto {
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

  @ApiProperty({ type: [TeamKpiAllocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamKpiAllocationDto)
  allocations: TeamKpiAllocationDto[];
}

// ─── EditorKpi allocation ─────────────────────────────────────────────────────

export class EditorKpiAllocationDto {
  @ApiProperty({ enum: ["CONTENT_LINE", "PRODUCT_LINE"] })
  @IsEnum(["CONTENT_LINE", "PRODUCT_LINE"])
  type: "CONTENT_LINE" | "PRODUCT_LINE";

  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string;

  @ApiProperty({
    minimum: 0,
    description: "Số video cụ thể cho tuyến/dòng này",
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;
}

// ─── EditorKpi ────────────────────────────────────────────────────────────────

const intField = () => ({ default: 0 });
const n = () => [Type(() => Number), IsInt(), Min(0)];

export class UpsertEditorKpiDto {
  @ApiProperty() @IsString() user_id: string;
  @ApiProperty() @IsString() team_id: string;  // team này KPI thuộc về
  @ApiProperty() @IsString() month: string; // YYYY-MM

  // ── Video production ──
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  total_target: number; // Tổng video SX (auto-assign)

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
  content_paast_analyzed: number;
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
  product_gmv: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  product_traffic: number;
  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  product_profit: number;
  /** Optional để client cũ không bị 400 — service fallback 0. */
  @ApiPropertyOptional(intField())
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  product_collect_test_win?: number;

  @ApiProperty({ type: [EditorKpiAllocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditorKpiAllocationDto)
  allocations: EditorKpiAllocationDto[];
}

// ─── Editor Daily KPI ─────────────────────────────────────────────────────────

export class EditorDailyKpiEntryDto {
  @ApiProperty() @IsString() user_id: string;

  @ApiProperty({
    minimum: 0,
    description: "KPI ngày (số video); 0 = chưa set → fallback logic cũ",
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  target: number;

  @ApiPropertyOptional() @IsString() @IsOptional() note?: string;
}

export class UpsertEditorDailyKpiDto {
  @ApiProperty() @IsString() team_id: string;

  @ApiProperty({ description: "Ngày áp dụng, định dạng YYYY-MM-DD" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date phải có dạng YYYY-MM-DD" })
  date: string;

  @ApiProperty({ type: [EditorDailyKpiEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => EditorDailyKpiEntryDto)
  entries: EditorDailyKpiEntryDto[];
}

// ─── Content Creator KPI (target tháng thủ công) ───────────────────────────────

export class UpsertContentCreatorKpiDto {
  @ApiProperty() @IsString() user_id: string;
  @ApiProperty() @IsString() team_id: string;
  @ApiProperty() @IsString() month: string; // YYYY-MM

  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  content_target: number;

  @ApiProperty(intField())
  @Type(() => Number)
  @IsInt()
  @Min(0)
  translation_target: number;

  @ApiPropertyOptional() @IsString() @IsOptional() note?: string;
}

// ─── Content Creator Daily KPI ─────────────────────────────────────────────────

export class ContentCreatorDailyKpiEntryDto {
  @ApiProperty() @IsString() user_id: string;

  @ApiProperty({
    minimum: 0,
    description: "KPI ngày (số content); 0 = chưa set",
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  target: number;

  @ApiPropertyOptional() @IsString() @IsOptional() note?: string;
}

export class UpsertContentCreatorDailyKpiDto {
  @ApiProperty() @IsString() team_id: string;

  @ApiProperty({ description: "Ngày áp dụng, định dạng YYYY-MM-DD" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date phải có dạng YYYY-MM-DD" })
  date: string;

  @ApiProperty({ type: [ContentCreatorDailyKpiEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContentCreatorDailyKpiEntryDto)
  entries: ContentCreatorDailyKpiEntryDto[];
}

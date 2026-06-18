import { IsString, IsOptional, IsInt, Min, IsArray, ValidateNested, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─── TeamKpi ──────────────────────────────────────────────────────────────────

export class KpiAllocationDto {
  @ApiProperty({ enum: ['CONTENT_LINE', 'PRODUCT_LINE'] })
  @IsEnum(['CONTENT_LINE', 'PRODUCT_LINE']) type: 'CONTENT_LINE' | 'PRODUCT_LINE'

  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_line_id?: string

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(0) percent: number
}

export class UpsertTeamKpiDto {
  @ApiProperty() @IsString() team_id: string
  @ApiProperty() @IsString() month: string  // YYYY-MM
  @ApiPropertyOptional() @IsString() @IsOptional() note?: string

  @ApiProperty({ type: [KpiAllocationDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => KpiAllocationDto)
  allocations: KpiAllocationDto[]
}

// ─── EditorKpi ────────────────────────────────────────────────────────────────

export class UpsertEditorKpiDto {
  @ApiProperty() @IsString() user_id: string
  @ApiProperty() @IsString() month: string  // YYYY-MM

  @ApiProperty({ default: 0, description: 'Tổng KPI thường trong tháng (auto-assign sẽ tạo task)' })
  @Type(() => Number) @IsInt() @Min(0) kpi_auto: number

  @ApiProperty({ default: 0, description: 'Tổng KPI sáng tạo thêm trong tháng (chỉ thông báo, không tạo task)' })
  @Type(() => Number) @IsInt() @Min(0) kpi_extra: number
}

// ─── EditorWeekendKpi ─────────────────────────────────────────────────────────

export class UpsertEditorWeekendKpiDto {
  @ApiProperty() @IsString() user_id: string
  @ApiProperty({ description: 'Ngày Chủ nhật (YYYY-MM-DD)' }) @IsString() date: string

  @ApiProperty({ default: 0, description: 'Số task giao trong Chủ nhật đó — trừ vào tổng KPI tháng' })
  @Type(() => Number) @IsInt() @Min(0) kpi: number
}

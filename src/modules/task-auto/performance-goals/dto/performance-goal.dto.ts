import { Type, Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  PerformanceGoalDirection,
  PerformanceGoalMetricType,
  PerformanceGoalStatus,
  PerformanceGoalType,
} from "@prisma/client";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PerformanceGoalQueryDto {
  @IsString()
  @Matches(MONTH_PATTERN, { message: "month phải có dạng YYYY-MM" })
  month: string;

  @IsUUID() @IsOptional() team_id?: string;
  @IsUUID() @IsOptional() user_id?: string;
  @IsEnum(PerformanceGoalType) @IsOptional() type?: PerformanceGoalType;
  @IsUUID() @IsOptional() kpi_group_id?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  include_archived?: boolean;
}

export class CreatePerformanceGoalDto {
  @IsUUID() user_id: string;
  @IsUUID() team_id: string;

  @IsString()
  @Matches(MONTH_PATTERN, { message: "month phải có dạng YYYY-MM" })
  month: string;

  @IsEnum(PerformanceGoalType) type: PerformanceGoalType;
  @IsUUID() @IsOptional() kpi_group_id?: string;

  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsString() @MaxLength(2000) @IsOptional() description?: string;
  @IsEnum(PerformanceGoalMetricType) @IsOptional() metric_type?: PerformanceGoalMetricType;
  @IsString() @MaxLength(40) @IsOptional() unit?: string;
  @IsEnum(PerformanceGoalDirection) @IsOptional() direction?: PerformanceGoalDirection;

  @Type(() => Number) @IsNumber() @Min(0.0001) target_value: number;
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional() actual_manual?: number | null;
  @IsEnum(PerformanceGoalStatus) @IsOptional() status?: PerformanceGoalStatus;
}

export class UpdatePerformanceGoalDto {
  @Type(() => Number) @IsInt() @Min(1) expected_revision: number;

  @IsEnum(PerformanceGoalType) @IsOptional() type?: PerformanceGoalType;
  @IsUUID() @IsOptional() kpi_group_id?: string | null;
  @IsString() @MinLength(2) @MaxLength(160) @IsOptional() title?: string;
  @IsString() @MaxLength(2000) @IsOptional() description?: string | null;
  @IsEnum(PerformanceGoalMetricType) @IsOptional() metric_type?: PerformanceGoalMetricType;
  @IsString() @MaxLength(40) @IsOptional() unit?: string | null;
  @IsEnum(PerformanceGoalDirection) @IsOptional() direction?: PerformanceGoalDirection;

  @Type(() => Number) @IsNumber() @Min(0.0001) @IsOptional() target_value?: number;
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional() actual_manual?: number | null;
  @IsEnum(PerformanceGoalStatus) @IsOptional() status?: PerformanceGoalStatus;

  @IsString() @MaxLength(500) @IsOptional() change_reason?: string;
}

export class PerformanceKpiGroupQueryDto {
  @IsUUID() @IsOptional() team_id?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  include_archived?: boolean;
}

export class CreatePerformanceKpiGroupDto {
  @IsUUID() team_id: string;
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsString() @MaxLength(500) @IsOptional() description?: string;
  @IsIn(["ORANGE", "GREEN", "PURPLE", "BLUE", "SLATE", "AMBER", "ROSE"])
  @IsOptional()
  color?: string;
  @IsIn(["VIDEO", "FILE_TEXT", "PACKAGE", "TARGET"])
  @IsOptional()
  icon?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() sort_order?: number;
}

export class UpdatePerformanceKpiGroupDto {
  @IsString() @MinLength(2) @MaxLength(100) @IsOptional() name?: string;
  @IsString() @MaxLength(500) @IsOptional() description?: string | null;
  @IsIn(["ORANGE", "GREEN", "PURPLE", "BLUE", "SLATE", "AMBER", "ROSE"])
  @IsOptional()
  color?: string;
  @IsIn(["VIDEO", "FILE_TEXT", "PACKAGE", "TARGET"])
  @IsOptional()
  icon?: string;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() sort_order?: number;
}

export class ArchivePerformanceGoalQueryDto {
  @Type(() => Number) @IsInt() @Min(1) revision: number;
  @IsString() @MinLength(2) @MaxLength(500) reason: string;
}

export class PerformanceGoalPayrollQueryDto {
  @IsString()
  @Matches(MONTH_PATTERN, { message: "month phải có dạng YYYY-MM" })
  month: string;
}

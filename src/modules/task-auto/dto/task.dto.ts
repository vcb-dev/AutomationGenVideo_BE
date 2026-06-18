import {
  IsString, IsOptional, IsEnum, IsIn, IsDateString, IsInt, Min, IsBoolean,
} from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export enum TaskStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export class CreateTaskDto {
  @ApiProperty() @IsString() team_id: string
  @ApiProperty() @IsString() content_id: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_outro_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_extra_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsDateString() @IsOptional() deadline?: string
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsEnum(TaskStatus) @IsOptional() status?: TaskStatus
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsDateString() @IsOptional() deadline?: string
  @ApiPropertyOptional() @IsString() @IsOptional() result_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() reject_reason?: string
}

export class QueryTaskDto {
  @ApiPropertyOptional() @IsEnum(TaskStatus) @IsOptional() status?: TaskStatus
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  @ApiPropertyOptional() @IsString() @IsOptional() month?: string        // format: 2025-06
  @ApiPropertyOptional() @IsString() @IsOptional() deadline_date?: string // format: 2025-06-17

  /** 'auto' = is_auto && !is_extra | 'extra' = is_extra | 'manual' = !is_auto */
  @ApiPropertyOptional({ enum: ['auto', 'extra', 'manual'] })
  @IsIn(['auto', 'extra', 'manual']) @IsOptional() task_type?: 'auto' | 'extra' | 'manual'

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 20
}

export class SubmitTaskDto {
  @ApiPropertyOptional() @IsString() @IsOptional() result_url?: string
}

export class ReviewTaskDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED']) action: 'APPROVED' | 'REJECTED'

  @ApiPropertyOptional() @IsString() @IsOptional() reject_reason?: string
}

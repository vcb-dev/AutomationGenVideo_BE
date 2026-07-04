import {
  IsString, IsOptional, IsEnum, IsIn, IsDateString, IsInt, Min, IsBoolean, ValidateIf,
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
  @ApiPropertyOptional() @IsString() @IsOptional() content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() content_line_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_outro_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_extra_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_workshop_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() source_huyk_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_source_outro_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_source_extra_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_source_workshop_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_source_huyk_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_source_outro_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_source_extra_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_source_workshop_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_source_huyk_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsDateString() @IsOptional() deadline?: string
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsEnum(TaskStatus) @IsOptional() status?: TaskStatus
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsDateString() @IsOptional() deadline?: string
  @ApiPropertyOptional() @IsString() @IsOptional() result_url?: string
  @ApiPropertyOptional() @IsString() @IsOptional() reject_reason?: string
  @ApiPropertyOptional() @IsString() @IsOptional() content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_content_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() editor_product_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() team_product_id?: string
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() source_outro_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() source_extra_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() source_workshop_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() source_huyk_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() editor_source_outro_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() editor_source_extra_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() editor_source_workshop_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() editor_source_huyk_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() team_source_outro_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() team_source_extra_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() team_source_workshop_id?: string | null
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== null) @IsString() @IsOptional() team_source_huyk_id?: string | null
}

export class QueryTaskDto {
  @ApiPropertyOptional() @IsEnum(TaskStatus) @IsOptional() status?: TaskStatus
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string
  @ApiPropertyOptional() @IsString() @IsOptional() month?: string        // format: 2025-06
  @ApiPropertyOptional() @IsString() @IsOptional() deadline_date?: string // format: 2025-06-17

  @ApiPropertyOptional({ enum: ['auto', 'extra'] })
  @IsIn(['auto', 'extra']) @IsOptional() task_type?: 'auto' | 'extra'

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

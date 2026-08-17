import {
  IsString, IsOptional, IsEnum, IsIn, IsDateString, IsInt, Min, IsBoolean, ValidateIf, IsArray, ValidateNested,
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
  @ApiPropertyOptional() @IsString() @IsOptional() deadline_from?: string // format: 2025-06-17
  @ApiPropertyOptional() @IsString() @IsOptional() deadline_to?: string   // format: 2025-06-17

  // Cột "Quá hạn" ảo (Kanban): task đang xử lý (chưa duyệt/huỷ) có deadline đã qua.
  // Khi bật, bỏ qua deadline_from/to/date/month và cả `status` — xem tasks.service.ts findAll.
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsIn(['true', 'false']) @IsOptional() overdue?: string

  // Dùng ở các cột trạng thái khác (trừ APPROVED) để loại task đã hiện ở cột "Quá hạn",
  // tránh hiển thị trùng 2 nơi.
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsIn(['true', 'false']) @IsOptional() exclude_overdue?: string

  @ApiPropertyOptional({ enum: ['auto', 'extra'] })
  @IsIn(['auto', 'extra']) @IsOptional() task_type?: 'auto' | 'extra'

  // Kanban cần task vừa đổi cột (đổi status) nổi lên đầu danh sách thay vì kẹt theo created_at
  // như view bảng — mặc định giữ nguyên created_at để không đổi hành vi Table view hiện có.
  @ApiPropertyOptional({ enum: ['created_at', 'updated_at'] })
  @IsIn(['created_at', 'updated_at']) @IsOptional() sort?: 'created_at' | 'updated_at'

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

export class PublishedLinkItemDto {
  @ApiProperty() @IsString() id: string
  @ApiProperty() @IsString() platform: string
  @ApiProperty() @IsString() url: string
}

export class UpdatePublishedLinksDto {
  @ApiProperty({ type: [PublishedLinkItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PublishedLinkItemDto)
  links: PublishedLinkItemDto[]
}

export class GenerateVideoScriptDto {
  @ApiPropertyOptional() @IsString() @IsOptional() fileUrl?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() scriptText?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentTitle?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentLine?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() contentMarket?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productName?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productSku?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productPrice?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productMaterial?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productPriceSegment?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productLine?: string | null
  @ApiPropertyOptional() @IsString() @IsOptional() productMarket?: string | null
  @ApiPropertyOptional() @IsBoolean() @IsOptional() force?: boolean
}

export class UpdateVideoScriptTranslationDto {
  @ApiProperty() @IsString() content: string
  @ApiPropertyOptional({ type: [String] }) @IsArray() @IsString({ each: true }) @IsOptional() hashtags?: string[]
}

export class UpdateVideoScriptDto {
  @ApiProperty() @IsString() content: string
  @ApiPropertyOptional({ type: [String] }) @IsArray() @IsString({ each: true }) @IsOptional() hashtags?: string[]
  @ApiPropertyOptional({ type: UpdateVideoScriptTranslationDto })
  @ValidateNested() @Type(() => UpdateVideoScriptTranslationDto) @IsOptional()
  translation?: UpdateVideoScriptTranslationDto
}

export class ReviewContentApprovalDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED']) action: 'APPROVED' | 'REJECTED'

  @ApiPropertyOptional() @IsString() @IsOptional() reject_reason?: string
}

export class QueryContentApprovalDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsIn(['PENDING', 'APPROVED', 'REJECTED']) @IsOptional() status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  @ApiPropertyOptional() @IsString() @IsOptional() team_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() assignee_id?: string
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() limit?: number = 10
}

export class TranslateVideoScriptDto {
  @ApiPropertyOptional({
    description: "Thị trường mục tiêu (vd 'Indonesia') — dùng để AI tự xác định ngôn ngữ khi task chưa từng có bản dịch nào",
  })
  @IsString() @IsOptional() market?: string | null
}

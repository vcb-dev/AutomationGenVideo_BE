import { IsString, IsOptional, IsBoolean, IsInt, IsUrl, Min, IsArray } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class UpdateAutoAssignSettingDto {
  @ApiPropertyOptional({ example: '08:00' })
  @IsString() @IsOptional() schedule_time?: string

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' })
  @IsString() @IsOptional() timezone?: string

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional() weekend_enabled?: boolean

  @ApiPropertyOptional()
  @IsBoolean() @IsOptional() is_active?: boolean

  @ApiPropertyOptional({ description: 'Số ngày cooldown mặc định (per editor+product) cho sản phẩm chưa tự set cooldown_days riêng', example: 5 })
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) default_cooldown_days?: number

  @ApiPropertyOptional({ description: 'Lập Kế hoạch ngày (chỉ tiêu + gợi ý content, không tạo task) cùng lượt chia task' })
  @IsBoolean() @IsOptional() daily_plan_enabled?: boolean

  @ApiPropertyOptional({ description: 'Tên tuyến nội dung lập Kế hoạch ngày', example: ['A1', 'A2', 'A3', 'A5'] })
  @IsArray() @IsString({ each: true }) @IsOptional() daily_plan_line_names?: string[]

  @ApiPropertyOptional({ description: 'Job khớp video ↔ task hỏi AI cho ca heuristic bỏ trống, gắn link khi AI đủ tự tin' })
  @IsBoolean() @IsOptional() video_match_ai_enabled?: boolean
}

export class UpdateLarkWebhookSettingDto {
  @ApiPropertyOptional({ description: 'Webhook bot Lark DÙNG CHUNG — nhận mọi thông báo cần duyệt của toàn hệ thống. null để xoá (fallback về .env).', nullable: true })
  @IsUrl({ require_protocol: true }) @IsOptional() webhook_url?: string | null

  @ApiPropertyOptional({ description: 'Secret Key ký số của bot trên — chỉ cần khi bot bật "Ký số bảo mật". null để xoá.', nullable: true })
  @IsString() @IsOptional() webhook_secret?: string | null
}

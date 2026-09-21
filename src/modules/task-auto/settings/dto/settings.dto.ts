import { IsString, IsOptional, IsBoolean, IsInt, IsUrl, Min } from 'class-validator'
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
}

export class UpdateLarkWebhookSettingDto {
  @ApiPropertyOptional({ description: 'Webhook bot Lark DÙNG CHUNG — nhận mọi thông báo cần duyệt của toàn hệ thống. null để xoá (fallback về .env).', nullable: true })
  @IsUrl({ require_protocol: true }) @IsOptional() webhook_url?: string | null

  @ApiPropertyOptional({ description: 'Secret Key ký số của bot trên — chỉ cần khi bot bật "Ký số bảo mật". null để xoá.', nullable: true })
  @IsString() @IsOptional() webhook_secret?: string | null
}

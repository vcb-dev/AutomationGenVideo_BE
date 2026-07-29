import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator'
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

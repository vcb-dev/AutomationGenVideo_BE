import { IsString, IsOptional, IsBoolean } from 'class-validator'
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
}

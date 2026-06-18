import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateTeamDto {
  @ApiProperty() @IsString() name: string
  @ApiPropertyOptional() @IsString() @IsOptional() leader_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
  @ApiPropertyOptional({ type: [String] })
  @IsArray() @IsString({ each: true }) @IsOptional() member_ids?: string[]
}

export class UpdateTeamDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string
  @ApiPropertyOptional() @IsString() @IsOptional() leader_id?: string
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
  @ApiPropertyOptional({ type: [String] })
  @IsArray() @IsString({ each: true }) @IsOptional() member_ids?: string[]
}

export class AddMemberDto {
  @ApiProperty() @IsString() user_id: string
}

export class EditorApprovalDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsString() action: 'APPROVED' | 'REJECTED'

  @ApiPropertyOptional() @IsString() @IsOptional() note?: string
}

export class SetEditorDto {
  @ApiProperty() @IsBoolean() is_editor: boolean
}

import { IsString, IsOptional, IsBoolean, IsArray, IsEnum, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { BrandType, TeamKind } from '@prisma/client'

// User.team lưu nhiều team dưới dạng chuỗi phân cách dấu phẩy — tên team chứa dấu phẩy
// sẽ bị các nơi parse (multi-select HR, splitTeamList...) tách nhầm thành nhiều team.
const NO_COMMA = /^[^,]+$/
const NO_COMMA_MSG = 'Tên team không được chứa dấu phẩy'

export class CreateTeamDto {
  @ApiProperty() @IsString() @Matches(NO_COMMA, { message: NO_COMMA_MSG }) name: string
  @ApiPropertyOptional() @IsString() @IsOptional() leader_id?: string
  @ApiPropertyOptional({ enum: BrandType }) @IsEnum(BrandType) @IsOptional() brand_type?: BrandType
  @ApiPropertyOptional({ enum: TeamKind }) @IsEnum(TeamKind) @IsOptional() team_kind?: TeamKind
  @ApiPropertyOptional() @IsBoolean() @IsOptional() is_active?: boolean
  @ApiPropertyOptional({ type: [String] })
  @IsArray() @IsString({ each: true }) @IsOptional() member_ids?: string[]
}

export class UpdateTeamDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @Matches(NO_COMMA, { message: NO_COMMA_MSG }) name?: string
  @ApiPropertyOptional() @IsString() @IsOptional() leader_id?: string
  @ApiPropertyOptional({ enum: BrandType }) @IsEnum(BrandType) @IsOptional() brand_type?: BrandType
  @ApiPropertyOptional({ enum: TeamKind }) @IsEnum(TeamKind) @IsOptional() team_kind?: TeamKind
  @ApiPropertyOptional() @IsString() @IsOptional() market?: string
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

export class SetContentCreatorDto {
  @ApiProperty() @IsBoolean() is_content_creator: boolean
}

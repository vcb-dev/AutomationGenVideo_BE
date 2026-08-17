import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Chặn file Excel khổng lồ làm nghẽn một request. */
const MAX_BULK_ROWS = 2000;
const MAX_NAME_LENGTH = 200;

export class CreateTeamDto {
  @ApiProperty({ example: 'Team Sales' })
  @IsString()
  @IsNotEmpty({ message: 'Tên team không được để trống' })
  @MaxLength(MAX_NAME_LENGTH)
  name: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;
}

export class CreateMemberDto {
  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty({ message: 'Tên thành viên không được để trống' })
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Phải chọn team cho thành viên' })
  teamId: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class BulkMemberRowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ description: 'Tên team dạng chữ; team chưa tồn tại sẽ được tạo mới' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  teamName: string;

  @ApiPropertyOptional({ description: 'Link ảnh đại diện của thành viên' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class BulkCreateMembersDto {
  @ApiProperty({ type: [BulkMemberRowDto] })
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ROWS, { message: `Mỗi lần nhập tối đa ${MAX_BULK_ROWS} dòng` })
  @ValidateNested({ each: true })
  @Type(() => BulkMemberRowDto)
  members: BulkMemberRowDto[];
}

export class CreateGiftDto {
  @ApiProperty({ example: 'Voucher 500k' })
  @IsString()
  @IsNotEmpty({ message: 'Tên quà không được để trống' })
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(1, { message: 'Số lượng phải lớn hơn 0' })
  total: number;
}

export class UpdateGiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  remaining?: number;
}

export class BulkGiftRowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  total: number;
}

export class BulkCreateGiftsDto {
  @ApiProperty({ type: [BulkGiftRowDto] })
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ROWS, { message: `Mỗi lần nhập tối đa ${MAX_BULK_ROWS} dòng` })
  @ValidateNested({ each: true })
  @Type(() => BulkGiftRowDto)
  gifts: BulkGiftRowDto[];
}

export class RecordMemberWinDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @ApiProperty({ description: 'true = loại khỏi vòng quay; false = "Tiếp tục quay", vẫn ghi lịch sử' })
  @IsBoolean()
  removeFromPool: boolean;
}

export class RecordTeamWinDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiProperty()
  @IsBoolean()
  removeFromPool: boolean;
}

export class AwardGiftDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  giftId: string;

  @ApiProperty({ enum: ['member', 'team'] })
  @IsIn(['member', 'team'])
  recipientType: 'member' | 'team';

  @ApiProperty({ description: 'id thành viên hoặc id team tuỳ recipientType' })
  @IsString()
  @IsNotEmpty()
  recipientId: string;
}

export class ResetStatusesDto {
  @ApiProperty({ enum: ['members', 'team'] })
  @IsIn(['members', 'team'])
  mode: 'members' | 'team';
}

export class DrawRoundDto {
  @ApiProperty({ enum: ['member', 'team', 'gift'] })
  @IsIn(['member', 'team', 'gift'])
  kind: 'member' | 'team' | 'gift';

  @ApiPropertyOptional({ description: 'Số người bốc trong một lượt (chỉ cho member/team)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @ApiPropertyOptional({ description: 'Lọc theo team khi bốc thành viên' })
  @IsOptional()
  @IsString()
  scopeTeamId?: string;

  @ApiPropertyOptional({ description: 'Vòng quay quà: ai nhận' })
  @IsOptional()
  @IsString()
  recipientId?: string;

  @ApiPropertyOptional({ enum: ['member', 'team'] })
  @IsOptional()
  @IsIn(['member', 'team'])
  recipientType?: 'member' | 'team';
}

export class ConfirmRoundDto {
  @ApiProperty({ description: 'true = loại người trúng khỏi vòng quay' })
  @IsBoolean()
  removeFromPool: boolean;
}

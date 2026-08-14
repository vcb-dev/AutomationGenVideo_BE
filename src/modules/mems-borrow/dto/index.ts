import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class BorrowLineDto {
  @ApiProperty()
  @IsUUID()
  modelId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateBorrowRequestDto {
  @ApiProperty()
  @IsUUID()
  departmentId: string;

  @ApiProperty({ description: 'Dự án hoặc mục đích sử dụng — BR-19 bắt buộc' })
  @IsString()
  @IsNotEmpty() // BR-19: chuỗi rỗng cũng là để trống, không được lọt
  project: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  place: string;

  @ApiProperty()
  @IsISO8601()
  fromTime: string;

  @ApiProperty()
  @IsISO8601()
  toTime: string;

  @ApiProperty({ type: [BorrowLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BorrowLineDto)
  lines: BorrowLineDto[];
}

export class CheckAvailabilityQueryDto {
  @ApiProperty()
  @IsUUID()
  modelId: string;

  @ApiProperty()
  @IsISO8601()
  fromTime: string;

  @ApiProperty()
  @IsISO8601()
  toTime: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class ApproveRequestDto {
  @ApiPropertyOptional({ description: 'Ghi chú của người duyệt, không bắt buộc' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectRequestDto {
  @ApiProperty({ description: 'BR-20: từ chối bắt buộc nêu lý do' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AssignLineDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ type: [String], description: 'Đúng bằng quantity của dòng' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  assetIds: string[];
}

export class AssignSerialsDto {
  @ApiProperty({ type: [AssignLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignLineDto)
  lines: AssignLineDto[];
}

export class AccessoryCheckDto {
  @ApiProperty()
  @IsUUID()
  accessoryId: string;

  @ApiProperty()
  @IsBoolean()
  isPresent: boolean;
}

export class HandoverUnitDto {
  @ApiProperty()
  @IsUUID()
  assetId: string;

  @ApiProperty({ description: 'Tình trạng lúc giao — mốc đối chiếu khi nhận lại' })
  @IsString()
  @IsNotEmpty()
  condition: string;

  @ApiProperty({ type: [String], description: 'BR-26: tối thiểu một ảnh' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  photoKeys: string[];

  @ApiPropertyOptional({ type: [AccessoryCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryCheckDto)
  accessories?: AccessoryCheckDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateHandoverDto {
  @ApiProperty({ description: 'Người nhận thực tế, có thể nhận thay người đứng tên' })
  @IsString()
  @IsNotEmpty()
  receivedBy: string;

  @ApiProperty({ type: [HandoverUnitDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HandoverUnitDto)
  units: HandoverUnitDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReturnUnitDto {
  @ApiProperty()
  @IsUUID()
  assetId: string;

  @ApiProperty({ description: 'Tình trạng ghi nhận lúc nhận lại' })
  @IsString()
  @IsNotEmpty()
  condition: string;

  @ApiProperty({ type: [String], description: 'Ảnh khi trả, tối thiểu một' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  photoKeys: string[];

  @ApiPropertyOptional({ type: [AccessoryCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessoryCheckDto)
  accessories?: AccessoryCheckDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateReturnDto {
  @ApiProperty({ type: [ReturnUnitDto], description: 'Chỉ những máy mang tới hôm nay' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnUnitDto)
  units: ReturnUnitDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

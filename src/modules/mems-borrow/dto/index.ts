import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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

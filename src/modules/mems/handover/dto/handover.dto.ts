import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

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

  @ApiPropertyOptional({
    type: [String],
    description: 'BR-26: ID ảnh đã tải lên; để trống thì dùng ảnh người mượn đính kèm phiếu',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoKeys?: string[];

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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { AccessoryCheckDto } from '../../handover/dto/handover.dto';

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

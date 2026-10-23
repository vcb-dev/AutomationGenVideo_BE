import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportIncidentDto {
  @ApiProperty({ description: 'Máy gặp sự cố, phải là máy đang mượn của phiếu' })
  @IsUUID()
  assetId: string;

  @ApiProperty({ enum: ['CONDITION_WORSENED', 'MISSING_ACCESSORY'] })
  @IsIn(['CONDITION_WORSENED', 'MISSING_ACCESSORY'])
  kind: 'CONDITION_WORSENED' | 'MISSING_ACCESSORY';

  @ApiProperty({ description: 'Mô tả sự cố' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ type: [String], description: 'ID ảnh đã tải qua POST /mems/request-photos, tối đa 3' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  photoIds?: string[];
}

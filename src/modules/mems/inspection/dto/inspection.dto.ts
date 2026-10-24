import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class InspectAssetDto {
  @ApiProperty({
    enum: ['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'],
    description: 'Kết luận sau kiểm tra: cho về kệ, đưa đi sửa, hay bỏ',
  })
  @IsIn(['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'])
  result: string;

  @ApiPropertyOptional({ description: 'Tình trạng vật lý sau kiểm tra; bỏ trống thì giữ nguyên' })
  @IsOptional()
  @IsIn(['GOOD', 'USED', 'NEEDS_CHECK', 'IN_MAINTENANCE', 'BROKEN'])
  condition?: string;

  @ApiPropertyOptional({ description: 'Kết luận Bảo trì thì đây thành lý do của lệnh bảo trì' })
  @IsOptional()
  @IsString()
  note?: string;
}

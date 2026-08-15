import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateAssetDto {
  @ApiProperty()
  @IsUUID()
  modelId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  purchaseDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  purchasePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'],
    description: 'Tình trạng vật lý lúc nhập kho; bỏ trống hiểu là Tốt',
  })
  @IsOptional()
  @IsIn(['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'])
  condition?: string;

  @ApiPropertyOptional({ description: 'Ghi chú lúc nhập kho, vào thẳng nhật ký vòng đời' })
  @IsOptional()
  @IsString()
  intakeNote?: string;
}

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Buffer kiểm tra sau mỗi lượt trả, tính bằng phút (BR-12)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;
}

export class CreateModelDto {
  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: 'Giá tham chiếu, dùng để tính ngưỡng cấp duyệt (BR-22)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  referencePrice?: number;

  @ApiPropertyOptional({ type: [String], description: 'Phụ kiện đi kèm, dùng khi bàn giao và khi trả' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accessories?: string[];
}

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

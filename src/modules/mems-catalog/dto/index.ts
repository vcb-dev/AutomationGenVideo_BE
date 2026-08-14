import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

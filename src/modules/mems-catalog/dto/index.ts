import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { EmptyStringToNull, EmptyStringToUndefined } from '../../../utils/mems/dto-transforms.util';

const ASSET_STATUSES = [
  'PENDING_INSPECTION',
  'AVAILABLE',
  'ON_LOAN',
  'POST_RETURN_CHECK',
  'UNDER_MAINTENANCE',
  'BROKEN',
  'LOST',
  'DISPOSED',
];

/**
 * Tham số lọc của màn Danh sách kho.
 *
 * Trước đây controller nhận từng `@Query('...')` rời rồi ép `as any` xuống Prisma, nên một giá
 * trị lạ không bị chặn ở tầng nào cả: Prisma ném lỗi, bộ lọc toàn cục xếp vào 500 và trả nguyên
 * thông điệp của Prisma về client. Gom thành DTO để `ValidationPipe` toàn cục chặn từ đầu và
 * trả đúng 400 kèm câu nói rõ giá trị nào hợp lệ.
 */
export class ListAssetsQueryDto {
  @ApiPropertyOptional({ enum: ASSET_STATUSES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class ListModelsQueryDto {
  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateAssetDto {
  @ApiProperty()
  @IsUUID()
  modelId: string;

  @ApiPropertyOptional({
    description: 'Số serial máy. Bắt buộc nếu không cung cấp danh sách serialNumbers',
  })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    description: 'Danh sách các số serial khi nhập nhiều máy cùng lúc',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @ApiPropertyOptional({
    description: 'Số lượng thiết bị nhập kho (mặc định 1)',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

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
  @EmptyStringToNull()
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

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

export class UpdateAssetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

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
  @EmptyStringToNull()
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({
    enum: ['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'],
    description: 'Tình trạng vật lý thiết bị',
  })
  @IsOptional()
  @IsIn(['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'])
  condition?: string;

  @ApiPropertyOptional({
    enum: ASSET_STATUSES,
    description: 'Trạng thái hoạt động trong kho',
  })
  @IsOptional()
  @IsIn(ASSET_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Ghi chú cập nhật' })
  @IsOptional()
  @IsString()
  note?: string;
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
  @EmptyStringToNull()
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

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

export class CreateLocationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @EmptyStringToNull()
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateLocationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @EmptyStringToNull()
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

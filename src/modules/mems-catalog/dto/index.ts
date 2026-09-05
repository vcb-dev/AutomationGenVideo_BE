import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
 * Ô lọc để trống gửi lên chuỗi rỗng, không phải vắng mặt.
 *
 * Giao diện gửi `?status=&categoryId=` khi người dùng chọn lại "Mọi trạng thái". Nếu để chuỗi
 * rỗng rơi vào `@IsIn`/`@IsUUID` thì bấm bỏ lọc là ăn 400.
 */
const EmptyStringToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

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
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    enum: ['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'],
    description: 'Tình trạng vật lý thiết bị',
  })
  @IsOptional()
  @IsIn(['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'])
  condition?: string;

  @ApiPropertyOptional({
    enum: ['AVAILABLE', 'IN_USE', 'PENDING_INSPECTION', 'UNDER_MAINTENANCE', 'BROKEN', 'LOST', 'DISPOSED'],
    description: 'Trạng thái hoạt động trong kho',
  })
  @IsOptional()
  @IsIn(['AVAILABLE', 'IN_USE', 'PENDING_INSPECTION', 'UNDER_MAINTENANCE', 'BROKEN', 'LOST', 'DISPOSED'])
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

export class CreateLocationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateLocationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

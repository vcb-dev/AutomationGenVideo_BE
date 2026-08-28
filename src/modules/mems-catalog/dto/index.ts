import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { MANUAL_ASSET_STATUSES } from '../asset-status-rules';

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

/** Giá trị hợp lệ của `MemsAssetCondition` trong schema — lệch một chữ là Prisma ném lúc chạy. */
const ASSET_CONDITIONS = ['GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE'];

/**
 * Trạng thái đặt tay được. Cố ý HẸP hơn `MemsAssetStatus` — bốn giá trị còn lại đều có cửa
 * riêng (kiểm tra, bàn giao, nhận trả, nút xoá), xem `asset-status-rules.ts`.
 *
 * Vẫn phải kiểm lại ở tầng service: DTO không biết máy đang ở trạng thái nào nên không ra được
 * luật "máy đang mượn thì chỉ đánh dấu Mất".
 */
const MANUAL_STATUSES = [...MANUAL_ASSET_STATUSES];

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

  @ApiPropertyOptional({
    description: 'Chuỗi rỗng nghĩa là gỡ máy khỏi vị trí; bỏ trống hẳn thì giữ nguyên chỗ cũ',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ enum: ASSET_CONDITIONS, description: 'Tình trạng vật lý thiết bị' })
  @IsOptional()
  @IsIn(ASSET_CONDITIONS)
  condition?: string;

  @ApiPropertyOptional({
    enum: MANUAL_STATUSES,
    description:
      'Chỉ ba trạng thái này đặt tay được. Sẵn sàng qua màn Kiểm tra, Đang mượn qua màn Bàn giao, ' +
      'Bảo trì qua màn Kiểm tra, Đã thanh lý qua nút Xoá.',
  })
  @IsOptional()
  @IsIn(MANUAL_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Ghi chú, vào thẳng nhật ký vòng đời' })
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

export class CreateLocationDto {
  @ApiProperty({ description: 'Tên vị trí: Kệ A-02, Tủ D-01, Xưởng sửa…' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Nằm trong vị trí nào; bỏ trống là vị trí gốc' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateLocationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Bỏ trống hẳn thì giữ nguyên vị trí cha cũ; chuỗi rỗng là đưa về gốc',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
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

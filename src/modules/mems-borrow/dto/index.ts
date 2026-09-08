import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
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
  @ApiPropertyOptional({
    description:
      'Bỏ trống thì server tự suy từ người đăng nhập. Client không nên tự khai mình thuộc ' +
      'bộ phận nào — khai sai là quy trách nhiệm sai người.',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ description: 'Dự án hoặc mục đích sử dụng — BR-19 bắt buộc' })
  @IsString()
  @IsNotEmpty() // BR-19: chuỗi rỗng cũng là để trống, không được lọt
  project: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  place: string;

  @ApiPropertyOptional({
    enum: ['WORK', 'PERSONAL'],
    default: 'WORK',
    description:
      'PERSONAL là mượn phục vụ việc riêng — phiếu sẽ cần hai chữ ký: leader rồi admin. ' +
      'Bỏ trống thì coi là việc của công ty.',
  })
  @IsOptional()
  @IsIn(['WORK', 'PERSONAL'])
  purpose?: 'WORK' | 'PERSONAL';

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

/** Toàn bộ giá trị của enum `MemsRequestStatus`. */
const REQUEST_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PREPARING',
  'ON_LOAN',
  'PARTIALLY_RETURNED',
  'CLOSED',
  'CANCELLED',
];

/** Ô lọc để trống gửi lên chuỗi rỗng — coi như không lọc, đừng ném 400 vào mặt người bấm bỏ lọc. */
const EmptyStringToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

/**
 * Lọc danh sách phiếu. Nhận một hoặc nhiều trạng thái ngăn bằng dấu phẩy — màn Nhận trả gọi kèm
 * `ON_LOAN,PARTIALLY_RETURNED`, màn Bàn giao gọi `APPROVED` rồi `PREPARING`.
 *
 * Trước đây chuỗi này đi thẳng xuống Prisma với `as any`: một giá trị lạ cho ra 500 kèm nguyên
 * thông điệp của Prisma thay vì 400 nói rõ giá trị nào hợp lệ.
 */
export class ListRequestsQueryDto {
  @ApiPropertyOptional({
    description: `Một hoặc nhiều trạng thái ngăn bằng dấu phẩy. Hợp lệ: ${REQUEST_STATUSES.join(', ')}`,
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(
    new RegExp(`^\\s*(${REQUEST_STATUSES.join('|')})(\\s*,\\s*(${REQUEST_STATUSES.join('|')}))*\\s*$`),
    { message: `status phải là các giá trị sau, ngăn bằng dấu phẩy: ${REQUEST_STATUSES.join(', ')}` },
  )
  status?: string;
}

/**
 * Lọc nhật ký mượn của cả kho.
 *
 * `status` ở đây là trạng thái của MỘT LƯỢT MƯỢN (tính ra từ ba mốc thời gian), không phải trạng
 * thái của phiếu — gửi nhầm `PENDING_APPROVAL` sang đây thì bảng trả về rỗng một cách khó hiểu.
 */
export class BorrowHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['HOLDING', 'OVERDUE', 'RETURNED'] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['HOLDING', 'OVERDUE', 'RETURNED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Ngày bắt đầu khoảng lọc, dạng ISO' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Ngày kết thúc khoảng lọc, dạng ISO' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
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

export class ApproveRequestDto {
  @ApiPropertyOptional({ description: 'Ghi chú của người duyệt, không bắt buộc' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectRequestDto {
  @ApiProperty({ description: 'BR-20: từ chối bắt buộc nêu lý do' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AssignLineDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ type: [String], description: 'Đúng bằng quantity của dòng' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  assetIds: string[];
}

export class AssignSerialsDto {
  @ApiProperty({ type: [AssignLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignLineDto)
  lines: AssignLineDto[];
}

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

  @ApiProperty({ type: [String], description: 'BR-26: tối thiểu một ảnh' })
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

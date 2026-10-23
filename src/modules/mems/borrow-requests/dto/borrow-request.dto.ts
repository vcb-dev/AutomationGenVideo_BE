import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../../../utils/mems/dto-transforms.util';

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

  @ApiPropertyOptional({ description: 'Ghi chú của người mượn' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ type: [String], description: 'ID ảnh đã tải qua POST /mems/request-photos, tối đa 5' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  photoIds?: string[];
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

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { EmptyStringToUndefined } from '../../../../utils/mems/dto-transforms.util';

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

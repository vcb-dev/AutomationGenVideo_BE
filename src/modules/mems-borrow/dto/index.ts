import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import { EmptyStringToUndefined } from '../../../utils/mems/dto-transforms.util';
import { AccessoryCheckDto } from '../../mems/handover/dto/handover.dto';

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

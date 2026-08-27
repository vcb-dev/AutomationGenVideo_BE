import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Khoảng thời gian cho biểu đồ xu hướng + badge % thay đổi so với kỳ trước ở tab Thống kê.
 *  'custom' đi kèm `from`/`to` (ngày do người dùng tự chọn) thay vì 1 trong 3 mốc cố định. */
export type TeamSummaryRange = '7d' | '30d' | '90d' | 'custom';

export class ContentTransformTeamSummaryQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'custom'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d', 'custom'])
  range?: TeamSummaryRange = '30d';

  // Bắt buộc khi range=custom (ValidateIf) — dạng YYYY-MM-DD, cùng chuỗi FE gửi lên từ DatePicker.
  @ApiPropertyOptional({ description: 'Ngày bắt đầu (YYYY-MM-DD) — bắt buộc khi range=custom' })
  @ValidateIf((o) => o.range === 'custom')
  @IsDateString({}, { message: 'from phải là ngày hợp lệ dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Ngày kết thúc (YYYY-MM-DD) — bắt buộc khi range=custom' })
  @ValidateIf((o) => o.range === 'custom')
  @IsDateString({}, { message: 'to phải là ngày hợp lệ dạng YYYY-MM-DD' })
  to?: string;
}

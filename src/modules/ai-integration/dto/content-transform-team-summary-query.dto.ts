import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Khoảng thời gian cho biểu đồ xu hướng + badge % thay đổi so với kỳ trước ở tab Thống kê. */
export type TeamSummaryRange = '7d' | '30d' | '90d';

export class ContentTransformTeamSummaryQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  range?: TeamSummaryRange = '30d';
}

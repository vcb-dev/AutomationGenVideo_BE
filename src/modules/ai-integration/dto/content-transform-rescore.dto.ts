import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RescoreDto {
  @ApiProperty({ description: 'ID bản ghi lịch sử cần chấm điểm lại' })
  @IsString()
  @IsNotEmpty()
  history_id: string;
}

import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeContentDto {
  @ApiProperty({
    example: 'Nhiều người nghĩ vào nghề kim hoàn là làm ra những món đồ đẹp...',
    description: 'Kịch bản content cần phân tích theo khung PAAST (tối thiểu 100 ký tự, không giới hạn tối đa)',
  })
  @IsString()
  @MinLength(100, { message: 'Content quá ngắn — cần ít nhất 100 ký tự' })
  content: string;
}

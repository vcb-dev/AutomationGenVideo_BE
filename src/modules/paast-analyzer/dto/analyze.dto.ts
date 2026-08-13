import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeContentDto {
  @ApiProperty({
    example: 'Nhiều người nghĩ vào nghề kim hoàn là làm ra những món đồ đẹp...',
    description: 'Kịch bản content cần phân tích theo khung PAAST (100-3000 ký tự)',
  })
  @IsString()
  @MinLength(100, { message: 'Content quá ngắn — cần ít nhất 100 ký tự' })
  @MaxLength(3000, { message: 'Content quá dài — tối đa 3000 ký tự' })
  content: string;
}

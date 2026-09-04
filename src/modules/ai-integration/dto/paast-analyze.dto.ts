import { IsString, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyzeContentDto {
  @ApiPropertyOptional({
    example: 'Nhiều người nghĩ vào nghề kim hoàn là làm ra những món đồ đẹp...',
    description: 'Kịch bản cần chấm PAAST (≥100 ký tự). Bắt buộc khi không có fileUrl.',
  })
  @ValidateIf((o) => !o.fileUrl)
  @IsString()
  @MinLength(100, { message: 'Content quá ngắn — cần ít nhất 100 ký tự' })
  content?: string;

  @ApiPropertyOptional({
    example: 'https://docs.google.com/document/d/1AbC.../edit',
    description: 'Link Google Docs/Drive (.docx, PDF, text) chứa nội dung — thay cho `content`. Server tự trích text.',
  })
  @ValidateIf((o) => !o.content)
  @IsString()
  @MinLength(10, { message: 'fileUrl không hợp lệ' })
  fileUrl?: string;
}

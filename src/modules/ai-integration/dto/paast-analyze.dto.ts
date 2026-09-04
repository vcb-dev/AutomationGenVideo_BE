import { IsString, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyzeContentDto {
  @ApiPropertyOptional({
    example: 'Nhiều người nghĩ vào nghề kim hoàn là làm ra những món đồ đẹp...',
    description:
      'Kịch bản content cần phân tích theo khung PAAST (tối thiểu 100 ký tự, không giới hạn tối đa). ' +
      'Bắt buộc khi không truyền fileUrl.',
  })
  @ValidateIf((o) => !o.fileUrl)
  @IsString()
  @MinLength(100, { message: 'Content quá ngắn — cần ít nhất 100 ký tự' })
  content?: string;

  @ApiPropertyOptional({
    example: 'https://docs.google.com/document/d/1AbC.../edit',
    description:
      'Link Google Docs / Google Drive (Word .docx, PDF, text) chứa nội dung — dùng thay cho `content` khi ' +
      'nội dung quá dài nên được đính kèm dưới dạng file. Server tự trích text rồi chấm điểm như bình thường.',
  })
  @ValidateIf((o) => !o.content)
  @IsString()
  @MinLength(10, { message: 'fileUrl không hợp lệ' })
  fileUrl?: string;
}

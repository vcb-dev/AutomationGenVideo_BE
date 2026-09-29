import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** PATCH /product-image/generations/:id — bấm/bỏ "Đạt" cho một ảnh Gemini đã tạo. */
export class UpdateGenerationDto {
  @ApiProperty({ description: 'true = ảnh dùng được làm content ("Đạt"), false = bỏ đánh dấu' })
  @IsBoolean()
  approved: boolean;
}

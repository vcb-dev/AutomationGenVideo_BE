import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Khớp product_image_service.HELD_PRODUCT_NOTE_MAX_CHARS bên AI service. */
export const HELD_PRODUCT_NOTE_MAX_LENGTH = 500;

/** Phần chữ của form multipart POST /product-image/held-product (2 ảnh đi ở phần file). */
export class HeldProductDto {
  @ApiPropertyOptional({
    maxLength: HELD_PRODUCT_NOTE_MAX_LENGTH,
    description:
      'Ghi chú thêm cho AI, vd kích thước thật của SP ("hộp cao khoảng 30cm") — lỗi sai kích ' +
      'thước SP trên tay là lỗi hay gặp nhất của chế độ này.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(HELD_PRODUCT_NOTE_MAX_LENGTH)
  note?: string;
}

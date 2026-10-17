import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Khớp product_image_service.HELD_PRODUCT_NOTE_MAX_CHARS bên AI service. */
export const HELD_PRODUCT_NOTE_MAX_LENGTH = 500;

/** Khớp cột product_image_generations.product_name VARCHAR(200). */
export const PRODUCT_NAME_MAX_LENGTH = 200;

/** Phần chữ của form multipart POST /product-image/held-product (2 ảnh đi ở phần file). */
export class HeldProductDto {
  @ApiProperty({
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    description:
      'Tên/mã sản phẩm mới — bắt buộc, để tab Chi phí đếm được số lượt tạo và chi phí cho 1 ảnh ' +
      'đạt của TỪNG sản phẩm.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Nhập tên sản phẩm — dùng để thống kê chi phí theo từng sản phẩm' })
  @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: `Tên sản phẩm tối đa ${PRODUCT_NAME_MAX_LENGTH} ký tự` })
  productName: string;

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

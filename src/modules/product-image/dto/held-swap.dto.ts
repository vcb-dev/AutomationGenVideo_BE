import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PRODUCT_NAME_MAX_LENGTH } from './held-product.dto';

/**
 * Phần chữ của form multipart POST /product-image/held-swap (ảnh chị Nhạm + ảnh SP mới đi ở phần file). Không có
 * ghi chú cho AI như chế độ Gemini — đổi SP 0đ đặt SP mới theo cỡ thân SP cũ, không đọc chữ.
 */
export class HeldSwapDto {
  @ApiProperty({
    maxLength: PRODUCT_NAME_MAX_LENGTH,
    description: 'Tên/mã sản phẩm mới — bắt buộc như chế độ Gemini, để tab Chi phí đếm lượt theo từng sản phẩm.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Nhập tên sản phẩm — dùng để thống kê theo từng sản phẩm' })
  @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: `Tên sản phẩm tối đa ${PRODUCT_NAME_MAX_LENGTH} ký tự` })
  productName: string;
}

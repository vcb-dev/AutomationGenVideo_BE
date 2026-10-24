import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { HeldSwapDto } from './held-swap.dto';

/** Bề ngang thật thân túi (cm) người dùng nhập — ngoài khoảng này coi là gõ nhầm (khớp SIZE_CM_RANGE bên FE, AI kiểm lại). */
export const HELD_WIDTH_CM_MIN = 6;
export const HELD_WIDTH_CM_MAX = 60;

/**
 * Phần chữ của form multipart POST /product-image/held-auto (ảnh SP mới đi ở phần file `productImage`): tên SP (bắt
 * buộc, để tab Chi phí đếm lượt theo sản phẩm) + bề ngang thật của túi (bắt buộc — người dùng 15/10: "kích thước túi cần
 * nhập mới biết được") để AI ghép túi đúng cỡ so với bàn tay chị Nhạm.
 */
export class HeldAutoDto extends HeldSwapDto {
  @ApiProperty({
    minimum: HELD_WIDTH_CM_MIN,
    maximum: HELD_WIDTH_CM_MAX,
    description: 'Bề ngang thật thân túi (cm) — túi ghép đúng cỡ so với bàn tay chị Nhạm.',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Nhập bề ngang túi (cm) — cần để ghép túi đúng cỡ vào tay chị Nhạm' })
  @Min(HELD_WIDTH_CM_MIN, { message: `Bề ngang túi tối thiểu ${HELD_WIDTH_CM_MIN}cm` })
  @Max(HELD_WIDTH_CM_MAX, { message: `Bề ngang túi tối đa ${HELD_WIDTH_CM_MAX}cm` })
  widthCm: number;
}

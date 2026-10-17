import { HeldProductDto } from './held-product.dto';

/**
 * Phần chữ của form multipart POST /product-image/scene-placement (ảnh SP + ảnh cảnh đi ở phần
 * file). Cùng hai field với chị Nhạm cầm SP: tên SP bắt buộc để tab Chi phí đếm theo từng SP, ghi
 * chú cho AI không bắt buộc.
 */
export class ScenePlacementDto extends HeldProductDto {}

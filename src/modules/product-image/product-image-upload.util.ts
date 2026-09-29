import { HttpException, HttpStatus } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** 10MB mỗi ảnh — cùng mốc ảnh thẻ, nằm gọn trong giới hạn gửi ảnh inline của Gemini. Bản sao
 * ở FE: src/lib/product-image/upload-validation.ts#PRODUCT_IMAGE_MAX_BYTES. */
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Ảnh NCC/catalog hay là WebP (tải từ web) nên nhận thêm WebP so với ảnh thẻ. AI service kiểm
 * lại đúng danh sách này (product_image_service.ALLOWED_INPUT_MIME_TYPES). */
export const PRODUCT_IMAGE_MIME_PATTERN = /^image\/(jpeg|jpg|png|webp)$/;

export function isAllowedProductImageMime(mimeType: string | undefined): boolean {
  return PRODUCT_IMAGE_MIME_PATTERN.test(mimeType ?? '');
}

/**
 * Tuỳ chọn multer dùng chung cho mọi endpoint nhận ảnh của module. MemoryStorage (không truyền
 * `storage`) — ảnh chỉ đi qua BE để chuyển sang AI service rồi bỏ, không ghi đĩa.
 */
export function productImageUploadOptions(maxFiles: number): MulterOptions {
  return {
    limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES, files: maxFiles },
    fileFilter: (_req, file, cb) => {
      if (isAllowedProductImageMime(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new HttpException(
            `Chỉ nhận ảnh JPG, PNG hoặc WebP. Nhận được: ${file.mimetype}`,
            HttpStatus.BAD_REQUEST,
          ),
          false,
        );
      }
    },
  };
}

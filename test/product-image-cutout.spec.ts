/**
 * Tạo ảnh sản phẩm — chế độ "Ghép background" (0đ): BE nhận ảnh SP, chuyển sang AI service
 * (rembg tách nền) và trả PNG nền trong suốt cho FE tự dán lên ảnh phòng.
 *
 * Khoá: đúng endpoint AI + body base64 + timeout riêng của lượt tách nền, token ký theo ĐÚNG
 * người bấm, bộ lọc file (JPG/PNG/WebP), chỉ cần đăng nhập (không @Roles), timeout đổi thành
 * 504 có thông báo, thiếu AI_SERVICE_URL thì báo đúng tên biến.
 */
import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { of, throwError } from 'rxjs';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import {
  isAllowedProductImageMime,
  productImageUploadOptions,
  PRODUCT_IMAGE_MAX_BYTES,
} from '../src/modules/product-image/product-image-upload.util';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';

const USER = { id: 'user-1', email: 'media@vcb.test' };

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    mimetype: 'image/webp',
    originalname: 'sp.webp',
    size: 16,
    ...overrides,
  } as Express.Multer.File;
}

function makeService(post: jest.Mock, env: Record<string, string | undefined> = { AI_SERVICE_URL: 'http://ai:8000/' }) {
  const configService: any = { get: jest.fn((key: string) => env[key]) };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-1') };
  const service = new ProductImageService({ post } as any, configService, jwtService, generations);
  return { service, jwtService, generations };
}

describe('Tạo ảnh sản phẩm — tách nền (ghép background)', () => {
  it('gọi đúng endpoint AI, gửi ảnh base64 + mime, timeout tách nền, token của người bấm', async () => {
    const post = jest.fn(() =>
      of({ data: { success: true, cutout_image_base64: 'UE5H', width: 320, height: 480 } }),
    );
    const { service, jwtService } = makeService(post);

    const result = await service.cutout(makeFile(), USER);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/cutout/');
    expect(body).toEqual({
      image_base64: Buffer.from('fake-image-bytes').toString('base64'),
      mime_type: 'image/webp',
    });
    expect(config.timeout).toBe(ProductImageService.CUTOUT_TIMEOUT_MS);
    expect(config.headers.Authorization).toBe('Bearer signed.jwt');
    expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'media@vcb.test' });
    expect(result).toEqual({ imageData: 'data:image/png;base64,UE5H', width: 320, height: 480 });
  });

  it('AI báo success=false thì trả 502 kèm đúng lời AI', async () => {
    const post = jest.fn(() =>
      of({ data: { success: false, error_message: 'Không tìm thấy sản phẩm trong ảnh' } }),
    );
    const { service } = makeService(post);

    await expect(service.cutout(makeFile(), USER)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      message: 'Không tìm thấy sản phẩm trong ảnh',
    });
  });

  it('AI trả 400 thì giữ 400 và lời AI (vd ảnh không đọc được)', async () => {
    const post = jest.fn(() =>
      throwError(() => ({ response: { status: 400, data: { error_message: 'Ảnh sản phẩm không phải file ảnh đọc được.' } } })),
    );
    const { service } = makeService(post);

    await expect(service.cutout(makeFile(), USER)).rejects.toMatchObject({
      status: 400,
      message: 'Ảnh sản phẩm không phải file ảnh đọc được.',
    });
  });

  it('quá timeout thì trả 504 nêu số giây', async () => {
    const post = jest.fn(() =>
      throwError(() => ({ code: 'ECONNABORTED', message: 'timeout of 120000ms exceeded' })),
    );
    const { service } = makeService(post);

    const error: HttpException = await service.cutout(makeFile(), USER).catch((e) => e);
    expect(error.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(error.message).toContain('120s');
  });

  it('thiếu AI_SERVICE_URL thì báo lỗi nêu tên biến, không gọi AI', async () => {
    const post = jest.fn();
    const { service } = makeService(post, {});

    const error = await service.cutout(makeFile(), USER).catch((e) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toContain('AI_SERVICE_URL');
    expect(post).not.toHaveBeenCalled();
  });

  it('controller báo thiếu file khi không gửi ảnh', async () => {
    const controller = new ProductImageController({ cutout: jest.fn() } as any, {} as any);
    await expect(controller.cutout(undefined, { user: USER })).rejects.toMatchObject({ status: 400 });
  });

  describe('bộ lọc file tải lên', () => {
    it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])('nhận %s', (mime) => {
      expect(isAllowedProductImageMime(mime)).toBe(true);
    });

    it.each(['image/gif', 'image/svg+xml', 'application/pdf', undefined])('từ chối %s', (mime) => {
      expect(isAllowedProductImageMime(mime)).toBe(false);
    });

    it('multer chặn 10MB mỗi file, đúng số file và báo lỗi 400 khi sai định dạng', () => {
      const options = productImageUploadOptions(1);
      expect(options.limits).toEqual({ fileSize: PRODUCT_IMAGE_MAX_BYTES, files: 1 });
      expect(PRODUCT_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);

      const cb = jest.fn();
      options.fileFilter!({} as any, makeFile({ mimetype: 'image/gif' }), cb);
      const [error, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(error.getStatus()).toBe(400);
    });
  });

  it('chỉ cần đăng nhập: có JwtAuthGuard, không giới hạn vai trò', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ProductImageController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ProductImageController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, ProductImageController.prototype.cutout)).toBeUndefined();
  });
});

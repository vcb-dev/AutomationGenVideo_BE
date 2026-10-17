/**
 * Tạo ảnh sản phẩm — chế độ "Ghép background" (0đ): BE nhận ảnh SP, chuyển sang AI service
 * (rembg tách nền) và trả PNG nền trong suốt cho FE tự dán lên ảnh phòng.
 *
 * Khoá: đúng endpoint AI + body base64 + timeout riêng của lượt tách nền, token ký theo ĐÚNG
 * người bấm, bộ lọc file (JPG/PNG/WebP), chỉ cần đăng nhập (không @Roles), timeout đổi thành
 * 504 có thông báo, thiếu AI_SERVICE_URL thì báo đúng tên biến, kết nối keep-alive bị AI đóng ngang
 * ("socket hang up") thì tự thử lại đúng một lần (tách nền 0đ) còn lỗi khác thì không.
 */
import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { of, throwError } from 'rxjs';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageService, isConnectionReset } from '../src/modules/product-image/product-image.service';
import { formFields } from './helpers/ai-form-fields';
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
  it('gọi đúng endpoint AI, gửi ảnh dạng file multipart + mime, timeout tách nền, token của người bấm', async () => {
    const post = jest.fn(() =>
      of({ data: { success: true, cutout_image_base64: 'UE5H', width: 320, height: 480 } }),
    );
    const { service, jwtService } = makeService(post);

    const result = await service.cutout(makeFile(), USER);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/cutout/');
    // Ảnh đi dạng FILE, không base64 trong JSON — Django chặn body chữ quá 2,5MB (RequestDataTooBig).
    expect(formFields(body)).toEqual({
      image: { file: 'fake-image-bytes', contentType: 'image/webp' },
      mime_type: 'image/webp',
    });
    expect(config.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(config.timeout).toBe(ProductImageService.CUTOUT_TIMEOUT_MS);
    expect(config.headers.Authorization).toBe('Bearer signed.jwt');
    expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1', email: 'media@vcb.test' });
    // Không có tỷ giá trong env test → chưa quy ra VNĐ, kèm lý do; AI không báo usage → chưa biết tiền.
    expect(result).toMatchObject({ imageData: 'data:image/png;base64,UE5H', width: 320, height: 480, detection: null });
    expect(result.cost.usd).toBeNull();
  });

  it('chuyển nguyên kết quả nhận diện SP của AI cho FE (đã lọc / chưa lọc kèm lý do)', async () => {
    const skipped = { status: 'skipped', reason: 'Gemini đã hết hạn mức nhận diện ảnh trong ngày (20 lượt/ngày)' };
    const post = jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1, detection: skipped } }));
    const result = await makeService(post).service.cutout(makeFile(), USER);
    expect(result.detection).toEqual(skipped);
    expect(result.bodyBox).toBeNull();
  });

  it('chuyển khung thân túi AI trả về cho FE (để mọi túi cùng cỡ thân, đáy thân đứng đúng mặt hộp)', async () => {
    const post = jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 400, height: 600, body_box: [10, 250, 390, 600] } }));
    const result = await makeService(post).service.cutout(makeFile(), USER);
    expect(result.bodyBox).toEqual([10, 250, 390, 600]);
  });

  it('chuyển câu báo ảnh gốc không đủ làm ảnh thương mại cho FE; AI bản cũ không trả thì là mảng rỗng', async () => {
    const warning = 'Ảnh gốc cắt mất một phần sản phẩm ở mép phải — ảnh ghép sẽ thấy túi bị cụt, dùng ảnh chụp đủ cả túi.';
    const post = jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1, quality_warnings: [warning, 42] } }));
    expect((await makeService(post).service.cutout(makeFile(), USER)).qualityWarnings).toEqual([warning]);
    const old = jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1 } }));
    expect((await makeService(old).service.cutout(makeFile(), USER)).qualityWarnings).toEqual([]);
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

describe('Tạo ảnh sản phẩm — tách nền: kết nối tới AI bị đóng ngang', () => {
  const hangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

  it('thử lại đúng một lần rồi trả ảnh bình thường', async () => {
    let calls = 0;
    const post = jest.fn(() => (++calls === 1
      ? throwError(hangUp)
      : of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1 } })));
    const { service } = makeService(post);
    const result = await service.cutout(makeFile(), USER);
    expect(post).toHaveBeenCalledTimes(2);
    expect(result.imageData).toBe('data:image/png;base64,UE5H');
  });

  it('đứt lần nữa thì báo lỗi kết nối, không thử mãi', async () => {
    const post = jest.fn(() => throwError(hangUp));
    const { service } = makeService(post);
    await expect(service.cutout(makeFile(), USER)).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('lỗi AI có phản hồi (vd 400 ảnh hỏng) không thử lại', async () => {
    const post = jest.fn(() => throwError(() => ({ response: { status: 400, data: { error_message: 'Ảnh hỏng' } } })));
    const { service } = makeService(post);
    await expect(service.cutout(makeFile(), USER)).rejects.toMatchObject({ status: 400 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('chỉ nhận đúng lỗi đóng kết nối trước khi có phản hồi', () => {
    expect(isConnectionReset(hangUp())).toBe(true);
    expect(isConnectionReset({ message: 'socket hang up' })).toBe(true);
    expect(isConnectionReset({ code: 'ECONNRESET', response: { status: 502 } })).toBe(false);
    expect(isConnectionReset({ code: 'ECONNABORTED', message: 'timeout of 120000ms exceeded' })).toBe(false);
  });
});

/**
 * Tạo ảnh sản phẩm — chế độ "Chị Nhạm cầm SP" (tính phí Gemini mỗi lượt): BE nhận 2 ảnh (chị
 * Nhạm đang cầm SP cũ + SP mới) và ghi chú, chuyển sang AI service để Gemini thay SP.
 *
 * Khoá: đúng tên field 2 ảnh gửi AI (thứ tự person → product là contract với prompt), ghi chú
 * trống thì không gửi, mime ảnh trả về lấy từ AI (không cố định PNG), thiếu ảnh thì 400 trước khi
 * tốn lượt Gemini, 401/403/404 từ AI đổi thành 502 để FE không hiểu nhầm là mất đăng nhập/sai
 * route, và ghi chú bị chặn 500 ký tự ở DTO.
 */
import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageService, toAiHttpException } from '../src/modules/product-image/product-image.service';
import { HeldProductDto, HELD_PRODUCT_NOTE_MAX_LENGTH } from '../src/modules/product-image/dto/held-product.dto';

const USER = { id: 'user-2', email: 'content@vcb.test' };

function makeFile(content: string, mimetype: string): Express.Multer.File {
  return { buffer: Buffer.from(content), mimetype, originalname: 'x', size: content.length } as Express.Multer.File;
}

function makeService(post: jest.Mock) {
  const configService: any = { get: jest.fn((key: string) => (key === 'AI_SERVICE_URL' ? 'http://ai:8000' : undefined)) };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-1') };
  return new ProductImageService({ post } as any, configService, jwtService, generations);
}

const PERSON = makeFile('person-bytes', 'image/jpeg');
const PRODUCT = makeFile('product-bytes', 'image/png');

describe('Tạo ảnh sản phẩm — chị Nhạm cầm sản phẩm (Gemini)', () => {
  it('gửi đủ 2 ảnh + ghi chú đã cắt khoảng trắng, trả data URI theo mime AI trả về', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'SlBH', mime_type: 'image/jpeg' } }));
    const service = makeService(post);

    const result = await service.heldProduct(PERSON, PRODUCT, { note: '  hộp cao 30cm ', productName: 'Nhẫn Kim Vũ' }, USER);

    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/held-product/');
    expect(body).toEqual({
      person_image_base64: Buffer.from('person-bytes').toString('base64'),
      person_mime_type: 'image/jpeg',
      product_image_base64: Buffer.from('product-bytes').toString('base64'),
      product_mime_type: 'image/png',
      note: 'hộp cao 30cm',
    });
    expect(config.timeout).toBe(ProductImageService.HELD_PRODUCT_TIMEOUT_MS);
    expect(config.headers.Authorization).toBe('Bearer signed.jwt');
    expect(result).toMatchObject({ imageData: 'data:image/jpeg;base64,SlBH', mimeType: 'image/jpeg' });
  });

  it('ghi chú rỗng thì không gửi trường note', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'UE5H', mime_type: 'image/png' } }));
    await makeService(post).heldProduct(PERSON, PRODUCT, { note: '   ', productName: 'Nhẫn Kim Vũ' }, USER);
    expect((post.mock.calls[0] as any[])[1].note).toBeUndefined();
  });

  it('thiếu ảnh nào thì 400 nêu đúng ảnh đó, không gọi AI (không tốn lượt Gemini)', async () => {
    const post = jest.fn();
    const service = makeService(post);

    await expect(service.heldProduct(undefined, PRODUCT, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('chị Nhạm'),
    });
    await expect(service.heldProduct(PERSON, undefined, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('sản phẩm mới'),
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('AI trả thiếu mime_type thì 502, không tự gán PNG', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'UE5H' } }));
    await expect(makeService(post).heldProduct(PERSON, PRODUCT, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('lỗi Gemini từ AI (vd hết quota 503) giữ nguyên mã và lời AI', async () => {
    const post = jest.fn(() =>
      throwError(() => ({ response: { status: 503, data: { error_message: 'Gemini đã hết hạn mức (quota).' } } })),
    );
    await expect(makeService(post).heldProduct(PERSON, PRODUCT, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({
      status: 503,
      message: 'Gemini đã hết hạn mức (quota).',
    });
  });

  it('controller lấy đúng file đầu tiên của từng field và chuyển ghi chú', async () => {
    const heldProduct = jest.fn().mockResolvedValue({ imageData: 'x', mimeType: 'image/png' });
    const controller = new ProductImageController({ heldProduct } as any, {} as any);

    await controller.heldProduct(
      { personImage: [PERSON], productImage: [PRODUCT] },
      { note: 'n', productName: 'Nhẫn Kim Vũ' },
      { user: USER },
    );

    expect(heldProduct).toHaveBeenCalledWith(PERSON, PRODUCT, { note: 'n', productName: 'Nhẫn Kim Vũ' }, USER);
  });

  describe('đổi lỗi AI service cho FE', () => {
    it.each([401, 403])('AI trả %s → 502 (lỗi cấu hình JWT_SECRET, không phải mất đăng nhập)', (status) => {
      const error = toAiHttpException({ response: { status, data: { detail: 'Authentication credentials were not provided.' } } }, 90_000);
      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.message).toContain('JWT_SECRET');
    });

    it('AI trả 404 → 502 báo AI service chưa deploy bản mới', () => {
      const error = toAiHttpException({ response: { status: 404, data: '<html>Not Found</html>' } }, 90_000);
      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.message).toContain('deploy');
    });

    it('không kết nối được → 502', () => {
      const error = toAiHttpException({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8000' }, 90_000);
      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.message).toContain('ECONNREFUSED');
    });
  });

  describe('HeldProductDto', () => {
    it(`nhận ghi chú tới ${HELD_PRODUCT_NOTE_MAX_LENGTH} ký tự và cho phép bỏ trống`, async () => {
      expect(await validate(plainToInstance(HeldProductDto, { productName: 'Nhẫn', note: 'a'.repeat(HELD_PRODUCT_NOTE_MAX_LENGTH) }))).toHaveLength(0);
      expect(await validate(plainToInstance(HeldProductDto, { productName: 'Nhẫn' }))).toHaveLength(0);
    });

    it('từ chối ghi chú dài quá giới hạn', async () => {
      const errors = await validate(plainToInstance(HeldProductDto, { productName: 'Nhẫn', note: 'a'.repeat(HELD_PRODUCT_NOTE_MAX_LENGTH + 1) }));
      expect(errors[0]?.constraints).toHaveProperty('maxLength');
    });
  });
});

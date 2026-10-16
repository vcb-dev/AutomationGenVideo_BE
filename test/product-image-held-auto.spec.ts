/**
 * Tạo ảnh sản phẩm — tab "Chị Nhạm cầm SP", chế độ TỰ CHỌN TƯ THẾ 0đ (held-auto): người dùng chỉ gửi ảnh SP mới, AI
 * service chọn các tư thế chị Nhạm hợp với dáng SP trong thư viện tư thế dựng sẵn rồi ghép, trả vài ảnh để chọn.
 *
 * Khoá: gửi đúng endpoint + ảnh dạng file multipart, thiếu ảnh / tên SP thì 400 trước khi gọi AI, mỗi lượt ghi ĐÚNG MỘT
 * dòng HELD_SWAP 0đ (dù trả nhiều ảnh), AI trả rỗng / thiếu ảnh thì 502 và vẫn ghi lượt hỏng, kết nối bị đóng ngang thì
 * tự gửi lại một lần, trả ảnh theo đúng thứ tự tư thế hợp nhất của AI. Bề ngang thật của túi (cm) bắt buộc, gửi sang AI để
 * ghép túi đúng cỡ so với bàn tay chị Nhạm (người dùng 15/10).
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import { formFields } from './helpers/ai-form-fields';
import { HeldAutoDto } from '../src/modules/product-image/dto/held-auto.dto';
import { PRODUCT_IMAGE_MODE } from '../src/modules/product-image/product-image-cost.util';

const USER = { id: 'user-7', email: 'media@vcb.test' };
const FREE_USAGE = { model: 'bag-detector-x+person-detector-y', input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_note: null };
const PRODUCT = { buffer: Buffer.from('product-bytes'), mimetype: 'image/png', originalname: 'tui.png', size: 13 } as Express.Multer.File;

function makeService(post: jest.Mock) {
  const configService: any = {
    get: jest.fn((key: string) => ({ AI_SERVICE_URL: 'http://ai:8000', USD_VND_RATE: '26000' } as Record<string, string>)[key]),
  };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-1') };
  return { service: new ProductImageService({ post } as any, configService, jwtService, generations), generations };
}

const candidate = (data: string, poseId: string) => ({
  image_base64: data, mime_type: 'image/jpeg', info: { pose_id: poseId, score: 0.1, hands: 2, warnings: [] },
});

describe('Chị Nhạm cầm SP — tự chọn tư thế 0đ (held-auto)', () => {
  it('gửi ảnh SP dạng file tới held-auto/, trả các ảnh theo thứ tự AI, ghi MỘT lượt HELD_SWAP 0đ', async () => {
    const post = jest.fn(() => of({ data: { success: true, usage: FREE_USAGE, candidates: [candidate('QQ', 'p1'), candidate('Qg', 'p2')] } }));
    const { service, generations } = makeService(post);

    const result = await service.heldAuto(PRODUCT, { productName: ' Túi Mộc Vân ', widthCm: 24 }, USER);

    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/held-auto/');
    expect(formFields(body)).toEqual({
      product_image: { file: 'product-bytes', contentType: 'image/png' },
      product_mime_type: 'image/png',
      width_cm: '24',
    });
    expect(config.timeout).toBe(ProductImageService.HELD_SWAP_TIMEOUT_MS);
    expect(result.candidates.map((c) => c.poseId)).toEqual(['p1', 'p2']);
    expect(result.candidates[0]).toMatchObject({ imageData: 'data:image/jpeg;base64,QQ', info: { hands: 2, warnings: [] } });
    expect(result.cost).toMatchObject({ usd: 0, vnd: 0 });
    expect(generations.record).toHaveBeenCalledTimes(1);
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-7', mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: 'SUCCESS', productName: 'Túi Mộc Vân', cost_usd: 0,
    }));
  });

  it('thiếu ảnh SP hoặc tên SP → 400, không gọi AI', async () => {
    const post = jest.fn();
    const { service } = makeService(post);
    await expect(service.heldAuto(undefined, { productName: 'Túi', widthCm: 24 }, USER)).rejects.toMatchObject({ status: 400 });
    await expect(service.heldAuto(PRODUCT, { productName: '  ', widthCm: 24 }, USER)).rejects.toMatchObject({ status: 400 });
    expect(post).not.toHaveBeenCalled();
  });

  it('thiếu / sai bề ngang túi (cm) → 400, không gọi AI', async () => {
    const post = jest.fn();
    const { service } = makeService(post);
    for (const widthCm of [undefined, NaN, 3, 75]) {
      await expect(service.heldAuto(PRODUCT, { productName: 'Túi', widthCm }, USER)).rejects.toMatchObject({ status: 400 });
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('AI trả rỗng hoặc thiếu ảnh → 502, vẫn ghi lượt hỏng 0đ', async () => {
    for (const candidates of [[], [{ mime_type: 'image/jpeg' }]]) {
      const post = jest.fn(() => of({ data: { success: true, usage: FREE_USAGE, candidates } }));
      const { service, generations } = makeService(post);
      await expect(service.heldAuto(PRODUCT, { productName: 'Túi', widthCm: 24 }, USER)).rejects.toMatchObject({ status: 502 });
      expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', cost_usd: 0 }));
    }
  });

  it('kết nối bị AI đóng ngang → tự gửi lại đúng một lần bằng form mới', async () => {
    const hangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const post = jest.fn()
      .mockImplementationOnce(() => throwError(hangUp))
      .mockImplementationOnce(() => of({ data: { success: true, usage: FREE_USAGE, candidates: [candidate('QQ', 'p1')] } }));
    const result = await makeService(post).service.heldAuto(PRODUCT, { productName: 'Túi', widthCm: 24 }, USER);
    expect(post).toHaveBeenCalledTimes(2);
    expect(formFields((post.mock.calls[1] as any[])[1])).toMatchObject({ product_image: { file: 'product-bytes' } });
    expect(result.candidates).toHaveLength(1);
  });

  it('AI báo lỗi cấu hình (thiếu thư viện tư thế) → giữ thông báo của AI', async () => {
    const err = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { success: false, error_message: 'PRODUCT_IMAGE_POSE_LIBRARY_DIR chưa được set' } },
    });
    const post = jest.fn(() => throwError(() => err));
    await expect(makeService(post).service.heldAuto(PRODUCT, { productName: 'Túi', widthCm: 24 }, USER))
      .rejects.toMatchObject({ message: expect.stringContaining('PRODUCT_IMAGE_POSE_LIBRARY_DIR') });
  });
});

describe('HeldAutoDto', () => {
  it('bắt buộc tên sản phẩm và bề ngang túi', async () => {
    const errors = await validate(plainToInstance(HeldAutoDto, {}));
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['productName', 'widthCm']));
  });

  it('bề ngang túi nhận chuỗi số từ form multipart, phải trong 6–60cm', async () => {
    const ok = plainToInstance(HeldAutoDto, { productName: 'Túi', widthCm: '24.5' });
    expect(await validate(ok)).toEqual([]);
    expect(ok.widthCm).toBe(24.5);
    for (const widthCm of ['abc', '3', '75']) {
      const errors = await validate(plainToInstance(HeldAutoDto, { productName: 'Túi', widthCm }));
      expect(errors.map((e) => e.property)).toEqual(['widthCm']);
    }
  });
});

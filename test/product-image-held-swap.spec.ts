/**
 * Tạo ảnh sản phẩm — tab "Chị Nhạm cầm SP", chế độ ĐỔI SP 0đ (HELD_SWAP): BE nhận ảnh chị Nhạm cầm SP cũ + ảnh SP
 * mới, chuyển sang AI service (model người cầm SP tự huấn luyện + SAM + LaMa — không gọi Gemini).
 *
 * Khoá: đúng endpoint + field gửi AI, thời gian chờ riêng (lần đầu AI nạp ~300MB model), thiếu ảnh / tên SP thì 400
 * trước khi gọi AI, mỗi lượt (thành công hay hỏng) được ghi HELD_SWAP 0đ, kết nối bị AI đóng ngang thì tự gửi lại
 * một lần (chạy lại không tốn gì), trả số bàn tay + cảnh báo cho FE, và tab Chi phí đếm lượt đổi SP RIÊNG — không
 * lẫn vào lượt tạo / ảnh đạt của Gemini.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import { formFields } from './helpers/ai-form-fields';
import { HeldSwapDto } from '../src/modules/product-image/dto/held-swap.dto';
import { PRODUCT_NAME_MAX_LENGTH } from '../src/modules/product-image/dto/held-product.dto';
import {
  GenerationRow,
  HELD_SWAP_FAILED_FREE,
  PRODUCT_IMAGE_MODE,
  buildCostStats,
} from '../src/modules/product-image/product-image-cost.util';

const USER = { id: 'user-3', email: 'media@vcb.test' };

function makeFile(content: string, mimetype: string): Express.Multer.File {
  return { buffer: Buffer.from(content), mimetype, originalname: 'x', size: content.length } as Express.Multer.File;
}

function makeService(post: jest.Mock) {
  const configService: any = {
    get: jest.fn((key: string) => ({ AI_SERVICE_URL: 'http://ai:8000', USD_VND_RATE: '26000' } as Record<string, string>)[key]),
  };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-9') };
  return { service: new ProductImageService({ post } as any, configService, jwtService, generations), generations };
}

const PERSON = makeFile('person-bytes', 'image/jpeg');
const PRODUCT = makeFile('product-bytes', 'image/png');
const FREE_USAGE = { model: 'bag-detector-x+person-detector-y', input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_note: null };

describe('Đổi SP chị Nhạm cầm — 0đ (held-swap)', () => {
  it('gửi đủ 2 ảnh tới held-swap/, trả data URI + số tay/cảnh báo, ghi lượt HELD_SWAP 0đ', async () => {
    const post = jest.fn(() => of({ data: {
      success: true, image_base64: 'SlBH', mime_type: 'image/jpeg', usage: FREE_USAGE,
      info: { hands: 2, strap_kept: true, warnings: [] },
    } }));
    const { service, generations } = makeService(post);

    const result = await service.heldSwap(PERSON, PRODUCT, { productName: ' Túi Thiên Vân ' }, USER);

    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/held-swap/');
    expect(formFields(body)).toEqual({
      person_image: { file: 'person-bytes', contentType: 'image/jpeg' },
      person_mime_type: 'image/jpeg',
      product_image: { file: 'product-bytes', contentType: 'image/png' },
      product_mime_type: 'image/png',
    });
    expect(config.timeout).toBe(ProductImageService.HELD_SWAP_TIMEOUT_MS);
    expect(config.headers.Authorization).toBe('Bearer signed.jwt');
    expect(result).toMatchObject({
      imageData: 'data:image/jpeg;base64,SlBH',
      mimeType: 'image/jpeg',
      cost: { usd: 0, vnd: 0 },
      info: { hands: 2, strapKept: true, warnings: [] },
    });
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-3', mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: 'SUCCESS', productName: 'Túi Thiên Vân', cost_usd: 0,
    }));
  });

  it('thiếu ảnh nào thì 400 nêu đúng ảnh đó, không gọi AI', async () => {
    const post = jest.fn();
    const { service } = makeService(post);
    await expect(service.heldSwap(undefined, PRODUCT, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      status: 400, message: expect.stringContaining('chị Nhạm'),
    });
    await expect(service.heldSwap(PERSON, undefined, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      status: 400, message: expect.stringContaining('sản phẩm mới'),
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('thiếu tên sản phẩm thì 400, không gọi AI', async () => {
    const post = jest.fn();
    await expect(makeService(post).service.heldSwap(PERSON, PRODUCT, { productName: '   ' }, USER)).rejects.toMatchObject({ status: 400 });
    expect(post).not.toHaveBeenCalled();
  });

  it('AI báo lỗi thì vẫn ghi lượt hỏng HELD_SWAP 0đ kèm lý do, rồi trả lỗi', async () => {
    const post = jest.fn(() => of({ data: {
      success: false, error_message: 'Không tìm thấy sản phẩm chị Nhạm đang cầm trong ảnh', usage: FREE_USAGE,
    } }));
    const { service, generations } = makeService(post);
    await expect(service.heldSwap(PERSON, PRODUCT, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      message: expect.stringContaining('Không tìm thấy sản phẩm'),
    });
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: 'FAILED', cost_usd: 0,
    }));
  });

  it('AI báo lỗi KHÔNG kèm usage (lỗi đầu vào trước khi chạy model) → lượt hỏng ghi 0đ với ghi chú đổi SP', async () => {
    const post = jest.fn(() => of({ data: { success: false, error_message: 'Thiếu ảnh chị Nhạm cầm sản phẩm' } }));
    const { service, generations } = makeService(post);
    await expect(service.heldSwap(PERSON, PRODUCT, { productName: 'Túi' }, USER)).rejects.toBeDefined();
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAILED', cost_usd: HELD_SWAP_FAILED_FREE.cost_usd, cost_note: HELD_SWAP_FAILED_FREE.cost_note,
    }));
  });

  it('không kết nối được AI → lượt hỏng vẫn 0đ (không ghi "chưa biết")', async () => {
    const post = jest.fn(() => throwError(() => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
    const { service, generations } = makeService(post);
    await expect(service.heldSwap(PERSON, PRODUCT, { productName: 'Túi' }, USER)).rejects.toBeDefined();
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', cost_usd: 0 }));
  });

  it('kết nối bị AI đóng ngang (socket hang up) → tự gửi lại đúng một lần', async () => {
    const hangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const post = jest.fn()
      .mockImplementationOnce(() => throwError(hangUp))
      .mockImplementationOnce(() => of({ data: { success: true, image_base64: 'SlBH', mime_type: 'image/jpeg', usage: FREE_USAGE } }));
    const result = await makeService(post).service.heldSwap(PERSON, PRODUCT, { productName: 'Túi' }, USER);
    expect(post).toHaveBeenCalledTimes(2);
    // form-data là stream đọc một lần — lần gửi lại phải là form mới, vẫn đủ 2 ảnh.
    const [first, second] = post.mock.calls.map((call: any[]) => call[1]);
    expect(second).not.toBe(first);
    expect(formFields(second)).toMatchObject({ person_image: { file: 'person-bytes' }, product_image: { file: 'product-bytes' } });
    expect(result.info).toEqual({ hands: null, strapKept: false, warnings: [] });
  });

  it('AI trả thiếu ảnh thì 502', async () => {
    const post = jest.fn(() => of({ data: { success: true, usage: FREE_USAGE } }));
    await expect(makeService(post).service.heldSwap(PERSON, PRODUCT, { productName: 'Túi' }, USER)).rejects.toMatchObject({ status: 502 });
  });
});

describe('HeldSwapDto', () => {
  it('bắt buộc tên sản phẩm', async () => {
    const errors = await validate(plainToInstance(HeldSwapDto, {}));
    expect(errors.map((e) => e.property)).toContain('productName');
  });

  it(`tên sản phẩm tối đa ${PRODUCT_NAME_MAX_LENGTH} ký tự`, async () => {
    expect(await validate(plainToInstance(HeldSwapDto, { productName: 'a'.repeat(PRODUCT_NAME_MAX_LENGTH) }))).toHaveLength(0);
    expect(await validate(plainToInstance(HeldSwapDto, { productName: 'a'.repeat(PRODUCT_NAME_MAX_LENGTH + 1) }))).toHaveLength(1);
  });
});

describe('Tab Chi phí — lượt đổi SP 0đ đếm riêng', () => {
  function row(partial: Partial<GenerationRow>): GenerationRow {
    return {
      id: Math.random().toString(36).slice(2), user_id: 'user-1', mode: 'HELD_PRODUCT', status: 'SUCCESS',
      product_name: 'Túi Thiên Vân', model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120,
      cost_usd: 0.0682, cost_note: null, error_message: null, approved_at: null,
      created_at: new Date('2026-10-13T03:00:00Z'), ...partial,
    };
  }

  it('HELD_SWAP không thành lượt tạo / ảnh thành công của Gemini, đếm vào swaps (tổng + theo người)', () => {
    const stats = buildCostStats([
      row({}),
      row({ mode: 'HELD_SWAP', model: 'person-detector', input_tokens: 0, output_tokens: 0, cost_usd: 0 }),
      row({ mode: 'HELD_SWAP', model: 'person-detector', input_tokens: 0, output_tokens: 0, cost_usd: 0 }),
      row({ mode: 'HELD_SWAP', status: 'FAILED', input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_note: HELD_SWAP_FAILED_FREE.cost_note }),
    ], { rate: 26000, userNames: new Map([['user-1', 'Nguyễn A']]), toDay: (d) => d.toISOString().slice(0, 10), recentLimit: 5 });

    expect(stats.totals).toMatchObject({ attempts: 1, success: 1, swaps: 2, swap_failed: 1, failed: 0 });
    expect(stats.totals.cost_usd).toBeCloseTo(0.0682);
    expect(stats.by_product).toEqual([expect.objectContaining({ product_name: 'Túi Thiên Vân', attempts: 1, success: 1 })]);
    expect(stats.by_user).toEqual([expect.objectContaining({ user_id: 'user-1', attempts: 1, swaps: 2 })]);
  });
});

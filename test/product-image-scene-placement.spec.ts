/**
 * Tạo ảnh sản phẩm — chế độ "Đặt SP vào cảnh" (tab Tạo hàng loạt, tính phí Gemini mỗi lượt): BE
 * nhận ảnh SP + ảnh cảnh, chuyển sang AI service để Gemini đặt SP vào cảnh.
 *
 * Khoá: đúng tên field gửi AI (SP → cảnh, thứ tự là contract với prompt), thiếu ảnh/tên SP thì 400
 * trước khi tốn lượt Gemini, mỗi lượt (thành công hay hỏng) ghi chi phí với mode SCENE_PLACEMENT,
 * ảnh của chế độ này bấm "Đạt" được, và tab Chi phí đếm nó là lượt Gemini (không lẫn với tách nền).
 */
import { HttpStatus } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import { formFields } from './helpers/ai-form-fields';
import { ProductImageGenerationsService } from '../src/modules/product-image/product-image-generations.service';
import { ScenePlacementDto } from '../src/modules/product-image/dto/scene-placement.dto';
import { GenerationRow, buildCostStats, isGeminiAttempt } from '../src/modules/product-image/product-image-cost.util';

const USER = { id: 'user-3', email: 'content@vcb.test' };
const PRODUCT = { buffer: Buffer.from('bag-bytes'), mimetype: 'image/png' } as Express.Multer.File;
const SCENE = { buffer: Buffer.from('scene-bytes'), mimetype: 'image/jpeg' } as Express.Multer.File;
const USAGE = { model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120, cost_usd: 0.0682, cost_note: null };

function makeService(post: jest.Mock, rate: string | undefined = '26000') {
  const values: Record<string, string | undefined> = { AI_SERVICE_URL: 'http://ai:8000', USD_VND_RATE: rate };
  const configService: any = { get: jest.fn((key: string) => values[key]) };
  const jwtService: any = { sign: jest.fn(() => 'signed.jwt') };
  const generations: any = { record: jest.fn().mockResolvedValue('gen-9') };
  return { service: new ProductImageService({ post } as any, configService, jwtService, generations), generations };
}

describe('Tạo ảnh sản phẩm — đặt SP vào cảnh (tạo hàng loạt)', () => {
  it('gửi ảnh SP trước, ảnh cảnh sau + ghi chú đã cắt khoảng trắng tới đúng endpoint', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'SlBH', mime_type: 'image/jpeg', usage: USAGE } }));
    const { service } = makeService(post);

    const result = await service.scenePlacement(PRODUCT, SCENE, { note: '  túi cao 25cm ', productName: ' Túi Hermes ' }, USER);

    const [url, body, config] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai:8000/api/ai/product-image/scene-placement/');
    expect(formFields(body)).toEqual({
      product_image: { file: 'bag-bytes', contentType: 'image/png' },
      product_mime_type: 'image/png',
      scene_image: { file: 'scene-bytes', contentType: 'image/jpeg' },
      scene_mime_type: 'image/jpeg',
      note: 'túi cao 25cm',
    });
    expect(config.timeout).toBe(ProductImageService.HELD_PRODUCT_TIMEOUT_MS);
    expect(config.headers.Authorization).toBe('Bearer signed.jwt');
    expect(result).toEqual({
      imageData: 'data:image/jpeg;base64,SlBH',
      mimeType: 'image/jpeg',
      generationId: 'gen-9',
      cost: { usd: 0.0682, vnd: Math.round(0.0682 * 26000), note: null },
    });
  });

  it('ghi chú rỗng thì không gửi trường note', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'UE5H', mime_type: 'image/png', usage: USAGE } }));
    await makeService(post).service.scenePlacement(PRODUCT, SCENE, { note: '  ', productName: 'Túi' }, USER);
    expect(formFields((post.mock.calls[0] as any[])[1])).not.toHaveProperty('note');
  });

  it('thiếu ảnh SP, ảnh cảnh hoặc tên SP thì 400 nêu đúng chỗ thiếu, không gọi AI', async () => {
    const post = jest.fn();
    const { service } = makeService(post);

    await expect(service.scenePlacement(undefined, SCENE, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('ảnh sản phẩm'),
    });
    await expect(service.scenePlacement(PRODUCT, undefined, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('ảnh cảnh'),
    });
    await expect(service.scenePlacement(PRODUCT, SCENE, { productName: '   ' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('tên sản phẩm'),
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('lượt thành công ghi chi phí với mode SCENE_PLACEMENT và tên SP đã cắt khoảng trắng', async () => {
    const post = jest.fn(() => of({ data: { success: true, image_base64: 'SlBH', mime_type: 'image/jpeg', usage: USAGE } }));
    const { service, generations } = makeService(post);

    await service.scenePlacement(PRODUCT, SCENE, { productName: ' Túi Hermes ' }, USER);

    expect(generations.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-3',
        mode: 'SCENE_PLACEMENT',
        status: 'SUCCESS',
        productName: 'Túi Hermes',
        cost_usd: 0.0682,
        input_tokens: 2000,
        output_tokens: 1120,
      }),
    );
  });

  it('Gemini chạy xong nhưng không ra ảnh: vẫn ghi lượt hỏng kèm tiền AI báo về, giữ mã lỗi AI', async () => {
    const post = jest.fn(() =>
      throwError(() => ({
        response: { status: 502, data: { success: false, error_message: 'Gemini không trả về ảnh', usage: USAGE } },
      })),
    );
    const { service, generations } = makeService(post);

    await expect(service.scenePlacement(PRODUCT, SCENE, { productName: 'Túi' }, USER)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      message: 'Gemini không trả về ảnh',
    });
    expect(generations.record).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'SCENE_PLACEMENT', status: 'FAILED', cost_usd: 0.0682 }),
    );
  });

  it('controller lấy đúng file đầu tiên của từng field và chuyển tên SP + ghi chú', async () => {
    const scenePlacement = jest.fn().mockResolvedValue({ imageData: 'x', mimeType: 'image/png' });
    const controller = new ProductImageController({ scenePlacement } as any, {} as any);

    await controller.scenePlacement({ productImage: [PRODUCT], sceneImage: [SCENE] }, { note: 'n', productName: 'Túi' }, { user: USER });

    expect(scenePlacement).toHaveBeenCalledWith(PRODUCT, SCENE, { note: 'n', productName: 'Túi' }, USER);
  });

  it('ScenePlacementDto bắt buộc tên SP như chế độ chị Nhạm', async () => {
    expect(await validate(plainToInstance(ScenePlacementDto, { productName: 'Túi' }))).toHaveLength(0);
    const errors = await validate(plainToInstance(ScenePlacementDto, { productName: '' }));
    expect(errors[0]?.property).toBe('productName');
  });

  it('ảnh đặt vào cảnh tạo thành công bấm "Đạt" được', async () => {
    const prisma: any = {
      productImageGeneration: {
        findUnique: jest.fn().mockResolvedValue({ id: 'gen-9', user_id: 'user-3', mode: 'SCENE_PLACEMENT', status: 'SUCCESS' }),
        update: jest.fn(async ({ data }: any) => ({ id: 'gen-9', approved_at: data.approved_at })),
      },
    };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn() } as any);

    const result = await service.setApproved('gen-9', true, { id: 'user-3', roles: [UserRole.MEMBER] });

    expect(result.approved).toBe(true);
  });

  describe('tab Chi phí', () => {
    const base: GenerationRow = {
      id: 'r1',
      user_id: 'user-3',
      mode: 'SCENE_PLACEMENT',
      status: 'SUCCESS',
      product_name: 'Túi Hermes',
      model: 'gemini-3.1-flash-image',
      input_tokens: 2000,
      output_tokens: 1120,
      cost_usd: 0.0682,
      cost_note: null,
      error_message: null,
      approved_at: null,
      created_at: new Date('2026-10-08T03:00:00Z'),
    };

    it('lượt đặt vào cảnh là lượt Gemini, lượt bị từ chối ngay (0 token, 0đ) thì không', () => {
      expect(isGeminiAttempt(base)).toBe(true);
      expect(isGeminiAttempt({ ...base, status: 'FAILED', input_tokens: 0, output_tokens: 0, cost_usd: 0 })).toBe(false);
    });

    it('cộng tiền + lượt + ảnh đạt của chế độ này vào tổng và theo sản phẩm, không tính là tách nền', () => {
      const rows: GenerationRow[] = [
        { ...base, id: 'a', approved_at: new Date('2026-10-08T03:05:00Z') },
        { ...base, id: 'b' },
        { ...base, id: 'c', mode: 'CUTOUT', cost_usd: 0, input_tokens: 0, output_tokens: 0, product_name: null },
      ];

      const stats = buildCostStats(rows, { rate: 26000, userNames: new Map(), toDay: () => '2026-10-08', recentLimit: 10 });

      expect(stats.totals).toMatchObject({ attempts: 2, success: 2, approved: 1, cutouts: 1 });
      expect(stats.totals.cost_usd).toBeCloseTo(0.1364, 6);
      expect(stats.by_product).toEqual([
        expect.objectContaining({ product_name: 'Túi Hermes', attempts: 2, approved: 1, per_approved: expect.objectContaining({ attempts: 2 }) }),
      ]);
    });
  });
});

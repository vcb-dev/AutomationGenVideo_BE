/**
 * Tạo ảnh sản phẩm — ghi nhận chi phí từng lượt và thống kê tab Chi phí.
 *
 * Khoá: mỗi lượt (thành công hay hỏng) được ghi với đúng token/chi phí AI báo về; lượt hỏng vẫn
 * ghi tiền nếu Gemini đã chạy; BE hết giờ chờ thì ghi "chưa biết" chứ không ghi 0đ; thiếu tỷ giá
 * không làm hỏng lượt tạo ảnh nhưng tab Chi phí báo lỗi nêu tên biến; hai chỉ số của phương án
 * (lượt tạo / 1 ảnh đạt, chi phí / 1 ảnh đạt) tính đúng cả tổng lẫn theo từng sản phẩm; tab Chi
 * phí chỉ ADMIN/MANAGER.
 */
import { HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { of, throwError } from 'rxjs';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageService } from '../src/modules/product-image/product-image.service';
import { ProductImageGenerationsService } from '../src/modules/product-image/product-image-generations.service';
import {
  GenerationRow,
  buildCostStats,
  costFromAiUsage,
  isGeminiAttempt,
  parseUsdVndRate,
  productKey,
  tryParseUsdVndRate,
  usageFromAxiosError,
} from '../src/modules/product-image/product-image-cost.util';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';

const USER = { id: 'user-1', email: 'content@vcb.test' };
const RATE = 26000;
const PERSON = { buffer: Buffer.from('p'), mimetype: 'image/jpeg' } as Express.Multer.File;
const PRODUCT = { buffer: Buffer.from('s'), mimetype: 'image/png' } as Express.Multer.File;
// Một ảnh 1K của gemini-3.1-flash-image (1120 token × $60/1M) + 2.000 token đầu vào ($0,5/1M).
const ONE_IMAGE_USD = 0.0682;

function row(partial: Partial<GenerationRow>): GenerationRow {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'user-1',
    mode: 'HELD_PRODUCT',
    status: 'SUCCESS',
    product_name: 'Nhẫn Kim Vũ',
    model: 'gemini-3.1-flash-image',
    input_tokens: 2000,
    output_tokens: 1120,
    cost_usd: ONE_IMAGE_USD,
    cost_note: null,
    error_message: null,
    approved_at: null,
    created_at: new Date('2026-09-29T03:00:00Z'),
    ...partial,
  };
}

describe('Tỷ giá USD → VNĐ (USD_VND_RATE bắt buộc)', () => {
  it('đọc đúng số dương', () => {
    expect(parseUsdVndRate('26000')).toBe(26000);
  });

  it.each([undefined, '', '0', '-5', 'abc'])('giá trị "%s" → lỗi nêu tên biến', (raw) => {
    expect(() => parseUsdVndRate(raw)).toThrow(/USD_VND_RATE/);
  });

  it('bản "thử" không ném — trả null kèm lý do', () => {
    expect(tryParseUsdVndRate(undefined)).toEqual({ rate: null, note: expect.stringContaining('USD_VND_RATE') });
  });
});

describe('Đọc khối usage AI gửi về', () => {
  const FALLBACK = { cost_usd: null, cost_note: 'không rõ' };

  it('dùng nguyên số token + chi phí + model', () => {
    expect(
      costFromAiUsage({ model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120, cost_usd: ONE_IMAGE_USD }, FALLBACK),
    ).toEqual({ model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120, cost_usd: ONE_IMAGE_USD, cost_note: null });
  });

  it('cost_usd null (thiếu đơn giá) giữ null kèm lý do, không đổi thành 0đ', () => {
    const cost = costFromAiUsage({ input_tokens: 2000, output_tokens: 1120, cost_usd: null, cost_note: 'Thiếu GEMINI_IMAGE_PRICES_JSON' }, FALLBACK);
    expect(cost.cost_usd).toBeNull();
    expect(cost.cost_note).toContain('GEMINI_IMAGE_PRICES_JSON');
  });

  it('không có usage → dùng phương án dự phòng của bên gọi', () => {
    expect(costFromAiUsage(undefined, FALLBACK)).toEqual({ model: null, input_tokens: 0, output_tokens: 0, ...FALLBACK });
  });

  it('lỗi axios: có usage trong thân lỗi → dùng; BE hết giờ → chưa biết; không kết nối → 0đ; lạ → null', () => {
    expect(usageFromAxiosError({ response: { status: 502, data: { usage: { cost_usd: 0.001 } } } })).toEqual({ cost_usd: 0.001 });
    expect(usageFromAxiosError({ code: 'ECONNABORTED', message: 'timeout of 90000ms exceeded' })?.cost_usd).toBeNull();
    expect(usageFromAxiosError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })?.cost_usd).toBe(0);
    expect(usageFromAxiosError({ response: { status: 500, data: '<html>' } })).toBeNull();
  });
});

describe('Ghi nhận từng lượt khi tạo ảnh', () => {
  function makeService(post: jest.Mock, env: Record<string, string | undefined> = { AI_SERVICE_URL: 'http://ai:8000', USD_VND_RATE: '26000' }) {
    const configService: any = { get: jest.fn((key: string) => env[key]) };
    const generations: any = { record: jest.fn().mockResolvedValue('gen-9') };
    const service = new ProductImageService({ post } as any, configService, { sign: () => 'jwt' } as any, generations);
    return { service, generations };
  }
  const aiOk = (usage: object) => of({ data: { success: true, image_base64: 'SlBH', mime_type: 'image/jpeg', usage } });

  it('thành công: ghi SUCCESS + tên SP + token + chi phí, trả generationId và tiền VNĐ', async () => {
    const usage = { model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120, cost_usd: ONE_IMAGE_USD, cost_note: null };
    const { service, generations } = makeService(jest.fn(() => aiOk(usage)));

    const result = await service.heldProduct(PERSON, PRODUCT, { productName: '  Nhẫn Kim Vũ ' }, USER);

    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', mode: 'HELD_PRODUCT', status: 'SUCCESS', productName: 'Nhẫn Kim Vũ',
      model: 'gemini-3.1-flash-image', input_tokens: 2000, output_tokens: 1120, cost_usd: ONE_IMAGE_USD,
    }));
    expect(result.generationId).toBe('gen-9');
    expect(result.cost).toEqual({ usd: ONE_IMAGE_USD, vnd: Math.round(ONE_IMAGE_USD * RATE), note: null });
  });

  it('thiếu USD_VND_RATE: vẫn trả ảnh, chưa quy ra VNĐ và nói rõ tên biến', async () => {
    const { service } = makeService(jest.fn(() => aiOk({ cost_usd: ONE_IMAGE_USD })), { AI_SERVICE_URL: 'http://ai:8000' });
    const result = await service.heldProduct(PERSON, PRODUCT, { productName: 'Nhẫn' }, USER);
    expect(result.imageData).toBe('data:image/jpeg;base64,SlBH');
    expect(result.cost.vnd).toBeNull();
    expect(result.cost.note).toContain('USD_VND_RATE');
  });

  it('Gemini chạy nhưng không trả ảnh: ghi FAILED kèm đúng số tiền đã tốn, rồi báo lỗi', async () => {
    const post = jest.fn(() => throwError(() => ({
      response: { status: 502, data: { error_message: 'Gemini không trả về ảnh', usage: { input_tokens: 2000, output_tokens: 8, cost_usd: 0.001024 } } },
    })));
    const { service, generations } = makeService(post);

    await expect(service.heldProduct(PERSON, PRODUCT, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({ status: 502 });
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAILED', cost_usd: 0.001024, input_tokens: 2000, errorMessage: 'Gemini không trả về ảnh',
    }));
  });

  it('BE hết giờ chờ: ghi FAILED với chi phí CHƯA BIẾT (null), không ghi 0đ', async () => {
    const post = jest.fn(() => throwError(() => ({ code: 'ECONNABORTED', message: 'timeout of 90000ms exceeded' })));
    const { service, generations } = makeService(post);

    await expect(service.heldProduct(PERSON, PRODUCT, { productName: 'Nhẫn' }, USER)).rejects.toMatchObject({ status: HttpStatus.GATEWAY_TIMEOUT });
    expect(generations.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', cost_usd: null }));
  });

  it('thiếu tên sản phẩm: 400 trước khi gọi AI, không ghi lượt nào', async () => {
    const post = jest.fn();
    const { service, generations } = makeService(post);
    await expect(service.heldProduct(PERSON, PRODUCT, { productName: '   ' }, USER)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('tên sản phẩm'),
    });
    expect(post).not.toHaveBeenCalled();
    expect(generations.record).not.toHaveBeenCalled();
  });

  it('tách nền: ghi CUTOUT 0đ kèm model rembg; hỏng thì ghi FAILED', async () => {
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png' } as Express.Multer.File;
    const ok = makeService(jest.fn(() => of({ data: { success: true, cutout_image_base64: 'UE5H', width: 1, height: 1, model: 'isnet-general-use' } })));
    await ok.service.cutout(file, USER);
    expect(ok.generations.record).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'CUTOUT', status: 'SUCCESS', model: 'isnet-general-use', cost_usd: 0,
    }));

    const bad = makeService(jest.fn(() => throwError(() => ({ response: { status: 400, data: { error_message: 'Không tìm thấy sản phẩm' } } }))));
    await expect(bad.service.cutout(file, USER)).rejects.toMatchObject({ status: 400 });
    expect(bad.generations.record).toHaveBeenCalledWith(expect.objectContaining({ mode: 'CUTOUT', status: 'FAILED', cost_usd: 0 }));
  });

  it('ghi nhật ký hỏng (vd DB) không làm hỏng lượt tạo ảnh — record trả null', async () => {
    const prisma: any = { productImageGeneration: { create: jest.fn().mockRejectedValue(new Error('relation does not exist')) } };
    const generations = new ProductImageGenerationsService(prisma, { get: jest.fn() } as any);
    await expect(generations.record({
      userId: 'u', mode: 'CUTOUT', status: 'SUCCESS', model: null, input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_note: null, durationMs: 5,
    })).resolves.toBeNull();
  });
});

describe('Tổng hợp thống kê', () => {
  const approvedAt = new Date('2026-09-29T04:00:00Z');
  const rows: GenerationRow[] = [
    // Nhẫn Kim Vũ: 3 lượt ra ảnh, 1 ảnh đạt (tên gõ lệch hoa/thường, thừa khoảng trắng vẫn là 1 SP)
    row({ product_name: 'Nhẫn Kim Vũ', approved_at: approvedAt }),
    row({ product_name: '  nhẫn  kim vũ ' }),
    row({ product_name: 'NHẪN KIM VŨ', created_at: new Date('2026-09-28T03:00:00Z') }),
    // Dây chuyền: 2 ảnh đạt + 1 lượt Gemini chạy mà không ra ảnh (vẫn tốn) + 1 lượt model 404 (0đ, không tính là lượt tạo)
    row({ product_name: 'Dây chuyền', approved_at: approvedAt, user_id: 'user-2' }),
    row({ product_name: 'Dây chuyền', approved_at: approvedAt, user_id: 'user-2' }),
    row({ product_name: 'Dây chuyền', status: 'FAILED', output_tokens: 8, cost_usd: 0.001024, user_id: 'user-2' }),
    row({ product_name: 'Dây chuyền', status: 'FAILED', input_tokens: 0, output_tokens: 0, cost_usd: 0, user_id: 'user-2' }),
    // Chưa có đơn giá model → chưa biết tiền, nhưng vẫn là một lượt tạo
    row({ product_name: 'Bông tai', cost_usd: null, cost_note: 'Thiếu GEMINI_IMAGE_PRICES_JSON trên AI Service' }),
    // Tách nền: 2 thành công, 1 hỏng — 0đ
    row({ mode: 'CUTOUT', product_name: null, cost_usd: 0, input_tokens: 0, output_tokens: 0 }),
    row({ mode: 'CUTOUT', product_name: null, cost_usd: 0, input_tokens: 0, output_tokens: 0, user_id: 'user-3' }),
    row({ mode: 'CUTOUT', status: 'FAILED', product_name: null, cost_usd: 0, input_tokens: 0, output_tokens: 0 }),
  ];
  const stats = buildCostStats(rows, {
    rate: RATE,
    userNames: new Map([['user-1', 'Nguyễn A'], ['user-2', 'Trần B']]),
    toDay: (d) => d.toISOString().slice(0, 10),
    recentLimit: 5,
  });

  it('lượt model 404 (0đ, không token) không tính là lượt tạo; lượt chưa biết tiền thì có tính', () => {
    expect(isGeminiAttempt(rows[6])).toBe(false);
    expect(isGeminiAttempt(rows[5])).toBe(true);
    expect(isGeminiAttempt(rows[7])).toBe(true);
    expect(isGeminiAttempt(rows[8])).toBe(false);
  });

  it('tổng: tiền, lượt tạo, thành công/hỏng, ảnh đạt, lượt chưa có giá, tách nền', () => {
    const usd = ONE_IMAGE_USD * 5 + 0.001024;
    expect(stats.totals).toMatchObject({
      cost_usd: Math.round(usd * 1e6) / 1e6,
      cost_vnd: Math.round(usd * RATE),
      attempts: 7,
      success: 6,
      failed: 2,
      approved: 3,
      unpriced: 1,
      cutouts: 2,
      cutout_failed: 1,
    });
  });

  it('chi phí và số lượt cho 1 ảnh đạt (công thức mục 3 của phương án)', () => {
    const usd = ONE_IMAGE_USD * 5 + 0.001024;
    expect(stats.totals.per_approved).toEqual({
      cost_usd: Math.round((usd / 3) * 1e6) / 1e6,
      cost_vnd: Math.round((usd / 3) * RATE),
      attempts: Math.round((7 / 3) * 100) / 100,
    });
  });

  it('theo sản phẩm: gộp tên gõ lệch, tên hiển thị là tên gõ gần nhất, sắp theo tiền giảm dần', () => {
    expect(productKey('  nhẫn  kim VŨ ')).toBe('nhẫn kim vũ');
    const ring = stats.by_product.find((p) => p.product_name === 'Nhẫn Kim Vũ');
    expect(ring).toMatchObject({ attempts: 3, success: 3, approved: 1 });
    expect(ring?.per_approved?.attempts).toBe(3);
    const chain = stats.by_product.find((p) => p.product_name === 'Dây chuyền');
    expect(chain).toMatchObject({ attempts: 3, success: 2, approved: 2 });
    expect(chain?.per_approved?.attempts).toBe(1.5);
    const earring = stats.by_product.find((p) => p.product_name === 'Bông tai');
    expect(earring?.per_approved).toBeNull();
    expect(stats.by_product.map((p) => p.product_name)).toEqual(['Nhẫn Kim Vũ', 'Dây chuyền', 'Bông tai']);
  });

  it('theo ngày (giờ VN do bên gọi quy đổi) sắp tăng dần', () => {
    expect(stats.by_day.map((d) => [d.date, d.attempts, d.approved])).toEqual([
      ['2026-09-28', 1, 0],
      ['2026-09-29', 6, 3],
    ]);
  });

  it('theo người: tên từ bảng users, người đã xoá vẫn giữ số liệu', () => {
    expect(stats.by_user.find((u) => u.user_id === 'user-2')).toMatchObject({ name: 'Trần B', attempts: 3, approved: 2 });
    expect(stats.by_user.find((u) => u.user_id === 'user-3')).toMatchObject({ name: 'Người dùng đã xoá', cutouts: 1 });
  });

  it('gom lý do chưa tính được tiền, và giới hạn số lượt gần đây', () => {
    expect(stats.unpriced_notes).toEqual([{ note: 'Thiếu GEMINI_IMAGE_PRICES_JSON trên AI Service', count: 1 }]);
    expect(stats.recent).toHaveLength(5);
    expect(stats.recent[0]).toMatchObject({ user_name: 'Nguyễn A', cost_vnd: Math.round(ONE_IMAGE_USD * RATE), approved: true });
  });
});

describe('GET /product-image/costs', () => {
  it('thiếu USD_VND_RATE → lỗi nêu tên biến, không truy vấn DB', async () => {
    const prisma: any = { productImageGeneration: { findMany: jest.fn() } };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn(() => undefined) } as any);
    const error = await service.getCostStats('2026-09-01', '2026-09-30').catch((e) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toContain('USD_VND_RATE');
    expect(prisma.productImageGeneration.findMany).not.toHaveBeenCalled();
  });

  it('lọc theo ngày giờ VN, đổi Decimal sang số, lấy tên người thao tác', async () => {
    const prisma: any = {
      productImageGeneration: {
        findMany: jest.fn().mockResolvedValue([{ ...row({}), cost_usd: { toString: () => '0.0682', valueOf: () => 0.0682 } }]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1', full_name: 'Nguyễn A', email: 'a@x' }]) },
    };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn(() => '26000') } as any);

    const stats = await service.getCostStats('2026-09-01', '2026-09-30');

    const where = prisma.productImageGeneration.findMany.mock.calls[0][0].where;
    expect(where.created_at.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(where.created_at.lte.toISOString()).toBe('2026-09-30T16:59:59.999Z');
    expect(stats.totals.cost_vnd).toBe(Math.round(0.0682 * RATE));
    expect(stats.by_user[0].name).toBe('Nguyễn A');
    expect(stats.range).toEqual({ date_from: '2026-09-01', date_to: '2026-09-30' });
  });

  it('DB chưa có bảng (migration chưa áp) → câu dễ hiểu nêu đúng migration, không lộ chi tiết Prisma', async () => {
    const prismaError = Object.assign(new Error('Invalid `this.prisma.productImageGeneration.findMany()` invocation in /Users/x/dist/...'), { code: 'P2021' });
    const prisma: any = { productImageGeneration: { findMany: jest.fn().mockRejectedValue(prismaError) } };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn(() => '26000') } as any);

    const error = await service.getCostStats('2026-09-01', '2026-09-30').catch((e) => e);

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toContain('20260929150000_add_product_image_generations');
    expect(error.message).not.toContain('/Users/');
    expect(error.message).not.toContain('findMany');
  });

  it('lỗi DB khác → câu chung, không lộ đường dẫn/câu truy vấn', async () => {
    const prisma: any = { productImageGeneration: { findMany: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED /Users/x/dist/a.js:78')) } };
    const service = new ProductImageGenerationsService(prisma, { get: jest.fn(() => '26000') } as any);
    const error = await service.getCostStats().catch((e) => e);
    expect(error.message).toBe('Không đọc/ghi được dữ liệu chi phí tạo ảnh trong DB, vui lòng thử lại.');
  });

  it('chỉ ADMIN/MANAGER: RolesGuard + @Roles ở handler costs, tạo ảnh vẫn mở cho mọi người', () => {
    const handler = ProductImageController.prototype.costs;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['ADMIN', 'MANAGER']);
    expect(Reflect.getMetadata(ROLES_KEY, ProductImageController.prototype.heldProduct)).toBeUndefined();
  });
});

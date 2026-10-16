/**
 * Tạo ảnh sản phẩm — giá ước tính 1 ảnh Gemini cho hộp xác nhận lô (GET /product-image/gemini-estimate).
 *
 * Khoá: lấy trung bình tiền THẬT của các lượt Gemini gần nhất (BE không giữ đơn giá — đơn giá nằm ở
 * AI service), bỏ lượt 0đ (Gemini từ chối ngay), chưa có lượt nào thì trả null thay vì bịa số, thiếu
 * tỷ giá vẫn trả giá USD + lý do, chỉ đọc đúng các chế độ Gemini, và mọi tài khoản đăng nhập đều gọi
 * được (không gắn RolesGuard như tab Chi phí).
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ProductImageController } from '../src/modules/product-image/product-image.controller';
import { ProductImageGenerationsService } from '../src/modules/product-image/product-image-generations.service';
import {
  GEMINI_ESTIMATE_SAMPLE,
  estimateGeminiImageCost,
} from '../src/modules/product-image/product-image-cost.util';

/** `rate: null` = .env không có USD_VND_RATE. */
function makeService(costs: number[], rate: string | null = '26000') {
  const prisma: any = {
    productImageGeneration: { findMany: jest.fn().mockResolvedValue(costs.map((c) => ({ cost_usd: c }))) },
  };
  const config: any = { get: jest.fn((key: string) => (key === 'USD_VND_RATE' ? rate ?? undefined : undefined)) };
  return { service: new ProductImageGenerationsService(prisma, config), prisma };
}

describe('Giá ước tính 1 ảnh Gemini', () => {
  describe('estimateGeminiImageCost', () => {
    it('trung bình các lượt đã tính phí, quy ra VNĐ theo tỷ giá', () => {
      expect(estimateGeminiImageCost([0.06, 0.08], 26000)).toEqual({ per_image_usd: 0.07, per_image_vnd: 1820, sample_size: 2 });
    });

    it('bỏ lượt 0đ (Gemini từ chối ngay) — không kéo giá xuống', () => {
      expect(estimateGeminiImageCost([0, 0.0682, 0], 26000)).toEqual({ per_image_usd: 0.0682, per_image_vnd: 1773, sample_size: 1 });
    });

    it('chưa có lượt nào tính phí thì trả null, không bịa số', () => {
      expect(estimateGeminiImageCost([], 26000)).toEqual({ per_image_usd: null, per_image_vnd: null, sample_size: 0 });
      expect(estimateGeminiImageCost([0, 0], 26000).per_image_usd).toBeNull();
    });

    it('thiếu tỷ giá vẫn có giá USD, VNĐ để null', () => {
      expect(estimateGeminiImageCost([0.0682], null)).toEqual({ per_image_usd: 0.0682, per_image_vnd: null, sample_size: 1 });
    });
  });

  describe('getGeminiEstimate', () => {
    it('chỉ đọc lượt Gemini đã tính phí, mới nhất trước, tối đa GEMINI_ESTIMATE_SAMPLE lượt', async () => {
      const { service, prisma } = makeService([0.0682]);

      const result = await service.getGeminiEstimate();

      const query = prisma.productImageGeneration.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ mode: { in: ['HELD_PRODUCT', 'SCENE_PLACEMENT'] }, cost_usd: { gt: 0 } });
      expect(query.orderBy).toEqual({ created_at: 'desc' });
      expect(query.take).toBe(GEMINI_ESTIMATE_SAMPLE);
      expect(result).toEqual({ per_image_usd: 0.0682, per_image_vnd: 1773, sample_size: 1, note: null });
    });

    it('thiếu USD_VND_RATE: không lỗi, kèm lý do nêu tên biến', async () => {
      const result = await makeService([0.0682], null).service.getGeminiEstimate();
      expect(result.per_image_vnd).toBeNull();
      expect(result.note).toContain('USD_VND_RATE');
    });

    it('cột cost_usd là Decimal của Prisma vẫn đọc đúng số', async () => {
      const { service } = makeService([]);
      (service as any).prisma.productImageGeneration.findMany.mockResolvedValue([{ cost_usd: { toString: () => '0.07' } }]);
      expect((await service.getGeminiEstimate()).per_image_vnd).toBe(1820);
    });
  });

  it('mọi tài khoản đăng nhập gọi được — không gắn RolesGuard riêng như tab Chi phí', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ProductImageController.prototype.geminiEstimate) ?? [];
    expect(guards).toHaveLength(0);
  });
});

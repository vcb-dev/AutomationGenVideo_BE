import { of, throwError } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { OmsIntegrationService } from '../oms-integration.service';
import { OmsProductDetail } from '../oms-integration.types';

/**
 * getProductVariant() là điểm dùng chung của TasksService.findOrCreateEditorProductFromOms()
 * và TeamsService.addTeamProduct()/refreshTeamProductFromOms() — mọi luồng materialize sản phẩm
 * từ OMS đều đi qua đây, nên phải chắc nó resolve đúng variant hoặc báo lỗi rõ ràng.
 */
describe('OmsIntegrationService.getProductVariant', () => {
  function build(detail: OmsProductDetail | null) {
    const httpService: any = {
      get: jest.fn(() =>
        detail
          ? of({ data: { data: detail } })
          : throwError(() => ({ message: 'not found', response: { status: 404, data: null } })),
      ),
    };
    const configService: any = {
      get: (key: string) => (key === 'OMS_API_URL' ? 'https://oms.internal/api' : 'test-api-key'),
    };
    const service = new OmsIntegrationService(httpService, configService);
    return { service, httpService };
  }

  const sampleDetail: OmsProductDetail = {
    id: 'prod-1',
    alias: 'ao-thun-basic',
    name: 'Áo thun basic',
    vendor: null,
    product_type: null,
    tags: [],
    is_published: true,
    image_url: null,
    images: [],
    variants: [
      { id: 'var-1', sku: 'SKU-001', barcode: null, price: 100000, compare_at_price: null, cost: null, image_url: null, enabled: true, option_values: ['S'] },
      { id: 'var-2', sku: 'SKU-002', barcode: null, price: 120000, compare_at_price: null, cost: null, image_url: null, enabled: true, option_values: ['M'] },
    ],
    category_ids: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  };

  it('trả về đúng product + variant khi variant tồn tại trong product', async () => {
    const { service, httpService } = build(sampleDetail);

    const result = await service.getProductVariant('prod-1', 'var-2');

    expect(result.product.id).toBe('prod-1');
    expect(result.variant).toEqual(sampleDetail.variants[1]);
    expect(httpService.get).toHaveBeenCalledWith(
      'https://oms.internal/api/products/prod-1',
      expect.objectContaining({ headers: { 'X-API-Key': 'test-api-key' } }),
    );
  });

  it('ném NotFoundException khi variant không thuộc product (đã đổi/xoá bên OMS)', async () => {
    const { service } = build(sampleDetail);

    await expect(service.getProductVariant('prod-1', 'var-khong-ton-tai')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ném NotFoundException khi product không còn tồn tại bên OMS (404)', async () => {
    const { service } = build(null);

    await expect(service.getProductVariant('prod-da-xoa', 'var-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

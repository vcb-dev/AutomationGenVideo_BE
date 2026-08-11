import { ConflictException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

function buildPrisma(opts: { categoryCode: string; existingCount: number; serialTaken?: boolean }) {
  return {
    memsAssetModel: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'model-1',
        category: { code: opts.categoryCode },
      })),
    },
    memsAsset: {
      findUnique: jest.fn(async () =>
        opts.serialTaken ? { id: 'existing', asset_code: 'CAM-007' } : null,
      ),
      count: jest.fn(async () => opts.existingCount),
      create: jest.fn(async ({ data }: any) => ({ id: 'new-asset', ...data })),
    },
  } as any;
}

describe('MemsCatalogService.createAsset', () => {
  it('sinh mã thiết bị theo tiền tố danh mục và số thứ tự', async () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 2 });
    const service = new MemsCatalogService(prisma);

    const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' });

    expect(asset.asset_code).toBe('CAM-003');
  });

  it('thiết bị mới luôn ở trạng thái Chờ kiểm tra', async () => {
    // BR-05: không được đưa thẳng sang Sẵn sàng, kỹ thuật phải xác nhận trước.
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    const service = new MemsCatalogService(prisma);

    await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-001' });

    expect(prisma.memsAsset.create.mock.calls[0][0].data.status).toBe('PENDING_INSPECTION');
  });

  it('chặn serial đã tồn tại và chỉ ra thiết bị trùng', async () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 1, serialTaken: true });
    const service = new MemsCatalogService(prisma);

    await expect(
      service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' }),
    ).rejects.toThrow(ConflictException);
  });

  it('mã QR sinh cùng lúc và trùng với mã thiết bị', async () => {
    const prisma = buildPrisma({ categoryCode: 'LEN', existingCount: 4 });
    const service = new MemsCatalogService(prisma);

    const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-777' });

    expect(asset.qr_code).toBe('MEMS:LEN-005');
  });
});

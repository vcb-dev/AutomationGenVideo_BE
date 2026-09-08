import { ConflictException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';
import { photoUrlSignerStub } from '../../../common/mems/__tests__/photo-url-signer.stub';

function buildPrisma(opts: { categoryCode: string; existingCount: number; serialTaken?: boolean }) {
  const prisma: any = {
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
    memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
  };
  // Tạo máy và ghi nhật ký nhập kho nằm trong cùng một giao dịch.
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return prisma;
}

describe('MemsCatalogService.createAsset', () => {
  it('sinh mã thiết bị theo tiền tố danh mục và số thứ tự', async () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 2 });
    const service = new MemsCatalogService(prisma, photoUrlSignerStub);

    const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' });

    expect(asset.asset_code).toBe('CAM-003');
  });

  it('thiết bị mới luôn ở trạng thái Chờ kiểm tra', async () => {
    // BR-05: không được đưa thẳng sang Sẵn sàng, kỹ thuật phải xác nhận trước.
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    const service = new MemsCatalogService(prisma, photoUrlSignerStub);

    await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-001' });

    expect(prisma.memsAsset.create.mock.calls[0][0].data.status).toBe('PENDING_INSPECTION');
  });

  it('chặn serial đã tồn tại và chỉ ra thiết bị trùng', async () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 1, serialTaken: true });
    const service = new MemsCatalogService(prisma, photoUrlSignerStub);

    await expect(
      service.createAsset({ modelId: 'model-1', serialNumber: 'SN-999' }),
    ).rejects.toThrow(ConflictException);
  });

  it('mã QR sinh cùng lúc và trùng với mã thiết bị', async () => {
    const prisma = buildPrisma({ categoryCode: 'LEN', existingCount: 4 });
    const service = new MemsCatalogService(prisma, photoUrlSignerStub);

    const asset = await service.createAsset({ modelId: 'model-1', serialNumber: 'SN-777' });

    expect(asset.qr_code).toBe('MEMS:LEN-005');
  });
});

describe('MemsCatalogService.createAsset — tình trạng lúc nhập kho', () => {
  it('bỏ trống tình trạng thì hiểu là Tốt', () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    return new MemsCatalogService(prisma, photoUrlSignerStub)
      .createAsset({ modelId: 'model-1', serialNumber: 'SN-001' })
      .then(() => {
        expect(prisma.memsAsset.create.mock.calls[0][0].data.condition).toBe('GOOD');
      });
  });

  it('khai máy cũ có vết thì lưu đúng tình trạng đó', async () => {
    // Hàng đổi trả hay máy mua lại thường đã có vết; ép cứng là Tốt thì mọi lần đối chiếu
    // về sau đều lệch, và người mượn đầu tiên lãnh oan.
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
      modelId: 'model-1',
      serialNumber: 'SN-002',
      condition: 'USED',
    });

    expect(prisma.memsAsset.create.mock.calls[0][0].data.condition).toBe('USED');
  });

  it('máy nhập về đã hỏng vẫn vào Chờ kiểm tra, không nhảy thẳng sang Hỏng', async () => {
    // BR-05 nói về TRẠNG THÁI quy trình, còn hỏng là TÌNH TRẠNG vật lý — hai trục khác nhau.
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
      modelId: 'model-1',
      serialNumber: 'SN-003',
      condition: 'BROKEN',
    });

    const data = prisma.memsAsset.create.mock.calls[0][0].data;
    expect(data.status).toBe('PENDING_INSPECTION');
    expect(data.condition).toBe('BROKEN');
  });

  it('ghi mốc Nhập kho vào nhật ký vòng đời', async () => {
    // Thiếu mốc này thì màn chi tiết của máy chưa ai mượn trông như máy không có quá khứ.
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
      modelId: 'model-1',
      serialNumber: 'SN-004',
      condition: 'USED',
      intakeNote: 'Hàng đổi trả, xước mặt lưng',
    });

    const ev = prisma.memsAssetEvent.create.mock.calls[0][0].data;
    expect(ev).toMatchObject({ kind: 'INTAKE', title: 'Nhập kho' });
    expect(ev.detail).toContain('tình trạng khi nhập USED');
    expect(ev.detail).toContain('Hàng đổi trả, xước mặt lưng');
  });

  it('không có ghi chú thì nhật ký vẫn nêu tình trạng, không để đuôi thừa', async () => {
    const prisma = buildPrisma({ categoryCode: 'CAM', existingCount: 0 });
    await new MemsCatalogService(prisma, photoUrlSignerStub).createAsset({
      modelId: 'model-1',
      serialNumber: 'SN-005',
    });

    expect(prisma.memsAssetEvent.create.mock.calls[0][0].data.detail).toBe(
      'tình trạng khi nhập GOOD',
    );
  });
});

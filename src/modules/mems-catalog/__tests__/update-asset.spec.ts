import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

/**
 * Sửa thông tin một máy đã nằm trong kho.
 *
 * Hai thứ được canh ở đây: serial vẫn phải duy nhất toàn hệ thống (BR-04), và mọi lần sửa
 * phải để lại vết trong nhật ký vòng đời — máy không có quá khứ thì mọi lần đối chiếu về sau
 * đều phải tin vào trí nhớ của người sửa.
 */

const ASSET = {
  id: 'asset-1',
  asset_code: 'CAM-001',
  model_id: 'model-1',
  serial_number: 'SN-CU',
  location_id: 'loc-1',
  purchase_date: null,
  purchase_price: null,
  condition: 'GOOD',
  status: 'AVAILABLE',
};

function buildDeps(over: { asset?: any; duplicated?: any } = {}) {
  const asset = over.asset === undefined ? ASSET : over.asset;
  const tx = {
    memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
    memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
  };
  const prisma: any = {
    memsAsset: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.serial_number ? (over.duplicated ?? null) : asset,
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, tx };
}

describe('MemsCatalogService.updateAsset', () => {
  it('không có máy mang mã đó thì báo không tìm thấy', async () => {
    const { prisma } = buildDeps({ asset: null });
    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-999', { condition: 'GOOD' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('BR-04: đổi sang serial đã thuộc máy khác thì chặn và nêu rõ máy đang giữ', async () => {
    // Câu báo lỗi phải chỉ thẳng vào máy đang trùng: kho hay nhập nhầm lô đổi trả, mà câu
    // "serial đã tồn tại" trống trơn thì không tra ra được máy nào.
    const { prisma, tx } = buildDeps({
      duplicated: { id: 'asset-2', asset_code: 'CAM-007', serial_number: 'SN-MOI' },
    });

    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', { serialNumber: 'SN-MOI' } as any),
    ).rejects.toThrow(/CAM-007/);
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('giữ nguyên serial cũ thì không bị chính mình chặn', async () => {
    // Sửa tình trạng máy mà vẫn gửi kèm serial cũ là chuyện thường của form; coi đó là trùng
    // thì không ai sửa được gì.
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      serialNumber: 'SN-CU',
      condition: 'FAIR',
    } as any);

    expect(tx.memsAsset.update).toHaveBeenCalled();
  });

  it('trường bỏ trống thì giữ nguyên giá trị cũ, không ghi đè thành null', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { condition: 'FAIR' } as any);

    const data = tx.memsAsset.update.mock.calls[0][0].data;
    expect(data.condition).toBe('FAIR');
    expect(data.serial_number).toBe('SN-CU');
    expect(data.model_id).toBe('model-1');
    expect(data.location_id).toBe('loc-1');
  });

  it('mỗi lần sửa đều ghi một mốc vào nhật ký vòng đời', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { condition: 'FAIR' } as any);

    expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asset_id: 'asset-1', title: 'Cập nhật thông tin' }),
      }),
    );
  });
});

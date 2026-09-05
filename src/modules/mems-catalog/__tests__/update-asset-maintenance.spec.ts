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

function buildDeps(
  over: {
    asset?: any;
    duplicated?: any;
  } = {},
) {
  const asset = over.asset === undefined ? ASSET : over.asset;
  const tx = {
    memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
    memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
    memsMaintenance: {
      create: jest.fn(async ({ data }: any) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
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

/**
 * Bảo trì bị loại khỏi khả dụng qua bảng `MemsMaintenance`, KHÔNG qua cột trạng thái —
 * `UNDER_MAINTENANCE` cố ý không nằm trong `NOT_USABLE_STATUSES` để một chiếc máy không bị
 * trừ hai lần. Hệ quả: đổi mỗi cột trạng thái là chưa làm gì cả.
 */
describe('MemsCatalogService.updateAsset — đưa máy vào và ra khỏi bảo trì', () => {
  it('chuyển sang Bảo trì thì sinh lệnh bảo trì bỏ ngỏ điểm kết thúc', async () => {
    // Chỉ đổi cột trạng thái thì phép đếm khả dụng vẫn thấy máy rảnh trong mọi khoảng tương
    // lai, và nó được gán cho phiếu tiếp theo trong khi đang nằm ở chỗ thợ.
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      status: 'UNDER_MAINTENANCE',
      note: 'Gửi hãng thay cảm biến',
    } as any);

    expect(tx.memsMaintenance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          asset_id: 'asset-1',
          reason: 'Gửi hãng thay cảm biến',
          to_time: null,
        }),
      }),
    );
  });

  it('rời khỏi Bảo trì thì đóng lệnh còn bỏ ngỏ', async () => {
    // Không đóng thì lệnh bỏ ngỏ giữ máy bận vĩnh viễn — máy về kho rồi mà không ai mượn được,
    // và nhìn vào cột trạng thái thì mọi thứ trông vẫn bình thường.
    const { prisma, tx } = buildDeps({
      asset: { ...ASSET, status: 'UNDER_MAINTENANCE' },
    });
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'AVAILABLE' } as any);

    expect(tx.memsMaintenance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { asset_id: 'asset-1', to_time: null },
        data: { to_time: expect.any(Date) },
      }),
    );
  });

  it('sửa thứ khác mà vẫn ở Bảo trì thì không đụng tới lệnh bảo trì', async () => {
    // Ô select luôn gửi lại trạng thái hiện tại kèm mọi lần sửa serial hay vị trí. Coi đó là
    // một lần "chuyển sang bảo trì" thì mỗi lần sửa lại đẻ thêm một lệnh trùng.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'UNDER_MAINTENANCE' } });
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      status: 'UNDER_MAINTENANCE',
      locationId: 'loc-9',
    } as any);

    expect(tx.memsMaintenance.create).not.toHaveBeenCalled();
    expect(tx.memsMaintenance.updateMany).not.toHaveBeenCalled();
  });
});


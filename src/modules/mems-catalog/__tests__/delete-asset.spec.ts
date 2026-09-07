import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

/**
 * Chức năng: xoá một thiết bị khỏi kho.
 *
 * Vì sao đáng một file test riêng: đây là thao tác duy nhất đưa một chiếc máy ra khỏi mọi phép
 * đếm, và nó phải chặn đúng lúc. Chặn hụt thì máy đang ở ngoài công ty biến mất khỏi hệ thống —
 * không phiếu nào theo dõi nó nữa. Chặn thừa thì máy hỏng nằm lại kho vĩnh viễn.
 *
 * QĐ-07: không bao giờ xoá cứng. Bản ghi chỉ chuyển sang ngừng dùng để giữ trọn lịch sử mượn trả
 * và nhật ký vòng đời.
 */

const ASSET = {
  id: 'asset-1',
  asset_code: 'CAM-001',
  status: 'AVAILABLE',
  reservations: [],
  handoverLines: [],
};

function buildDeps(over: Partial<any> = {}) {
  const asset = over.asset === undefined ? ASSET : over.asset;
  const tx = {
    memsAsset: { update: jest.fn(async ({ data }: any) => ({ ...asset, ...data })) },
    memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
  };
  const prisma: any = {
    memsAsset: { findUnique: jest.fn(async (_args: any) => asset) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { service: new MemsCatalogService(prisma), prisma, tx };
}

describe('MemsCatalogService.deleteAsset — khi nào chặn', () => {
  it('máy đang mượn thì không xoá được', async () => {
    // Xoá được thì chiếc đang nằm ngoài công ty biến khỏi hệ thống mà vẫn chưa ai mang về.
    const { service, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

    await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('máy còn giữ chỗ cho phiếu sắp tới thì không xoá được', async () => {
    // Xoá đi là phiếu đã duyệt mất máy mà không báo gì, kho chỉ phát hiện lúc đứng ra bàn giao.
    const { service, tx } = buildDeps({
      asset: { ...ASSET, reservations: [{ id: 'rsv-1', status: 'CONFIRMED' }] },
    });

    await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('máy còn dòng bàn giao chưa khép của phiếu đang mượn thì không xoá được', async () => {
    const { service, tx } = buildDeps({
      asset: { ...ASSET, handoverLines: [{ id: 'hl-1' }] },
    });

    await expect(service.deleteAsset('CAM-001')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('chỉ hỏi giữ chỗ còn hiệu lực, không tính giữ chỗ đã nhả', async () => {
    // Giữ chỗ của phiếu đã huỷ hay đã trả xong mang trạng thái RELEASED; tính cả chúng thì một
    // chiếc máy từng được mượn sẽ không bao giờ xoá được nữa.
    const { service, prisma } = buildDeps();
    await service.deleteAsset('CAM-001');

    const include = prisma.memsAsset.findUnique.mock.calls[0][0].include;
    expect(include.reservations.where.status.in).toEqual(['TENTATIVE', 'CONFIRMED']);
  });

  it('máy không tồn tại thì báo không tìm thấy', async () => {
    const { service } = buildDeps({ asset: null });

    await expect(service.deleteAsset('CAM-999')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MemsCatalogService.deleteAsset — xoá mềm', () => {
  it('QĐ-07: đánh dấu ngừng dùng và thanh lý, KHÔNG xoá cứng bản ghi', async () => {
    // Xoá cứng là mất trọn lịch sử mượn trả của chiếc máy đó, kể cả những lượt đã quy trách nhiệm.
    const { service, tx } = buildDeps();

    await service.deleteAsset('CAM-001');

    expect(tx.memsAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_disabled: true, status: 'DISPOSED' } }),
    );
  });

  it('để lại một mốc trong nhật ký vòng đời', async () => {
    // Máy biến khỏi bảng kho mà không có dòng nào giải thích thì lần kiểm kê sau không ai truy được.
    const { service, tx } = buildDeps();

    await service.deleteAsset('CAM-001');

    expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asset_id: 'asset-1', title: 'Xóa khỏi kho' }),
      }),
    );
  });

  it('máy hỏng vẫn xoá được — không chặn thừa', async () => {
    const { service, tx } = buildDeps({ asset: { ...ASSET, status: 'BROKEN' } });

    await service.deleteAsset('CAM-001');

    expect(tx.memsAsset.update).toHaveBeenCalled();
  });
});

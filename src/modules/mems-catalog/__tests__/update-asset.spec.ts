import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemsCatalogService } from '../mems-catalog.service';

/**
 * Sửa và xoá một máy đã nằm trong kho.
 *
 * Ba thứ được canh: serial vẫn phải duy nhất toàn hệ thống (BR-04), mọi lần sửa phải để lại
 * vết trong nhật ký vòng đời, và máy đang mượn hoặc đang có lịch giữ chỗ thì không xoá được —
 * xoá lúc đó là chiếc máy vẫn ở ngoài mà kho không còn chỗ nào ghi nhận nó tồn tại.
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
  reservations: [],
  handoverLines: [],
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
  return { prisma, tx, asset };
}

describe('MemsCatalogService.updateAsset', () => {
  it('không có máy mang mã đó thì báo không tìm thấy', async () => {
    const { prisma } = buildDeps({ asset: null });
    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-999', { condition: 'GOOD' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mã viết thường vẫn tra ra đúng máy', async () => {
    // Mã sinh ra luôn viết hoa, còn đường dẫn thì người dùng gõ tay hoặc copy từ chỗ khác.
    // `assetDetail` và `inspect` đều chuẩn hoá, sửa với xoá mà không chuẩn hoá thì cùng một
    // chiếc máy lúc xem được lúc 404.
    const { prisma } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('cam-001', { condition: 'USED' } as any);

    expect(prisma.memsAsset.findUnique.mock.calls[0][0].where.asset_code).toBe('CAM-001');
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
      condition: 'USED',
    } as any);

    expect(tx.memsAsset.update).toHaveBeenCalled();
  });

  it('trường bỏ trống thì giữ nguyên giá trị cũ, không ghi đè thành null', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { condition: 'USED' } as any);

    const data = tx.memsAsset.update.mock.calls[0][0].data;
    expect(data.condition).toBe('USED');
    expect(data.serial_number).toBe('SN-CU');
    expect(data.model_id).toBe('model-1');
    expect(data.location_id).toBe('loc-1');
  });

  it('gỡ máy khỏi vị trí thì ghi null, không quay về vị trí cũ', async () => {
    // Chuỗi rỗng từ ô chọn "chưa xếp chỗ" khác hẳn với bỏ trống — một cái là cố ý gỡ ra.
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { locationId: '' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.location_id).toBeNull();
  });

  it('mỗi lần sửa đều ghi một mốc vào nhật ký vòng đời', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { condition: 'USED' } as any);

    expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asset_id: 'asset-1', title: 'Cập nhật thông tin' }),
      }),
    );
  });
});

describe('MemsCatalogService.updateAsset — trạng thái đặt tay', () => {
  it('kéo máy về bàn kiểm tra thì được', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      status: 'PENDING_INSPECTION',
    } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('PENDING_INSPECTION');
  });

  it('không đặt tay sang Bảo trì được', async () => {
    // Phép tính khả dụng đọc bảng lệnh bảo trì, không đọc cột trạng thái. Cho qua ở đây thì
    // máy nằm ở xưởng mà kho vẫn hứa nó cho người khác.
    const { prisma, tx } = buildDeps();
    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', {
        status: 'UNDER_MAINTENANCE',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('không đặt tay sang Đang mượn được', async () => {
    const { prisma } = buildDeps();
    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'ON_LOAN' } as any),
    ).rejects.toThrow(/bàn giao/i);
  });

  it('máy đang mượn thì chỉ đánh dấu Mất được', async () => {
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
    await new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'LOST' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('LOST');
  });

  it('máy đang mượn thì không đánh dấu hỏng từ xa được', async () => {
    const { prisma } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'BROKEN' } as any),
    ).rejects.toThrow(/nhận trả/i);
  });

  it('sửa serial của máy đang mượn vẫn được, miễn không đụng trạng thái', async () => {
    // Chặn theo trạng thái ĐÍCH chứ không chặn cả thao tác sửa: máy đang ở ngoài mà phát hiện
    // gõ nhầm serial thì vẫn phải sửa được ngay.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      serialNumber: 'SN-DUNG',
    } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.serial_number).toBe('SN-DUNG');
  });
});

describe('MemsCatalogService.deleteAsset', () => {
  it('không có máy mang mã đó thì báo không tìm thấy', async () => {
    const { prisma } = buildDeps({ asset: null });
    await expect(new MemsCatalogService(prisma).deleteAsset('CAM-999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('xoá là xoá MỀM, hồ sơ máy vẫn còn nguyên', async () => {
    // Xoá cứng thì mọi biên bản bàn giao và sự cố cũ mất chỗ neo, báo cáo tài sản thủng lỗ.
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).deleteAsset('CAM-001');

    expect(tx.memsAsset.update.mock.calls[0][0].data).toMatchObject({
      is_disabled: true,
      status: 'DISPOSED',
    });
  });

  it('máy đang mượn thì không xoá được', async () => {
    const { prisma } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
    await expect(new MemsCatalogService(prisma).deleteAsset('CAM-001')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('máy còn lịch giữ chỗ thì không xoá được', async () => {
    // Máy nằm trên kệ hôm nay nhưng đã hứa cho phiếu tuần sau. Xoá đi thì tới ngày đó kho
    // thiếu một chiếc mà không ai biết vì sao.
    const { prisma } = buildDeps({ asset: { ...ASSET, reservations: [{ id: 'r-1' }] } });
    await expect(new MemsCatalogService(prisma).deleteAsset('CAM-001')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('mã viết thường vẫn xoá đúng máy', async () => {
    const { prisma } = buildDeps();
    await new MemsCatalogService(prisma).deleteAsset('cam-001');

    expect(prisma.memsAsset.findUnique.mock.calls[0][0].where.asset_code).toBe('CAM-001');
  });

  it('xoá xong ghi một mốc vào nhật ký vòng đời', async () => {
    const { prisma, tx } = buildDeps();
    await new MemsCatalogService(prisma).deleteAsset('CAM-001');

    expect(tx.memsAssetEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asset_id: 'asset-1', title: 'Xóa khỏi kho' }),
      }),
    );
  });
});

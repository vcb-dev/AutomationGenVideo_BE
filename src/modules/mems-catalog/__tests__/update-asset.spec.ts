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
    activeReservations?: number;
    handoverCount?: number;
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
    memsReservation: { count: jest.fn(async () => over.activeReservations ?? 0) },
    memsHandoverLine: { count: jest.fn(async () => over.handoverCount ?? 0) },
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

describe('MemsCatalogService.updateAsset — đổi model khi máy đang được hứa cho ai đó', () => {
  it('máy còn giữ chỗ thì không đổi model được', async () => {
    // Giữ chỗ ghi ở MỨC MODEL (QĐ-01): phiếu đặt "một chiếc A7 IV" chứ không đặt đích danh máy.
    // Đổi model của một chiếc đang được ghim vào phiếu là rút chiếc đó khỏi phép đếm khả dụng
    // của model cũ mà không có lỗi nào báo — kho chỉ phát hiện vào đúng lúc đứng ra bàn giao.
    const { prisma, tx } = buildDeps({ activeReservations: 1 });

    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', { modelId: 'model-2' } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('máy không còn giữ chỗ nào thì đổi model bình thường', async () => {
    const { prisma, tx } = buildDeps({ activeReservations: 0 });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', { modelId: 'model-2' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.model_id).toBe('model-2');
  });

  it('giữ nguyên model thì không bị chính luật này chặn', async () => {
    // Form sửa luôn gửi lại model hiện tại kèm mọi lần đổi vị trí hay giá mua. Chặn cứng thì
    // máy đang có phiếu không sửa nổi vị trí.
    const { prisma, tx } = buildDeps({ activeReservations: 3 });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      modelId: 'model-1',
      locationId: 'loc-9',
    } as any);

    expect(tx.memsAsset.update).toHaveBeenCalled();
  });
});

describe('MemsCatalogService.updateAsset — trạng thái do quy trình sinh ra', () => {
  it.each(['ON_LOAN', 'POST_RETURN_CHECK'])(
    'không đặt tay được sang %s',
    async (status) => {
      // Đặt tay ON_LOAN là đi vòng qua màn Bàn giao: máy thành "đang mượn" mà không có biên bản
      // nào, không ảnh, không ai ký — đúng thứ MEMS sinh ra để dẹp.
      const { prisma, tx } = buildDeps();
      await expect(
        new MemsCatalogService(prisma).updateAsset('CAM-001', { status } as any),
      ).rejects.toThrow(/Bàn giao hoặc Nhận trả/);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    },
  );

  it('máy ĐANG ở trạng thái đó thì gửi lại chính nó vẫn được', async () => {
    // Ô select hiện trạng thái đang có làm lựa chọn đầu tiên, nên form sửa vị trí của một máy
    // đang mượn luôn gửi kèm ON_LOAN. Chặn cứng thì không sửa nổi vị trí máy đang ở ngoài.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });
    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      status: 'ON_LOAN',
      locationId: 'loc-9',
    } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('ON_LOAN');
  });

  it.each(['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'])(
    'máy đang mượn không đặt tay về %s được',
    async (status) => {
      // Luật cũ chỉ chặn chiều ĐI VÀO. Chiều đi ra bỏ ngỏ nên một chiếc máy đang ở ngoài có thể
      // bị sửa tay về Sẵn sàng: nó quay lại phép đếm khả dụng và danh sách máy gán được, trong
      // khi phiếu vẫn Đang mượn và chưa ai mang máy về. Máy chỉ rời ON_LOAN qua màn Nhận trả.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

      await expect(
        new MemsCatalogService(prisma).updateAsset('CAM-001', { status } as any),
      ).rejects.toThrow(/Nhận trả/);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    },
  );

  it('máy đang mượn VẪN đánh dấu Mất được', async () => {
    // Lối thoát duy nhất và cần thiết: chiếc máy không bao giờ quay về thì phải ghi nhận được
    // ngay, không thể bắt chờ một biên bản nhận trả sẽ không bao giờ có. An toàn vì LOST nằm
    // trong nhóm không cho mượn, nên máy rời khỏi phép đếm khả dụng chứ không quay lại.
    //
    // Màn sửa thiết bị bên FE cũng chỉ chào đúng lựa chọn này khi máy đang mượn
    // (`manualStatusOptionsFor`), nên chặn nốt là hiện nút mà bấm vào ăn 400.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'ON_LOAN' } });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'LOST' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('LOST');
  });

  it.each(['AVAILABLE', 'UNDER_MAINTENANCE', 'BROKEN'])(
    'máy chờ kiểm tra sau trả không đặt tay về %s được',
    async (status) => {
      // Cửa đúng để rời POST_RETURN_CHECK là màn Kiểm tra (`POST /mems/assets/:code/inspect`),
      // vì chỉ ở đó kết luận Bảo trì mới sinh kèm lệnh bảo trì — đổi mỗi cột trạng thái thì máy
      // nằm ở xưởng vẫn hiện là rảnh trong mọi khoảng tương lai.
      //
      // Chốt này từng phải để mở vì giao diện chưa dựng màn Kiểm tra; giờ màn đó đã có
      // (`/dashboard/equipment/inspection`) nên đóng lại được mà không nhốt máy.
      const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'POST_RETURN_CHECK' } });

      await expect(
        new MemsCatalogService(prisma).updateAsset('CAM-001', { status } as any),
      ).rejects.toThrow(/Kiểm tra/);

      expect(tx.memsAsset.update).not.toHaveBeenCalled();
    },
  );

  it('máy chờ kiểm tra sau trả VẪN đánh dấu Mất được', async () => {
    // Màn Kiểm tra chỉ chào ba kết luận Đạt/Bảo trì/Hỏng, không có Mất. Chặn nốt lối này thì
    // một chiếc biến mất khỏi bàn kiểm tra không ghi nhận được ở đâu cả.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'POST_RETURN_CHECK' } });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'LOST' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('LOST');
  });

  it('máy ở trạng thái thường vẫn đổi trạng thái tay bình thường', async () => {
    // Không siết nhầm sang các trạng thái mà kho vẫn phải tự đặt được.
    const { prisma, tx } = buildDeps({ asset: { ...ASSET, status: 'AVAILABLE' } });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', { status: 'BROKEN' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.status).toBe('BROKEN');
  });
});

/**
 * BR-04 nói serial "không sửa được sau khi tạo", nhưng code lại cho sửa tự do — hai bên nói
 * ngược nhau và không ai để ý.
 *
 * Chốt ở đường giữa: serial là mốc truy trách nhiệm KỂ TỪ LÚC máy được ghi vào một biên bản bàn
 * giao. Trước đó nó mới chỉ là một ô nhập có thể gõ nhầm, khoá cứng thì lỗi chính tả lúc nhập
 * kho không bao giờ sửa được và người ta sẽ xoá máy đi tạo lại — mất luôn nhật ký vòng đời.
 */
describe('MemsCatalogService.updateAsset — serial sau khi máy đã đi vào biên bản', () => {
  it('máy chưa từng bàn giao thì sửa serial được', async () => {
    const { prisma, tx } = buildDeps({ handoverCount: 0 });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', { serialNumber: 'SN-MOI' } as any);

    expect(tx.memsAsset.update.mock.calls[0][0].data.serial_number).toBe('SN-MOI');
  });

  it('máy đã từng bàn giao thì KHÔNG đổi serial được nữa', async () => {
    const { prisma, tx } = buildDeps({ handoverCount: 3 });

    await expect(
      new MemsCatalogService(prisma).updateAsset('CAM-001', { serialNumber: 'SN-MOI' } as any),
    ).rejects.toThrow(/biên bản/);

    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('gửi lại đúng serial cũ thì không bị chặn dù máy đã bàn giao', async () => {
    // Form sửa luôn gửi kèm serial hiện tại khi người dùng chỉ đổi vị trí hay giá mua.
    const { prisma, tx } = buildDeps({ handoverCount: 3 });

    await new MemsCatalogService(prisma).updateAsset('CAM-001', {
      serialNumber: 'SN-CU',
      locationId: 'loc-9',
    } as any);

    expect(tx.memsAsset.update).toHaveBeenCalled();
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { InspectionService } from '../inspection.service';
import { photoUrlSignerStub } from '../../../common/mems/__tests__/photo-url-signer.stub';

function buildDeps(over: Partial<any> = {}) {
  const asset = {
    id: 'asset-1',
    asset_code: 'CAM-001',
    status: 'POST_RETURN_CHECK',
    condition: 'USED',
    ...over,
  };
  const created: any = { events: [], maintenances: [], updates: [] };
  const tx = {
    memsAsset: {
      findUnique: jest.fn(async () => (over.missing ? null : asset)),
      update: jest.fn(async ({ data }: any) => {
        created.updates.push(data);
        return { ...asset, ...data };
      }),
    },
    memsMaintenance: {
      create: jest.fn(async ({ data }: any) => {
        created.maintenances.push(data);
        return data;
      }),
    },
    memsAssetEvent: {
      create: jest.fn(async ({ data }: any) => {
        created.events.push(data);
        return data;
      }),
    },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx, created };
}

describe('InspectionService.inspect', () => {
  it('kết luận đạt thì máy về Sẵn sàng — mắt xích duy nhất đưa máy trở lại kho', async () => {
    // Thiếu bước này thì máy mới nhập và máy trả về bị trầy đều nằm lại bàn kiểm tra vĩnh viễn.
    const { prisma, created } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', {
      result: 'AVAILABLE',
      condition: 'GOOD',
    });

    expect(created.updates[0]).toEqual({ status: 'AVAILABLE', condition: 'GOOD' });
  });

  it('bỏ trống tình trạng thì giữ nguyên tình trạng cũ', async () => {
    const { prisma, created } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', { result: 'AVAILABLE' });

    expect(created.updates[0]).toEqual({ status: 'AVAILABLE', condition: 'USED' });
  });

  it('kết luận bảo trì thì sinh luôn lệnh bảo trì, không chỉ đổi trạng thái', async () => {
    // Phép tính khả dụng đọc bảng bảo trì chứ không đọc cột trạng thái: chỉ đổi trạng thái thì
    // máy vẫn hiện là rảnh trong mọi khoảng tương lai.
    const { prisma, created } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', {
      result: 'UNDER_MAINTENANCE',
      note: 'Cháy nguồn',
    });

    expect(created.maintenances[0]).toMatchObject({ asset_id: 'asset-1', reason: 'Cháy nguồn' });
  });

  it('lệnh bảo trì để ngỏ điểm kết thúc', async () => {
    // Đoán bừa một ngày trả xưởng thì tới hạn máy tự "rảnh" trong khi vẫn đang nằm ở xưởng.
    const { prisma, created } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', {
      result: 'UNDER_MAINTENANCE',
    });

    expect(created.maintenances[0].to_time).toBeNull();
    expect(created.maintenances[0].reason).toBe('Kết luận sau kiểm tra');
  });

  it('kết luận đạt thì KHÔNG sinh lệnh bảo trì', async () => {
    const { prisma, tx } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', { result: 'AVAILABLE' });

    expect(tx.memsMaintenance.create).not.toHaveBeenCalled();
  });

  it('máy vừa nhập kho cũng kiểm tra được', async () => {
    const { prisma, created } = buildDeps({ status: 'PENDING_INSPECTION', condition: 'GOOD' });
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', { result: 'AVAILABLE' });

    expect(created.updates[0].status).toBe('AVAILABLE');
  });

  it('máy đang mượn thì không kết luận kiểm tra được', async () => {
    // Đổi trạng thái từ đây là đi vòng qua nghiệp vụ tiếp nhận trả.
    const { prisma } = buildDeps({ status: 'ON_LOAN' });
    await expect(
      new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', { result: 'AVAILABLE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('máy đã sẵn sàng rồi thì cũng không kiểm tra lại', async () => {
    const { prisma } = buildDeps({ status: 'AVAILABLE' });
    await expect(
      new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', { result: 'AVAILABLE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('mã máy không tồn tại thì báo không tìm thấy', async () => {
    const { prisma } = buildDeps({ missing: true });
    await expect(
      new InspectionService(prisma, photoUrlSignerStub).inspect('KHONG-CO', 'thu-kho', { result: 'AVAILABLE' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ghi nhật ký vòng đời kèm chuyển trạng thái', async () => {
    const { prisma, created } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('CAM-001', 'thu-kho', {
      result: 'AVAILABLE',
      condition: 'GOOD',
      note: 'Lau cảm biến',
    });

    expect(created.events[0]).toMatchObject({ kind: 'INSPECTED', actor_id: 'thu-kho' });
    expect(created.events[0].detail).toContain('POST_RETURN_CHECK → AVAILABLE');
    expect(created.events[0].detail).toContain('USED → GOOD');
    expect(created.events[0].detail).toContain('Lau cảm biến');
  });

  it('tra máy theo mã viết thường vẫn ra', async () => {
    const { prisma, tx } = buildDeps();
    await new InspectionService(prisma, photoUrlSignerStub).inspect('cam-001', 'thu-kho', { result: 'AVAILABLE' });

    expect(tx.memsAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { asset_code: 'CAM-001' } }),
    );
  });
});

describe('InspectionService.listPending — ảnh đối chiếu ở bàn kiểm tra', () => {
  function buildPrisma(photos: any[]) {
    return {
      memsAsset: { findMany: jest.fn(async () => [{ id: 'a1', asset_code: 'CAM-001', photos }]) },
    } as any;
  }

  it('chỉ lấy ảnh HỒ SƠ, không lấy ảnh biên bản', async () => {
    // Ảnh bàn giao và ảnh nhận trả nằm CÙNG bảng với ảnh hồ sơ. Không lọc theo `purpose` thì
    // người kiểm mở màn ra thấy một tấm chụp vết xước của lượt mượn nào đó, tưởng là ảnh gốc
    // của máy rồi kết luận sai.
    const prisma = buildPrisma([]);
    await new InspectionService(prisma, photoUrlSignerStub).listPending();

    const where = prisma.memsAsset.findMany.mock.calls[0][0].include.photos.where;
    expect(where.purpose).toBe('CATALOG');
    expect(where.is_primary).toBe(true);
  });

  it('mỗi máy chỉ lấy một ảnh', async () => {
    // Màn kiểm tra là danh sách; kéo hết ảnh của từng máy về là tải thừa hàng chục tấm cho một
    // lần mở màn, mà người kiểm chỉ cần một tấm để đối chiếu.
    const prisma = buildPrisma([]);
    await new InspectionService(prisma, photoUrlSignerStub).listPending();

    expect(prisma.memsAsset.findMany.mock.calls[0][0].include.photos.take).toBe(1);
  });

  it('URL ảnh trả về đã đi qua bộ ký', async () => {
    // Route phục vụ ảnh là công khai, nó chỉ nhận đường dẫn có token còn hạn. Quên ký thì ảnh
    // hỏng hết trên màn mà không có lỗi nào trong console.
    const signer = { signAll: jest.fn((photos: any[]) => photos.map((x) => ({ ...x, url: x.url + '?t=k' }))) } as any;
    const prisma = buildPrisma([{ id: 'p1', url: '/api/mems/photos/x.jpg' }]);

    const rows = await new InspectionService(prisma, signer).listPending();

    expect(signer.signAll).toHaveBeenCalled();
    expect(rows[0].photos[0].url).toBe('/api/mems/photos/x.jpg?t=k');
  });
});

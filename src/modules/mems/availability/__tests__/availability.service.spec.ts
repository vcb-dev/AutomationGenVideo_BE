import { NotFoundException } from '@nestjs/common';
import { AvailabilityService } from '../availability.service';

const d = (iso: string) => new Date(iso);

function buildPrisma(opts: {
  bufferMinutes: number;
  assetCount: number;
  reservations: Array<{ from_time: Date; buffer_to_time: Date }>;
  maintenances: Array<{ from_time: Date; to_time: Date | null }>;
}) {
  return {
    memsAssetModel: {
      // `findUnique` chứ không phải `findUniqueOrThrow`: service tự ném NotFound để người gọi
      // nhận 404 thay vì 500 kèm thông điệp Prisma.
      findUnique: jest.fn(async () => ({
        id: 'model-1',
        category: { buffer_minutes: opts.bufferMinutes },
      })),
    },
    memsAsset: { count: jest.fn(async () => opts.assetCount) },
    memsReservation: { findMany: jest.fn(async () => opts.reservations) },
    memsMaintenance: { findMany: jest.fn(async () => opts.maintenances) },
  } as any;
}

describe('AvailabilityService.check', () => {
  it('cộng buffer của danh mục vào thời điểm kết thúc', async () => {
    const prisma = buildPrisma({
      bufferMinutes: 120,
      assetCount: 2,
      reservations: [],
      maintenances: [],
    });
    const service = new AvailabilityService(prisma);

    const out = await service.check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T08:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 1,
    });

    expect(out.bufferMinutes).toBe(120);
    expect(out.bufferedTo.toISOString()).toBe('2026-08-10T14:00:00.000Z');
  });

  it('chỉ đếm máy còn dùng được, loại Chờ kiểm tra và máy ngừng sử dụng', async () => {
    const prisma = buildPrisma({
      bufferMinutes: 0,
      assetCount: 3,
      reservations: [],
      maintenances: [],
    });
    const service = new AvailabilityService(prisma);

    await service.check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T08:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 1,
    });

    const where = prisma.memsAsset.count.mock.calls[0][0].where;
    expect(where.is_disabled).toBe(false);
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([
        'PENDING_INSPECTION',
        'POST_RETURN_CHECK',
        'BROKEN',
        'LOST',
        'DISPOSED',
      ]),
    );
  });

  it('máy đang nằm trên bàn Kiểm tra sau trả KHÔNG tính là cho mượn được', async () => {
    // Ca hỏng thật: người mượn trả máy nguyên vẹn nhưng mất sạc. BR-42 đẩy máy sang
    // POST_RETURN_CHECK, còn `condition` giữ nguyên GOOD — nên mọi bộ lọc theo TÌNH TRẠNG đều
    // cho nó lọt, chỉ cột TRẠNG THÁI mới biết nó chưa dùng được. Bỏ sót thì chiếc máy thiếu
    // sạc đi thẳng sang người mượn kế tiếp, đúng thứ BR-42 sinh ra để chặn.
    const prisma = buildPrisma({
      bufferMinutes: 0,
      assetCount: 2,
      reservations: [],
      maintenances: [],
    });

    await new AvailabilityService(prisma).check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T08:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 1,
    });

    expect(prisma.memsAsset.count.mock.calls[0][0].where.status.notIn).toContain(
      'POST_RETURN_CHECK',
    );
  });

  it('máy đang bảo trì KHÔNG bị loại bằng cột trạng thái, để không trừ hai lần', async () => {
    // Bảo trì đã bị trừ qua bảng `MemsMaintenance`. Chặn thêm ở cột trạng thái nữa thì một
    // chiếc máy bị trừ hai lần và tổng khả dụng báo thiếu so với thực tế.
    const prisma = buildPrisma({
      bufferMinutes: 0,
      assetCount: 2,
      reservations: [],
      maintenances: [],
    });

    await new AvailabilityService(prisma).check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T08:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 1,
    });

    expect(prisma.memsAsset.count.mock.calls[0][0].where.status.notIn).not.toContain(
      'UNDER_MAINTENANCE',
    );
  });

  it('không đếm bản ghi giữ chỗ đã nhả', async () => {
    const prisma = buildPrisma({
      bufferMinutes: 0,
      assetCount: 3,
      reservations: [],
      maintenances: [],
    });
    const service = new AvailabilityService(prisma);

    await service.check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T08:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 1,
    });

    const where = prisma.memsReservation.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['TENTATIVE', 'CONFIRMED']);
  });

  it('báo thiếu bao nhiêu khi không đủ số lượng xin', async () => {
    const prisma = buildPrisma({
      bufferMinutes: 0,
      assetCount: 2,
      reservations: [
        { from_time: d('2026-08-10T08:00:00Z'), buffer_to_time: d('2026-08-10T18:00:00Z') },
      ],
      maintenances: [],
    });
    const service = new AvailabilityService(prisma);

    const out = await service.check({
      modelId: 'model-1',
      fromTime: d('2026-08-10T09:00:00Z'),
      toTime: d('2026-08-10T12:00:00Z'),
      quantity: 2,
    });

    expect(out.available).toBe(1);
    expect(out.enough).toBe(false);
    expect(out.shortBy).toBe(1);
  });
});

/**
 * Model không tồn tại là lỗi của NGƯỜI GỌI, phải trả 404 chứ không phải 500.
 *
 * `findUniqueOrThrow` ném `PrismaClientKnownRequestError`, mà lỗi đó không phải `HttpException`
 * nên bộ lọc toàn cục xếp vào 500 và trả nguyên thông điệp của Prisma về client — vừa sai mã
 * lỗi, vừa lộ tên model và hình dạng truy vấn. `modelId` đã qua `@IsUUID` nên chỉ còn đúng ca
 * "UUID hợp lệ nhưng không có trong kho", và ca đó xảy ra thật khi một model bị ngừng dùng
 * trong lúc người mượn còn đang mở form.
 */
describe('AvailabilityService — model không tồn tại', () => {
  const prismaWithoutModel = () =>
    ({
      memsAssetModel: { findUnique: jest.fn(async () => null) },
      memsAsset: { count: jest.fn(async () => 0) },
      memsReservation: { findMany: jest.fn(async () => []) },
      memsMaintenance: { findMany: jest.fn(async () => []) },
    }) as any;

  it('check() báo không tìm thấy thay vì lỗi hệ thống', async () => {
    const service = new AvailabilityService(prismaWithoutModel());

    await expect(
      service.check({
        modelId: 'e0f0a0b0-0000-4000-8000-000000000000',
        fromTime: d('2026-08-15T02:00:00Z'),
        toTime: d('2026-08-16T02:00:00Z'),
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('freeAssets() cũng vậy', async () => {
    const service = new AvailabilityService(prismaWithoutModel());

    await expect(
      service.freeAssets({
        modelId: 'e0f0a0b0-0000-4000-8000-000000000000',
        fromTime: d('2026-08-15T02:00:00Z'),
        toTime: d('2026-08-16T02:00:00Z'),
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('check() — bỏ qua giữ chỗ của chính phiếu', () => {
  function buildPrisma() {
    return {
      memsAssetModel: { findUnique: jest.fn(async () => ({ id: 'm-1', category: { buffer_minutes: 60 } })) },
      memsAsset: { count: jest.fn(async () => 1) },
      memsReservation: { findMany: jest.fn(async () => []) },
      memsMaintenance: { findMany: jest.fn(async () => []) },
    } as any;
  }
  const ARGS = {
    modelId: 'm-1',
    fromTime: new Date('2026-10-19T18:00:00Z'),
    toTime: new Date('2026-10-20T10:00:00Z'),
    quantity: 1,
  };

  it('mặc định đếm mọi giữ chỗ giao nhau như cũ', async () => {
    const prisma = buildPrisma();
    await new AvailabilityService(prisma).check(ARGS);
    expect(prisma.memsReservation.findMany.mock.calls[0][0].where.request_line).toBeUndefined();
  });

  it('khi dời hạn trả thì không tính giữ chỗ của chính phiếu đó', async () => {
    const prisma = buildPrisma();
    await new AvailabilityService(prisma).check({ ...ARGS, excludeRequestId: 'req-1' });
    expect(prisma.memsReservation.findMany.mock.calls[0][0].where.request_line).toEqual({
      request_id: { not: 'req-1' },
    });
  });
});

describe('freeAssets() — máy quá hạn chưa trả', () => {
  function buildPrisma() {
    return {
      memsAssetModel: { findUnique: jest.fn(async () => ({ id: 'm-1', category: { buffer_minutes: 0 } })) },
      memsAsset: { findMany: jest.fn(async () => [{ id: 'a-1' }, { id: 'a-2' }]) },
      memsReservation: { findMany: jest.fn(async () => []) },
      memsMaintenance: { findMany: jest.fn(async () => []) },
      memsHandoverLine: { findMany: jest.fn(async () => [{ asset_id: 'a-2' }]) },
    } as any;
  }
  const ARGS = { modelId: 'm-1', fromTime: new Date('2026-10-25T02:00:00Z'), toTime: new Date('2026-10-26T02:00:00Z') };

  it('ẩn máy quá hạn chưa trả khỏi danh sách', async () => {
    const free = await new AvailabilityService(buildPrisma()).freeAssets(ARGS);
    expect(free.map((a: any) => a.id)).toEqual(['a-1']);
  });

  it('chỉ xét lượt giao chưa có biên bản nhận trả và đã quá hạn', async () => {
    const prisma = buildPrisma();
    await new AvailabilityService(prisma).freeAssets(ARGS);
    const where = prisma.memsHandoverLine.findMany.mock.calls[0][0].where;
    expect(where.asset).toEqual({ model_id: 'm-1' });
    expect(where.returnLines).toEqual({ none: {} });
    expect(where.handover.request.to_time.lt).toBeInstanceOf(Date);
  });
});

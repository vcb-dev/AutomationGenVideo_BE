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
      findUniqueOrThrow: jest.fn(async () => ({
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
      expect.arrayContaining(['PENDING_INSPECTION', 'BROKEN', 'LOST', 'DISPOSED']),
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

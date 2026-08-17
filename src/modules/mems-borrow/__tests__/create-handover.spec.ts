import { BadRequestException, ConflictException } from '@nestjs/common';
import { HandoverService } from '../handover.service';

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
    status: 'PREPARING',
    lines: [{ id: 'line-1', reservations: [{ asset_id: 'asset-1' }, { asset_id: 'asset-2' }] }],
    ...over,
  };
  const created: any = { lines: [], photos: [], events: [], assetUpdates: [] };
  const tx = {
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsHandover: {
      create: jest.fn(async ({ data }: any) => ({ id: 'ho-1', ...data })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'ho-1', lines: created.lines })),
    },
    memsHandoverLine: {
      create: jest.fn(async ({ data }: any) => {
        created.lines.push(data);
        return { id: `hl-${created.lines.length}`, ...data };
      }),
    },
    memsHandoverPhoto: {
      createMany: jest.fn(async ({ data }: any) => {
        created.photos.push(...data);
        return { count: data.length };
      }),
    },
    memsHandoverAccessory: { createMany: jest.fn(async () => ({ count: 1 })) },
    memsAsset: {
      update: jest.fn(async ({ where, data }: any) => {
        created.assetUpdates.push({ ...where, ...data });
        return data;
      }),
    },
    memsAssetEvent: {
      create: jest.fn(async ({ data }: any) => {
        created.events.push(data);
        return data;
      }),
    },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx, created };
}

const DTO = {
  receivedBy: 'Lê Thị C',
  units: [
    { assetId: 'asset-1', condition: 'GOOD', photoKeys: ['k1'] },
    { assetId: 'asset-2', condition: 'USED', photoKeys: ['k2', 'k3'] },
  ],
};

describe('HandoverService.create', () => {
  it('bàn giao xong thì máy sang Đang mượn và phiếu sang Đang mượn', async () => {
    const { prisma, tx, created } = buildDeps();
    await new HandoverService(prisma).create('req-1', 'user-1', DTO);

    expect(created.assetUpdates).toEqual([
      { id: 'asset-1', status: 'ON_LOAN', condition: 'GOOD' },
      { id: 'asset-2', status: 'ON_LOAN', condition: 'USED' },
    ]);
    expect(tx.memsBorrowRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ON_LOAN' } }),
    );
  });

  it('BR-26: thiếu ảnh là chặn cứng, không ghi gì cả', async () => {
    // Không ảnh thì lúc nhận lại mọi tranh cãi về vết xước thành lời khai đối lời khai.
    const { prisma, tx } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [{ assetId: 'asset-1', condition: 'GOOD', photoKeys: [] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.memsHandover.create).not.toHaveBeenCalled();
  });

  it('phụ kiện thiếu vẫn bàn giao được, chỉ ghi lại', async () => {
    // Chặn cứng sẽ khiến người ta tick bừa cho xong, mất luôn giá trị đối chiếu lúc nhận lại.
    const { prisma, tx } = buildDeps();
    await new HandoverService(prisma).create('req-1', 'user-1', {
      ...DTO,
      units: [
        {
          assetId: 'asset-1',
          condition: 'GOOD',
          photoKeys: ['k1'],
          accessories: [{ accessoryId: 'acc-1', isPresent: false }],
        },
      ],
    });

    expect(tx.memsHandoverAccessory.createMany).toHaveBeenCalled();
    expect(tx.memsBorrowRequest.update).toHaveBeenCalled();
  });

  it('máy chưa được gán cho phiếu thì không có trong biên bản', async () => {
    const { prisma } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [{ assetId: 'asset-lạ', condition: 'GOOD', photoKeys: ['k1'] }],
      }),
    ).rejects.toThrow(/chưa được gán/);
  });

  it('phiếu chưa qua bước chuẩn bị thì chưa bàn giao được', async () => {
    const { prisma } = buildDeps({ status: 'APPROVED' });
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', DTO),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ghi nhật ký vòng đời cho từng máy', async () => {
    // Màn chi tiết máy đọc bảng này; không ghi thì lịch sử thủng một mắt xích.
    const { prisma, created } = buildDeps();
    await new HandoverService(prisma).create('req-1', 'user-1', DTO);

    expect(created.events).toHaveLength(2);
    expect(created.events[0]).toMatchObject({ kind: 'HANDED_OVER', asset_id: 'asset-1' });
  });

  it('lưu đủ số ảnh của từng máy', async () => {
    const { prisma, created } = buildDeps();
    await new HandoverService(prisma).create('req-1', 'user-1', DTO);

    expect(created.photos).toHaveLength(3);
  });
});

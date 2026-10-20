import { BadRequestException } from '@nestjs/common';
import { HandoverService } from '../src/modules/mems-borrow/handover.service';

/**
 * Kiểm thử tính năng tự động kế thừa ảnh từ phiếu mượn của người mượn sang biên bản bàn giao:
 * Khi người mượn đã đính kèm ảnh thực tế lúc tạo phiếu (qua quét QR điện thoại hoặc tải ảnh),
 * người duyệt / thủ kho không bắt buộc phải chụp lại ảnh mà hệ thống tự động kế thừa làm bằng chứng bàn giao.
 */

const ANH_SAN_CO = '11111111-1111-4111-8111-111111111111';

function setup(requestOverrides: Partial<any> = {}) {
  const request = {
    id: 'req-auto-1',
    request_code: 'REQ-20261020-001',
    status: 'PREPARING',
    lines: [{ id: 'line-1', reservations: [{ asset_id: 'asset-macro-1' }] }],
    ...requestOverrides,
  };

  const created: any = {
    lines: [],
    photos: [],
    assetPhotos: [],
    events: [],
    assetUpdates: [],
  };

  const tx = {
    memsAssetPhoto: {
      findMany: jest.fn(async ({ where }: any) =>
        created.assetPhotos.filter((p: any) => (where.id.in as string[]).includes(p.id)),
      ),
      create: jest.fn(async ({ data }: any) => {
        const id = `55555555-5555-4555-8555-${String(created.assetPhotos.length + 1).padStart(12, '0')}`;
        const item = { id, ...data };
        created.assetPhotos.push(item);
        return item;
      }),
    },
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsHandover: {
      create: jest.fn(async ({ data }: any) => ({ id: 'ho-auto-1', ...data })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'ho-auto-1', lines: created.lines })),
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
      findMany: jest.fn(async ({ where }: any) =>
        (where.id.in as string[]).map((id) => ({ asset_code: id.toUpperCase() })),
      ),
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

describe('Tự động kế thừa ảnh người mượn khi bàn giao (MemsHandover)', () => {
  it('tự động tạo ảnh MemsAssetPhoto và gán bằng chứng bàn giao khi phiếu đã có ảnh từ người mượn', async () => {
    const { prisma, tx, created } = setup({
      note: JSON.stringify({
        text: 'Quay MV ca nhạc ngoài trời, đã đính kèm ảnh lens',
        photos: ['https://storage.vcb.vn/mems/sample-lens-borrower.jpg'],
      }),
    });

    const service = new HandoverService(prisma);
    await service.create('req-auto-1', 'admin-user-id', {
      receivedBy: 'nvmedia',
      units: [
        {
          assetId: 'asset-macro-1',
          condition: 'GOOD',
          photoKeys: [], // Không truyền ảnh riêng vì đã có ảnh người mượn
        },
      ],
    });

    // Hệ thống tự động tạo MemsAssetPhoto cho thiết bị được giao
    expect(created.assetPhotos).toHaveLength(1);
    expect(created.assetPhotos[0]).toMatchObject({
      asset_id: 'asset-macro-1',
      url: 'https://storage.vcb.vn/mems/sample-lens-borrower.jpg',
      purpose: 'HANDOVER',
    });

    // Biên bản bàn giao lưu đúng bằng chứng ảnh
    expect(created.photos).toHaveLength(1);
    expect(tx.memsHandover.create).toHaveBeenCalled();
    expect(tx.memsBorrowRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ON_LOAN' } }),
    );
  });

  it('vẫn chặn bàn giao nếu cả người mượn và người duyệt đều không cung cấp ảnh nào', async () => {
    const { prisma, tx } = setup({
      note: JSON.stringify({ text: 'Phiếu mượn không có ảnh đính kèm', photos: [] }),
    });

    const service = new HandoverService(prisma);
    await expect(
      service.create('req-auto-1', 'admin-user-id', {
        receivedBy: 'nvmedia',
        units: [
          {
            assetId: 'asset-macro-1',
            condition: 'GOOD',
            photoKeys: [],
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { HandoverService } from '../handover.service';

/**
 * Ảnh đã thật sự nằm trong kho ảnh của máy.
 *
 * `photoKeys` là ID của bản ghi `MemsAssetPhoto` do chính máy chủ sinh ra sau khi nhận file,
 * KHÔNG phải tên file trên máy người dùng. Bản trước nhận thẳng chuỗi client gửi lên nên biên
 * bản ghi "3 ảnh" mà không ảnh nào mở được — điều kiện cứng của BR-26 chỉ còn là hình thức.
 */
const ANH_CUA_MAY_1 = '11111111-1111-4111-8111-111111111111';
const ANH_CUA_MAY_2 = '22222222-2222-4222-8222-222222222222';
const ANH_CUA_MAY_2B = '22222222-2222-4222-8222-222222222223';
/** ID đúng dạng UUID nhưng không có trong kho ảnh — client bịa ra hoặc ảnh đã bị xoá. */
const ANH_KHONG_TON_TAI = '99999999-9999-4999-8999-999999999999';

const KHO_ANH = [
  { id: ANH_CUA_MAY_1, asset_id: 'asset-1' },
  { id: ANH_CUA_MAY_2, asset_id: 'asset-2' },
  { id: ANH_CUA_MAY_2B, asset_id: 'asset-2' },
];

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
    memsAssetPhoto: {
      findMany: jest.fn(async ({ where }: any) =>
        KHO_ANH.filter((p) => (where.id.in as string[]).includes(p.id)),
      ),
    },
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
      // Chỉ dùng để đọc mã máy khi báo lỗi biên bản thiếu máy.
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

const DTO = {
  receivedBy: 'Lê Thị C',
  units: [
    { assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_1] },
    { assetId: 'asset-2', condition: 'USED', photoKeys: [ANH_CUA_MAY_2, ANH_CUA_MAY_2B] },
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
          photoKeys: [ANH_CUA_MAY_1],
          accessories: [{ accessoryId: 'acc-1', isPresent: false }],
        },
        { assetId: 'asset-2', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_2] },
      ],
    });

    expect(tx.memsHandoverAccessory.createMany).toHaveBeenCalled();
    expect(tx.memsBorrowRequest.update).toHaveBeenCalled();
  });

  it('biên bản thiếu máy đã gán thì bị chặn, nêu đích danh máy nào', async () => {
    // Cho qua thì phiếu vẫn chuyển sang Đang mượn và cửa bàn giao đóng lại vĩnh viễn — lần gọi
    // sau bị chặn vì trạng thái không còn là PREPARING. Chiếc bị bỏ quên kẹt luôn: không giao
    // được, không có gì để nhận trả, mà giữ chỗ của nó thì không bao giờ được nhả.
    const { prisma, tx } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [{ assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_1] }],
      }),
    ).rejects.toThrow(/thiếu 1 máy.*ASSET-2/s);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
  });

  it('máy chưa được gán cho phiếu thì không có trong biên bản', async () => {
    const { prisma } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [{ assetId: 'asset-lạ', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_1] }],
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

  it('BR-26: khoá ảnh không có trong kho ảnh thì chặn, không ghi gì cả', async () => {
    // Đây mới là chỗ BR-26 thật sự đứng hay đổ. Trước đây `photoKeys` là chuỗi client tự đặt và
    // BE ghi thẳng xuống, nên biên bản luôn "đủ ảnh" kể cả khi không tấm nào tồn tại — đúng thứ
    // mà điều kiện cứng này sinh ra để chặn.
    const { prisma, tx } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [
          { assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_KHONG_TON_TAI] },
          { assetId: 'asset-2', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_2] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
  });

  it('BR-26: tên file do client đặt không còn được nhận làm ảnh', async () => {
    // Chính xác chuỗi mà giao diện bản cũ gửi lên khi không chụp được tấm nào.
    const { prisma, tx } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [
          { assetId: 'asset-1', condition: 'GOOD', photoKeys: ['CAM-001-handover.jpg'] },
          { assetId: 'asset-2', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_2] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
  });

  it('ảnh của máy khác không dùng làm chứng cứ cho máy này được', async () => {
    // Ảnh có thật nhưng chụp chiếc khác thì vẫn là chứng cứ sai chỗ: lúc đối chiếu vết xước
    // người ta sẽ mở đúng tấm ảnh đó ra và kết luận nhầm máy.
    const { prisma, tx } = buildDeps();
    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [
          { assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_2] },
          { assetId: 'asset-2', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_2B] },
        ],
      }),
    ).rejects.toThrow(/không thuộc máy/);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
  });
});

/**
 * Biên bản gửi lên trùng mã máy.
 *
 * `assign` đã chặn ca này từ lâu ("Một máy được gán cho nhiều dòng"), nhưng bàn giao và nhận trả
 * thì không — cùng một lỗ, ba cửa mà chỉ một cửa có khoá.
 *
 * Hậu quả nặng nhất nằm ở bàn giao: hai dòng biên bản cho cùng một chiếc máy, mà khâu nhận trả
 * lại dò bằng `find()` nên chỉ thấy dòng đầu. Dòng thứ hai không bao giờ được nhận lại, `stillOut`
 * không bao giờ về 0, và PHIẾU KHÔNG BAO GIỜ ĐÓNG ĐƯỢC.
 */

describe('HandoverService.create — trùng mã máy trong biên bản', () => {
  it('cùng một máy khai hai lần thì bị chặn, không ghi gì cả', async () => {
    const { prisma, tx } = buildDeps();

    await expect(
      new HandoverService(prisma).create('req-1', 'user-1', {
        ...DTO,
        units: [
          { assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_1] },
          { assetId: 'asset-1', condition: 'GOOD', photoKeys: [ANH_CUA_MAY_1] },
        ],
      }),
    ).rejects.toThrow(/hai lần|trùng/i);

    expect(tx.memsHandover.create).not.toHaveBeenCalled();
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReturnService } from '../return.service';

/**
 * Giống bên bàn giao: `photoKeys` là ID bản ghi ảnh do máy chủ sinh, không phải tên file client
 * tự đặt. BR-27 mà chỉ đếm độ dài mảng thì ảnh lúc trả cũng thành hình thức y như lúc giao.
 */
const ANH_CUA_MAY_1 = '11111111-1111-4111-8111-111111111111';
const ANH_CUA_MAY_2 = '22222222-2222-4222-8222-222222222222';
const ANH_KHONG_TON_TAI = '99999999-9999-4999-8999-999999999999';

const KHO_ANH = [
  { id: ANH_CUA_MAY_1, asset_id: 'asset-1' },
  { id: ANH_CUA_MAY_2, asset_id: 'asset-2' },
];

function buildDeps(over: Partial<any> = {}) {
  const handoverLines = over.handoverLines ?? [
    { id: 'hl-1', asset_id: 'asset-1', condition: 'GOOD', returnLines: [] },
    { id: 'hl-2', asset_id: 'asset-2', condition: 'GOOD', returnLines: [] },
  ];
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260808-001',
    owner_id: 'user-borrower',
    status: 'ON_LOAN',
    handovers: [{ lines: handoverLines }],
    ...over,
  };
  const created: any = { lines: [], incidents: [], assetUpdates: [], events: [] };
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
    memsReturn: {
      create: jest.fn(async ({ data }: any) => ({ id: 'ret-1', ...data })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'ret-1', lines: created.lines })),
    },
    memsReturnLine: {
      create: jest.fn(async ({ data }: any) => {
        created.lines.push(data);
        return { id: `rl-${created.lines.length}`, ...data };
      }),
    },
    memsReturnPhoto: { createMany: jest.fn(async () => ({ count: 1 })) },
    memsReturnAccessory: { createMany: jest.fn(async () => ({ count: 1 })) },
    memsAsset: {
      update: jest.fn(async ({ where, data }: any) => {
        created.assetUpdates.push({ ...where, ...data });
        return data;
      }),
    },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
    memsIncident: {
      create: jest.fn(async ({ data }: any) => {
        created.incidents.push(data);
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

const unit = (over: Partial<any> = {}) => ({
  assetId: 'asset-1',
  condition: 'GOOD',
  photoKeys: [ANH_CUA_MAY_1],
  ...over,
});

describe('ReturnService.create', () => {
  it('trả đủ mọi máy thì phiếu đóng', async () => {
    const { prisma, tx } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', {
      units: [unit(), unit({ assetId: 'asset-2', photoKeys: [ANH_CUA_MAY_2] })],
    });

    expect(tx.memsBorrowRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CLOSED' } }),
    );
  });

  it('còn máy chưa mang về thì phiếu chỉ là trả một phần', async () => {
    // Trả từng phần là bình thường: người mượn hay mang về trước những máy dùng xong.
    const { prisma, tx } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', { units: [unit()] });

    expect(tx.memsBorrowRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PARTIALLY_RETURNED' } }),
    );
  });

  it('máy nguyên vẹn về thẳng kệ, không mở sự cố', async () => {
    const { prisma, created } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', { units: [unit()] });

    expect(created.assetUpdates[0]).toMatchObject({ status: 'AVAILABLE' });
    expect(created.incidents).toHaveLength(0);
  });

  it('BR-42: máy tệ đi đi Kiểm tra sau trả và mở sự cố gắn với người mượn', async () => {
    const { prisma, created } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', {
      units: [unit({ condition: 'USED' })],
    });

    expect(created.assetUpdates[0]).toMatchObject({ status: 'POST_RETURN_CHECK' });
    expect(created.incidents[0]).toMatchObject({
      kind: 'CONDITION_WORSENED',
      responsible_id: 'user-borrower',
    });
  });

  it('thiếu phụ kiện mở sự cố riêng và cũng bắt máy đi kiểm tra', async () => {
    const { prisma, created } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', {
      units: [unit({ accessories: [{ accessoryId: 'acc-1', isPresent: false }] })],
    });

    expect(created.assetUpdates[0]).toMatchObject({ status: 'POST_RETURN_CHECK' });
    expect(created.incidents[0]).toMatchObject({ kind: 'MISSING_ACCESSORY' });
  });

  it('giữ chỗ được nhả ngay khi máy về kho', async () => {
    // Không nhả thì khoảng còn lại của phiếu vẫn hiện là bận, máy nằm trên kệ mà không ai mượn được.
    const { prisma, tx } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', { units: [unit()] });

    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'RELEASED' } }),
    );
  });

  it('thiếu ảnh khi trả là chặn cứng', async () => {
    const { prisma, tx } = buildDeps();
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit({ photoKeys: [] })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.memsReturn.create).not.toHaveBeenCalled();
  });

  it('BR-27: khoá ảnh không có trong kho ảnh thì chặn, không ghi gì cả', async () => {
    // Ảnh lúc trả là mốc đối chiếu để quy trách nhiệm. Nhận bừa một chuỗi client gửi lên thì
    // bản ghi sự cố sinh ra sau đó không có gì chống lưng.
    const { prisma, tx } = buildDeps();
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit({ photoKeys: [ANH_KHONG_TON_TAI] })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.memsReturn.create).not.toHaveBeenCalled();
    expect(tx.memsAsset.update).not.toHaveBeenCalled();
  });

  it('BR-27: tên file do client đặt không còn được nhận làm ảnh', async () => {
    const { prisma, tx } = buildDeps();
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit({ photoKeys: ['CAM-001-return.jpg'] })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.memsReturn.create).not.toHaveBeenCalled();
  });

  it('ảnh của máy khác không dùng làm chứng cứ khi trả máy này', async () => {
    const { prisma, tx } = buildDeps();
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit({ photoKeys: [ANH_CUA_MAY_2] })],
      }),
    ).rejects.toThrow(/không thuộc máy/);

    expect(tx.memsReturn.create).not.toHaveBeenCalled();
  });

  it('máy đã nhận lại trước đó thì không nhận lại lần hai', async () => {
    const { prisma } = buildDeps({
      handoverLines: [
        { id: 'hl-1', asset_id: 'asset-1', condition: 'GOOD', returnLines: [{ id: 'rl-cũ' }] },
      ],
    });
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', { units: [unit()] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('máy không nằm trong biên bản bàn giao thì bị chặn', async () => {
    const { prisma } = buildDeps();
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit({ assetId: 'asset-lạ' })],
      }),
    ).rejects.toThrow(/không nằm trong biên bản/);
  });

  it('phiếu chưa bàn giao thì không nhận trả được', async () => {
    const { prisma } = buildDeps({ status: 'PREPARING' });
    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', { units: [unit()] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lưu tình trạng lúc giao vào dòng trả để sau này còn đối chiếu', async () => {
    const { prisma, created } = buildDeps();
    await new ReturnService(prisma).create('req-1', 'user-1', {
      units: [unit({ condition: 'NEEDS_CHECK' })],
    });

    expect(created.lines[0]).toMatchObject({
      condition_before: 'GOOD',
      condition_after: 'NEEDS_CHECK',
      handover_line_id: 'hl-1',
    });
  });
});

/**
 * Nhận trả gửi lên trùng mã máy — cùng lỗ với bàn giao.
 *
 * Ở đây hậu quả là hai dòng trả cho một chiếc máy, và nếu tình trạng tệ đi thì MỞ HAI bản ghi sự
 * cố quy trách nhiệm cho người mượn về cùng một vết xước.
 */

describe('ReturnService.create — trùng mã máy trong biên bản', () => {
  it('cùng một máy khai hai lần thì bị chặn, không ghi gì cả', async () => {
    const { prisma, tx } = buildDeps();

    await expect(
      new ReturnService(prisma).create('req-1', 'user-1', {
        units: [unit(), unit()],
      }),
    ).rejects.toThrow(/hai lần|trùng/i);

    expect(tx.memsReturn.create).not.toHaveBeenCalled();
  });
});

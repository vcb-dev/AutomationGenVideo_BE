import { LuckySpinService } from '../lucky-spin.service';

/**
 * Nhập Excel là THAY danh sách, không phải cộng thêm vào danh sách cũ.
 *
 * Bản cũ chỉ `createMany` mà không xoá gì, nên nhập lại đúng file vừa nhập là danh sách
 * nhân đôi — mỗi người xuất hiện hai lần trên bánh xe và có gấp đôi cơ hội trúng. Đúng cái
 * người dùng làm nhiều nhất giữa buổi sự kiện: sửa vài dòng trong Excel rồi nhập lại.
 *
 * Xoá được an toàn vì lược đồ đã tính trước: spin_member_wins / spin_gift_awards chụp sẵn
 * `member_name` / `gift_name` và FK để `onDelete: SetNull`. Biên bản buổi đã quay không đổi
 * dù danh sách bị thay.
 *
 * Team cũng bị xoá theo (quyết định của ban tổ chức 12/08/2026): team vốn được TỰ SINH từ
 * chính file thành viên này, giữ lại thì team rỗng không còn ai vẫn nằm trong vòng quay team
 * và vẫn bốc trúng được.
 */
const ACTOR = { id: 'u1', name: 'MC' };

function buildService(hienCo: { members?: any[]; teams?: any[]; gifts?: any[] } = {}) {
  const nhatKy: string[] = [];

  const tx: any = {
    spinTeam: {
      findMany: jest.fn(async () => hienCo.teams ?? []),
      deleteMany: jest.fn(async () => {
        nhatKy.push('xoaTeam');
        return { count: (hienCo.teams ?? []).length };
      }),
      create: jest.fn(async ({ data }: any) => {
        nhatKy.push(`taoTeam:${data.name}`);
        return { id: `t-${data.name}` };
      }),
    },
    spinMember: {
      deleteMany: jest.fn(async () => {
        nhatKy.push('xoaMember');
        return { count: (hienCo.members ?? []).length };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        nhatKy.push(`taoMember:${data.length}`);
        return { count: data.length };
      }),
    },
    spinGift: {
      deleteMany: jest.fn(async () => {
        nhatKy.push('xoaGift');
        return { count: (hienCo.gifts ?? []).length };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        nhatKy.push(`taoGift:${data.length}`);
        return { count: data.length };
      }),
    },
  };

  const prisma: any = {
    spinWorkspace: {
      upsert: jest.fn(async () => ({ id: 'ws1' })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'ws1',
        controller_id: null,
        controller_name: null,
        control_expires_at: null,
      })),
      update: jest.fn(async () => ({})),
    },
    // Cùng một đối tượng tx cho mọi nhánh: cả xoá lẫn tạo phải nằm TRONG một giao dịch,
    // nửa chừng hỏng mà đã xoá xong thì sự kiện mất sạch danh sách.
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    ...tx,
  };

  return { service: new LuckySpinService(prisma), prisma, tx, nhatKy };
}

describe('bulkCreateMembers — nhập Excel thay trọn danh sách thành viên', () => {
  const HAI_DONG = {
    members: [
      { name: 'An', teamName: 'Team A' },
      { name: 'Bình', teamName: 'Team B' },
    ],
  };

  it('xoá hết thành viên cũ trước khi ghi danh sách mới', async () => {
    const { service, tx } = buildService({ members: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });

    await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    expect(tx.spinMember.deleteMany).toHaveBeenCalledWith({ where: { workspace_id: 'ws1' } });
  });

  it('xoá luôn team cũ — team rỗng còn sót vẫn bốc trúng được ở vòng quay team', async () => {
    const { service, tx } = buildService({ teams: [{ id: 't-cu', name: 'Team đã giải thể' }] });

    await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    expect(tx.spinTeam.deleteMany).toHaveBeenCalledWith({ where: { workspace_id: 'ws1' } });
  });

  it('xoá xong mới tạo — đảo thứ tự là xoá mất người vừa nhập', async () => {
    const { service, nhatKy } = buildService({ members: [{ id: 'm1' }] });

    await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    expect(nhatKy.indexOf('xoaMember')).toBeLessThan(nhatKy.findIndex((b) => b.startsWith('taoMember')));
    expect(nhatKy.indexOf('xoaTeam')).toBeLessThan(nhatKy.findIndex((b) => b.startsWith('taoTeam')));
  });

  it('cả xoá lẫn tạo nằm trong MỘT giao dịch', async () => {
    const { service, prisma } = buildService();

    await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('team dựng lại từ file mới, không đọc lại team cũ vừa xoá', async () => {
    // Team cũ trùng tên với file mới: nếu code còn tái dùng id cũ thì nó đã bị xoá, thành mồ côi.
    const { service, tx } = buildService({ teams: [{ id: 't-cu', name: 'Team A' }] });

    await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    const tenDaTao = tx.spinTeam.create.mock.calls.map((c: any) => c[0].data.name).sort();
    expect(tenDaTao).toEqual(['Team A', 'Team B']);
  });

  it('báo lại số đã xoá để người dùng biết vừa thay mất những gì', async () => {
    const { service } = buildService({ members: [{ id: 'm1' }, { id: 'm2' }], teams: [{ id: 't1' }] });

    const ra: any = await service.bulkCreateMembers('seci', HAI_DONG as any, ACTOR);

    expect(ra).toMatchObject({ createdMembers: 2, createdTeams: 2, deletedMembers: 2, deletedTeams: 1 });
  });

  it('file rỗng thì KHÔNG xoá gì — bấm nhầm file trắng không được phép quét sạch sự kiện', async () => {
    const { service, tx } = buildService({ members: [{ id: 'm1' }] });

    const ra: any = await service.bulkCreateMembers('seci', { members: [] } as any, ACTOR);

    expect(tx.spinMember.deleteMany).not.toHaveBeenCalled();
    expect(tx.spinTeam.deleteMany).not.toHaveBeenCalled();
    expect(ra).toMatchObject({ createdMembers: 0, deletedMembers: 0 });
  });

  it('file toàn dòng thiếu dữ liệu cũng không xoá gì', async () => {
    const { service, tx } = buildService({ members: [{ id: 'm1' }] });

    await service.bulkCreateMembers('seci', { members: [{ name: '  ', teamName: 'Team A' }] } as any, ACTOR);

    expect(tx.spinMember.deleteMany).not.toHaveBeenCalled();
  });
});

describe('bulkCreateGifts — nhập Excel thay trọn danh sách quà', () => {
  const MOT_QUA = { gifts: [{ name: 'Loa bluetooth', total: 3 }] };

  it('xoá hết quà cũ trước khi ghi danh sách mới', async () => {
    const { service, tx } = buildService({ gifts: [{ id: 'g1' }, { id: 'g2' }] });

    await service.bulkCreateGifts('seci', MOT_QUA as any, ACTOR);

    expect(tx.spinGift.deleteMany).toHaveBeenCalledWith({ where: { workspace_id: 'ws1' } });
  });

  it('xoá xong mới tạo, trong cùng một giao dịch', async () => {
    const { service, prisma, nhatKy } = buildService({ gifts: [{ id: 'g1' }] });

    await service.bulkCreateGifts('seci', MOT_QUA as any, ACTOR);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(nhatKy).toEqual(['xoaGift', 'taoGift:1']);
  });

  it('báo lại số quà đã xoá', async () => {
    const { service } = buildService({ gifts: [{ id: 'g1' }, { id: 'g2' }] });

    const ra: any = await service.bulkCreateGifts('seci', MOT_QUA as any, ACTOR);

    expect(ra).toMatchObject({ createdGifts: 1, deletedGifts: 2 });
  });

  it('file rỗng thì không xoá gì', async () => {
    const { service, tx } = buildService({ gifts: [{ id: 'g1' }] });

    const ra: any = await service.bulkCreateGifts('seci', { gifts: [] } as any, ACTOR);

    expect(tx.spinGift.deleteMany).not.toHaveBeenCalled();
    expect(ra).toMatchObject({ createdGifts: 0, deletedGifts: 0 });
  });

  it('quà số lượng 0 bị loại, và nếu loại hết thì không xoá gì', async () => {
    const { service, tx } = buildService({ gifts: [{ id: 'g1' }] });

    await service.bulkCreateGifts('seci', { gifts: [{ name: 'Quà lỗi', total: 0 }] } as any, ACTOR);

    expect(tx.spinGift.deleteMany).not.toHaveBeenCalled();
  });
});

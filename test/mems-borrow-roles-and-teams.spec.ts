import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalService } from '../src/modules/mems-borrow/approval.service';
import { BorrowRequestService } from '../src/modules/mems-borrow/borrow-request.service';
import { canSign, planApprovals } from '../src/modules/mems-borrow/approval-rules';
import { isMediaLeaderOrAdminUser } from '../src/common/guards/mems-media-leader.guard';

/**
 * Quản lý thiết bị nhìn từ phía NGƯỜI DÙNG KHÔNG BIẾT LUỒNG.
 *
 * Người thật không đi theo sơ đồ: họ bấm Duyệt phiếu của chính mình, bấm hai lần, bấm Huỷ khi máy
 * đã ra khỏi kho, mở phiếu của người khác, và làm những việc đó với đủ loại vai trò ở đủ loại
 * team. File này thử đúng những đường đó — cố ý KHÔNG theo thứ tự nghiệp vụ.
 *
 * Ba vai trò: MEMBER, LEADER, ADMIN. Nhiều team, lấy tên thật đang có trong hệ thống.
 *
 * Điểm dễ hiểu sai nhất và là lý do file này tồn tại: quyền điều phối kho KHÔNG do chức vụ quyết
 * định một mình. LEADER của team khác không có quyền gì hơn MEMBER trong kho Media.
 */

/** Team có thật trong hệ thống, gồm cả những tên dễ bị nhầm là Media. */
const TEAMS = {
  media: 'Media',
  mediaHoa: 'MEDIA',
  mediaThua: '  media  ',
  k1: 'Team K1',
  k2: 'Team K2',
  ads: 'ADS',
  scaleData: 'Scale Data',
  globalIndo: 'Global - Indo',
  daQuy: 'Đá Quý - Chung Thợ Đá',
  nhieuTeam: 'Media,Team K1',
  nhieuTeamKhongMedia: 'Team K1,Scale Data',
  // Hai cái bẫy: tên CHỨA chữ media nhưng không phải bộ phận Media.
  socialMedia: 'Social Media',
  multimedia: 'Multimedia',
};

const user = (id: string, roles: string[], team?: string | null) => ({ id, roles, team });

const MEMBER_MEDIA = user('u-member-media', ['MEMBER'], TEAMS.media);
const MEMBER_K1 = user('u-member-k1', ['MEMBER'], TEAMS.k1);
const LEADER_MEDIA = user('u-leader-media', ['LEADER'], TEAMS.media);
const LEADER_K1 = user('u-leader-k1', ['LEADER'], TEAMS.k1);
const LEADER_GLOBAL = user('u-leader-global', ['LEADER'], TEAMS.globalIndo);
const MANAGER_MEDIA = user('u-manager-media', ['MANAGER'], TEAMS.media);
const MANAGER_K2 = user('u-manager-k2', ['MANAGER'], TEAMS.k2);
const ADMIN = user('u-admin', ['ADMIN'], null);
const ADMIN_KHAC = user('u-admin-2', ['ADMIN'], TEAMS.k1);

describe('Ai được coi là quản lý kho — ma trận vai trò × team', () => {
  it.each([
    ['MEMBER team Media', MEMBER_MEDIA, false],
    ['MEMBER team K1', MEMBER_K1, false],
    ['LEADER team Media', LEADER_MEDIA, true],
    ['LEADER team K1', LEADER_K1, false],
    ['LEADER team Global - Indo', LEADER_GLOBAL, false],
    ['LEADER team Đá Quý', user('u1', ['LEADER'], TEAMS.daQuy), false],
    ['LEADER team ADS', user('u2', ['LEADER'], TEAMS.ads), false],
    ['LEADER team Scale Data', user('u3', ['LEADER'], TEAMS.scaleData), false],
    ['MANAGER team Media', MANAGER_MEDIA, true],
    ['MANAGER team K2', MANAGER_K2, false],
    ['ADMIN không có team', ADMIN, true],
    ['ADMIN team K1', ADMIN_KHAC, true],
  ])('%s', (_ten, u, mongDoi) => {
    expect(isMediaLeaderOrAdminUser(u)).toBe(mongDoi);
  });

  it('LEADER thuộc nhiều team, trong đó có Media thì vẫn là quản lý kho', () => {
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.nhieuTeam))).toBe(true);
  });

  it('LEADER thuộc nhiều team nhưng không có Media thì không', () => {
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.nhieuTeamKhongMedia))).toBe(false);
  });

  it('tên team viết hoa vẫn nhận ra, người nhập liệu không phải nhớ đúng kiểu chữ', () => {
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.mediaHoa))).toBe(true);
  });

  it('tên team thừa khoảng trắng vẫn nhận ra', () => {
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.mediaThua))).toBe(true);
  });

  it('team tên "Social Media" KHÔNG leo được lên quyền quản lý kho', () => {
    // Tên team do người dùng đặt được. So khớp kiểu "có chứa" thì đặt tên là leo quyền: xoá thiết
    // bị, duyệt phiếu, đọc nhật ký mượn của cả công ty.
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.socialMedia))).toBe(false);
  });

  it('team tên "Multimedia" cũng không', () => {
    expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.multimedia))).toBe(false);
  });

  it.each([
    ['không có team', user('u', ['LEADER'], null)],
    ['team để trống', user('u', ['LEADER'], '')],
    ['team là undefined', { id: 'u', roles: ['LEADER'] }],
  ])('LEADER %s thì KHÔNG được coi là Media, không đoán có lợi cho người gọi', (_ten, u) => {
    // Bản trước coi `undefined` là Media, nghĩa là mọi lời gọi quên truyền team đều biến cửa canh
    // thành hình thức.
    expect(isMediaLeaderOrAdminUser(u as any)).toBe(false);
  });

  it.each([
    ['chưa đăng nhập', null],
    ['undefined', undefined],
    ['không có vai trò nào', { id: 'u', roles: [], team: TEAMS.media }],
    ['roles không phải mảng', { id: 'u', roles: 'ADMIN' as any, team: TEAMS.media }],
  ])('%s thì không có quyền gì', (_ten, u) => {
    expect(isMediaLeaderOrAdminUser(u as any)).toBe(false);
  });
});

describe('Ai ký được cấp nào — phiếu việc công ty (một chữ ký)', () => {
  const step = planApprovals({
    totalValue: 1_000_000,
    fromTime: new Date('2026-09-15T02:00:00Z'),
    toTime: new Date('2026-09-16T10:00:00Z'),
    place: 'Studio',
    purpose: 'WORK',
  }).steps[0];

  it.each([
    ['LEADER Media', LEADER_MEDIA, true],
    ['MANAGER Media', MANAGER_MEDIA, true],
    ['ADMIN ký thay cấp leader', ADMIN, true],
    ['LEADER team K1', LEADER_K1, false],
    ['LEADER team Global - Indo', LEADER_GLOBAL, false],
    ['MANAGER team K2', MANAGER_K2, false],
    ['MEMBER Media', MEMBER_MEDIA, false],
    ['MEMBER team K1', MEMBER_K1, false],
  ])('%s', (_ten, u, mongDoi) => {
    expect(canSign(step, u.roles, u.team)).toBe(mongDoi);
  });

  it('chỉ có một cấp, phiếu việc công ty không cần chữ ký admin', () => {
    const plan = planApprovals({
      totalValue: 1_000_000,
      fromTime: new Date('2026-09-15T02:00:00Z'),
      toTime: new Date('2026-09-16T10:00:00Z'),
      place: 'Studio',
      purpose: 'WORK',
    });
    expect(plan.steps).toHaveLength(1);
  });

  it('máy đắt hay mượn dài chỉ là cảnh báo, KHÔNG đẻ thêm chữ ký', () => {
    const plan = planApprovals({
      totalValue: 900_000_000,
      fromTime: new Date('2026-09-01T00:00:00Z'),
      toTime: new Date('2026-10-01T00:00:00Z'),
      place: 'Đà Nẵng',
      purpose: 'WORK',
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});

describe('Ai ký được cấp nào — phiếu việc riêng (hai chữ ký)', () => {
  const plan = planApprovals({
    totalValue: 1_000_000,
    fromTime: new Date('2026-09-15T02:00:00Z'),
    toTime: new Date('2026-09-16T10:00:00Z'),
    place: 'Studio',
    purpose: 'PERSONAL',
  });

  it('cần đúng hai cấp: leader rồi admin', () => {
    expect(plan.steps.map((s) => s.role)).toEqual(['LEADER', 'ADMIN']);
  });

  it.each([
    ['LEADER Media ký cấp 1', LEADER_MEDIA, true],
    ['MANAGER Media ký cấp 1', MANAGER_MEDIA, true],
    ['ADMIN KHÔNG ký thay được cấp 1', ADMIN, false],
    ['LEADER team K1 ký cấp 1', LEADER_K1, false],
    ['MEMBER Media ký cấp 1', MEMBER_MEDIA, false],
  ])('%s', (_ten, u, mongDoi) => {
    // Tắt ký thay ở phiếu cá nhân: ở đó admin đã là cấp hai, cho ký thay cấp một nữa thì một
    // người bấm hai lần là xong cả phiếu.
    expect(canSign(plan.steps[0], u.roles, u.team)).toBe(mongDoi);
  });

  it.each([
    ['ADMIN ký cấp 2', ADMIN, true],
    ['LEADER Media ký cấp 2', LEADER_MEDIA, false],
    ['MANAGER Media ký cấp 2', MANAGER_MEDIA, false],
    ['MEMBER Media ký cấp 2', MEMBER_MEDIA, false],
    ['LEADER team K1 ký cấp 2', LEADER_K1, false],
  ])('%s', (_ten, u, mongDoi) => {
    expect(canSign(plan.steps[1], u.roles, u.team)).toBe(mongDoi);
  });
});

/** Dựng ApprovalService quanh một phiếu có sẵn, để thử bấm Duyệt/Từ chối lung tung. */
function buildApproval(options: {
  ownerId?: string;
  status?: string;
  purpose?: 'WORK' | 'PERSONAL';
  approvals?: { decided_by: string; decision: string; level: number }[];
  requestExists?: boolean;
} = {}) {
  const {
    ownerId = MEMBER_K1.id,
    status = 'PENDING_APPROVAL',
    purpose = 'WORK',
    approvals = [],
    requestExists = true,
  } = options;

  const request = {
    id: 'req-1',
    request_code: 'REQ-20260915-001',
    owner_id: ownerId,
    status,
    purpose,
    place: 'Studio',
    from_time: new Date('2026-09-15T02:00:00Z'),
    to_time: new Date('2026-09-16T10:00:00Z'),
    lines: [{ quantity: 1, model: { reference_price: 1_000_000 } }],
    approvals,
  };

  const written: any = { approvals: [], updates: [] };
  const tx: any = {
    $executeRawUnsafe: jest.fn(async () => 1),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => (requestExists ? request : null)),
      findUniqueOrThrow: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => {
        written.updates.push(data);
        return { ...request, ...data };
      }),
    },
    memsApproval: {
      create: jest.fn(async ({ data }: any) => {
        written.approvals.push(data);
        return data;
      }),
    },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { service: new ApprovalService(prisma), written, tx };
}

describe('Bấm Duyệt lung tung — ai bấm, bấm lúc nào', () => {
  it('MEMBER team K1 bấm Duyệt phiếu của người khác thì bị chặn', async () => {
    const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

    await expect(service.approve('req-1', MEMBER_K1, {} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('MEMBER tự bấm Duyệt phiếu do chính mình đứng tên thì bị chặn', async () => {
    // Chốt chặn quan trọng nhất của cả quy trình: người xin mà ký được cho chính mình thì cấp
    // duyệt chỉ còn là một nút bấm thừa.
    const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

    await expect(service.approve('req-1', MEMBER_MEDIA, {} as any)).rejects.toThrow(
      /Không tự duyệt phiếu/,
    );
  });

  it('LEADER team K1 bấm Duyệt phiếu kho Media thì bị chặn dù có chức', async () => {
    // Có chức không có nghĩa là có quyền trong kho của bộ phận khác.
    const { service } = buildApproval();

    await expect(service.approve('req-1', LEADER_K1, {} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('LEADER team Global - Indo cũng vậy', async () => {
    const { service } = buildApproval();

    await expect(service.approve('req-1', LEADER_GLOBAL, {} as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('LEADER Media duyệt phiếu của người khác thì được', async () => {
    const { service, written } = buildApproval({ ownerId: MEMBER_K1.id });

    await service.approve('req-1', LEADER_MEDIA, {} as any);

    expect(written.approvals).toHaveLength(1);
    expect(written.updates[0].status).toBe('APPROVED');
  });

  it('LEADER Media duyệt phiếu công việc do CHÍNH MÌNH đứng tên thì vẫn được', async () => {
    // Bộ phận chỉ có một leader mà chính họ đứng tên phiếu thì không còn ai khác ký — bịt đường
    // này là khoá cứng cả bộ phận.
    const { service, written } = buildApproval({ ownerId: LEADER_MEDIA.id, purpose: 'WORK' });

    await service.approve('req-1', LEADER_MEDIA, {} as any);

    expect(written.updates[0].status).toBe('APPROVED');
  });

  it('ADMIN tự ký cấp giám sát cho phiếu CÁ NHÂN của chính mình thì bị chặn', async () => {
    // Cấp admin là chữ ký giám sát: tồn tại để có người ĐỨNG NGOÀI biết máy rời khỏi việc công
    // ty. Tự ký thì mục đích của cả cấp mất sạch.
    const { service } = buildApproval({
      ownerId: ADMIN.id,
      purpose: 'PERSONAL',
      approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
    });

    await expect(service.approve('req-1', ADMIN, {} as any)).rejects.toThrow(
      /Không tự ký cấp giám sát/,
    );
  });

  it('admin KHÁC ký cấp giám sát phiếu cá nhân đó thì được', async () => {
    const { service, written } = buildApproval({
      ownerId: ADMIN.id,
      purpose: 'PERSONAL',
      approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
    });

    await service.approve('req-1', ADMIN_KHAC, {} as any);

    expect(written.updates[0].status).toBe('APPROVED');
  });

  it('bấm Duyệt hai lần thì lần sau bị chặn', async () => {
    const { service } = buildApproval({
      approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
    });

    await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toThrow(
      /đã ra quyết định/,
    );
  });

  it('phiếu đã đủ chữ ký thì người thứ ba bấm Duyệt cũng không vào', async () => {
    const { service } = buildApproval({
      purpose: 'WORK',
      approvals: [{ decided_by: MANAGER_MEDIA.id, decision: 'APPROVED', level: 1 }],
    });

    await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toThrow(
      /đã đủ chữ ký/,
    );
  });

  it.each(['APPROVED', 'REJECTED', 'PREPARING', 'ON_LOAN', 'RETURNED', 'CANCELLED'])(
    'phiếu đang ở trạng thái %s thì không duyệt được nữa',
    async (status) => {
      const { service } = buildApproval({ status });

      await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );

  it('bấm Duyệt trên phiếu không tồn tại thì báo không tìm thấy, không báo lỗi quyền', async () => {
    const { service } = buildApproval({ requestExists: false });

    await expect(service.approve('req-khong-co', LEADER_MEDIA, {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('phiếu cá nhân ký xong cấp 1 thì CHƯA duyệt xong, vẫn nằm chờ admin', async () => {
    const { service, written } = buildApproval({ purpose: 'PERSONAL', ownerId: MEMBER_K1.id });

    await service.approve('req-1', LEADER_MEDIA, {} as any);

    expect(written.approvals).toHaveLength(1);
    expect(written.updates).toHaveLength(0);
  });

  it('ADMIN bấm Duyệt phiếu cá nhân khi LEADER chưa ký thì bị chặn, không nhảy cóc cấp', async () => {
    const { service } = buildApproval({ purpose: 'PERSONAL', ownerId: MEMBER_K1.id });

    await expect(service.approve('req-1', ADMIN, {} as any)).rejects.toThrow(/Cấp 1 phải do/);
  });
});

describe('Bấm Từ chối lung tung', () => {
  it('từ chối mà bỏ trống lý do thì bị chặn', async () => {
    const { service } = buildApproval();

    await expect(service.reject('req-1', LEADER_MEDIA, { reason: '' } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lý do chỉ toàn khoảng trắng cũng bị chặn', async () => {
    // @IsNotEmpty của DTO cho chuỗi khoảng trắng lọt qua.
    const { service } = buildApproval();

    await expect(
      service.reject('req-1', LEADER_MEDIA, { reason: '     ' } as any),
    ).rejects.toThrow(/Phải nhập lý do/);
  });

  it('MEMBER team K1 từ chối phiếu người khác thì bị chặn dù có ghi lý do', async () => {
    const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

    await expect(
      service.reject('req-1', MEMBER_K1, { reason: 'không thích' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('LEADER Media từ chối thì phiếu chuyển REJECTED và nhả giữ chỗ ngay', async () => {
    // Để sang lượt sau thì khoảng thời gian đó vẫn hiện là bận, người khác không xin được chiếc
    // máy thực ra đang rảnh.
    const { service, written, tx } = buildApproval();

    await service.reject('req-1', LEADER_MEDIA, { reason: 'Trùng lịch quay' } as any);

    expect(written.updates[0].status).toBe('REJECTED');
    expect(tx.memsReservation.updateMany).toHaveBeenCalled();
  });
});

/** Dựng BorrowRequestService quanh một phiếu có sẵn, để thử bấm Huỷ lung tung. */
function buildCancel(options: { ownerId?: string; status?: string; exists?: boolean } = {}) {
  const { ownerId = MEMBER_K1.id, status = 'PENDING_APPROVAL', exists = true } = options;
  const request = { id: 'req-1', request_code: 'REQ-20260915-001', owner_id: ownerId, status };

  const written: any = { updates: [] };
  const tx: any = {
    $executeRawUnsafe: jest.fn(async () => 1),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => (exists ? request : null)),
      update: jest.fn(async ({ data }: any) => {
        written.updates.push(data);
        return { ...request, ...data };
      }),
    },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const availability: any = { check: jest.fn() };
  return { service: new BorrowRequestService(prisma, availability), written, tx };
}

describe('Bấm Huỷ lung tung', () => {
  it('người đứng tên huỷ phiếu chưa ai ký thì được', async () => {
    const { service, written } = buildCancel({ ownerId: MEMBER_K1.id });

    await service.cancel('req-1', MEMBER_K1);

    expect(written.updates[0].status).toBe('CANCELLED');
  });

  it('người khác huỷ phiếu không phải của mình thì bị chặn', async () => {
    const { service } = buildCancel({ ownerId: MEMBER_MEDIA.id });

    await expect(service.cancel('req-1', MEMBER_K1)).rejects.toThrow(/không thuộc về bạn/);
  });

  it('LEADER team K1 huỷ phiếu người khác cũng bị chặn, chức không thay quyền', async () => {
    const { service } = buildCancel({ ownerId: MEMBER_MEDIA.id });

    await expect(service.cancel('req-1', LEADER_K1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('người đứng tên huỷ phiếu ĐÃ DUYỆT thì bị chặn, kho đang soạn hàng', async () => {
    const { service } = buildCancel({ ownerId: MEMBER_K1.id, status: 'APPROVED' });

    await expect(service.cancel('req-1', MEMBER_K1)).rejects.toThrow(/Nhờ quản lý kho huỷ giúp/);
  });

  it.each(['APPROVED', 'PREPARING'])(
    'LEADER Media huỷ hộ phiếu đang ở %s thì được',
    async (status) => {
      const { service, written } = buildCancel({ ownerId: MEMBER_K1.id, status });

      await service.cancel('req-1', LEADER_MEDIA);

      expect(written.updates[0].status).toBe('CANCELLED');
    },
  );

  it('ADMIN huỷ hộ cũng được', async () => {
    const { service, written } = buildCancel({ ownerId: MEMBER_K1.id, status: 'APPROVED' });

    await service.cancel('req-1', ADMIN);

    expect(written.updates[0].status).toBe('CANCELLED');
  });

  it.each(['ON_LOAN', 'RETURNED', 'CANCELLED', 'REJECTED'])(
    'máy đã rời kho hoặc phiếu đã đóng (%s) thì ngay cả quản lý kho cũng không huỷ được',
    async (status) => {
      // Huỷ ở đó là bỏ rơi những chiếc đang nằm ngoài công ty mà không còn phiếu nào theo dõi.
      const { service } = buildCancel({ status });

      await expect(service.cancel('req-1', LEADER_MEDIA)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );

  it('huỷ phiếu không tồn tại thì báo không tìm thấy', async () => {
    const { service } = buildCancel({ exists: false });

    await expect(service.cancel('req-khong-co', LEADER_MEDIA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('huỷ thì nhả giữ chỗ ngay, không để khoảng thời gian đó hiện là bận', async () => {
    const { service, tx } = buildCancel({ ownerId: MEMBER_K1.id });

    await service.cancel('req-1', MEMBER_K1);

    expect(tx.memsReservation.updateMany).toHaveBeenCalled();
    expect(tx.memsRequestLine.updateMany).toHaveBeenCalled();
  });
});

/** Dựng ApprovalService cho việc ĐỌC phiếu, để thử xem trộm phiếu người khác. */
function buildViewer(ownerId: string) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260915-001',
    owner_id: ownerId,
    status: 'PENDING_APPROVAL',
    purpose: 'WORK',
    place: 'Studio',
    from_time: new Date('2026-09-15T02:00:00Z'),
    to_time: new Date('2026-09-16T10:00:00Z'),
    department: { id: 'dept-1', name: 'Bộ phận Media' },
    lines: [{ quantity: 1, model: { reference_price: 1_000_000, category: {} }, reservations: [] }],
    approvals: [],
  };
  const whereArgs: any[] = [];
  const prisma: any = {
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      findMany: jest.fn(async (args: any) => {
        whereArgs.push(args.where);
        return [];
      }),
    },
    user: { findMany: jest.fn(async () => []) },
  };
  return { service: new ApprovalService(prisma), whereArgs };
}

describe('Mở phiếu của người khác', () => {
  it('MEMBER mở phiếu không phải của mình thì bị chặn', async () => {
    const { service } = buildViewer(MEMBER_MEDIA.id);

    await expect(service.detail('req-1', MEMBER_K1)).rejects.toThrow(/không thuộc về bạn/);
  });

  it('báo 403 chứ không báo 404 — người dùng cần biết phiếu CÓ tồn tại nhưng không phải của mình', async () => {
    const { service } = buildViewer(MEMBER_MEDIA.id);

    await expect(service.detail('req-1', MEMBER_K1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('LEADER team K1 mở phiếu kho Media cũng bị chặn', async () => {
    const { service } = buildViewer(MEMBER_MEDIA.id);

    await expect(service.detail('req-1', LEADER_K1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('LEADER Media mở được mọi phiếu', async () => {
    const { service } = buildViewer(MEMBER_K1.id);

    await expect(service.detail('req-1', LEADER_MEDIA)).resolves.toMatchObject({ id: 'req-1' });
  });

  it('ADMIN mở được mọi phiếu', async () => {
    const { service } = buildViewer(MEMBER_K1.id);

    await expect(service.detail('req-1', ADMIN)).resolves.toMatchObject({ id: 'req-1' });
  });

  it('chủ phiếu mở phiếu của mình thì được', async () => {
    const { service } = buildViewer(MEMBER_K1.id);

    await expect(service.detail('req-1', MEMBER_K1)).resolves.toMatchObject({ id: 'req-1' });
  });

  it.each([
    ['MEMBER Media', MEMBER_MEDIA],
    ['MEMBER team K1', MEMBER_K1],
    ['LEADER team K1', LEADER_K1],
    ['MANAGER team K2', MANAGER_K2],
  ])('%s xem danh sách thì chỉ thấy phiếu của chính mình', async (_ten, u) => {
    // Lọc ở TẦNG TRUY VẤN: lọc sau khi đọc vẫn kéo trọn bảng về bộ nhớ, và chỉ cần một chỗ quên
    // lọc là lộ hết phiếu của cả công ty.
    const { service, whereArgs } = buildViewer(u.id);

    await service.list({}, u);

    expect(whereArgs[0].owner_id).toBe(u.id);
  });

  it.each([
    ['LEADER Media', LEADER_MEDIA],
    ['MANAGER Media', MANAGER_MEDIA],
    ['ADMIN', ADMIN],
  ])('%s xem danh sách thì thấy phiếu của cả kho', async (_ten, u) => {
    const { service, whereArgs } = buildViewer('ai-do');

    await service.list({}, u);

    expect(whereArgs[0].owner_id).toBeUndefined();
  });
});

describe('Tạo phiếu mượn — mọi vai trò ở mọi team đều tạo được', () => {
  function buildCreate() {
    const created: any = { request: null };
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 1),
      memsMember: { findFirst: jest.fn(async () => null) },
      user: { findUnique: jest.fn(async () => ({ team: null })) },
      memsDepartment: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => [{ id: 'd1' }, { id: 'd2' }]),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'dept-mac-dinh', ...data })),
      },
      memsBorrowRequest: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => {
          created.request = data;
          return { id: 'req-1', ...data };
        }),
      },
      memsRequestLine: { create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })) },
      memsReservation: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const availability: any = {
      check: jest.fn(async () => ({
        available: 5,
        enough: true,
        shortBy: 0,
        bufferMinutes: 0,
        bufferedTo: new Date('2026-09-16T10:00:00Z'),
        busyByReservation: 0,
        busyByMaintenance: 0,
      })),
    };
    return { service: new BorrowRequestService(prisma, availability), created };
  }

  const DTO = {
    project: 'Quay TVC',
    place: 'Studio',
    fromTime: '2026-09-15T02:00:00Z',
    toTime: '2026-09-16T10:00:00Z',
    lines: [{ modelId: 'model-1', quantity: 1 }],
  };

  it.each([
    ['MEMBER team Media', MEMBER_MEDIA],
    ['MEMBER team K1', MEMBER_K1],
    ['LEADER team Global - Indo', LEADER_GLOBAL],
    ['MANAGER team K2', MANAGER_K2],
    ['LEADER Media', LEADER_MEDIA],
    ['ADMIN', ADMIN],
  ])('%s tạo được phiếu dù chưa được gán bộ phận MEMS nào', async (_ten, u) => {
    // Mượn máy là việc ai cũng làm. Bộ phận trên phiếu chỉ để quy trách nhiệm, không phải cửa
    // canh — chặn ở đó là khoá người dùng khỏi việc họ vốn được phép làm.
    const { service, created } = buildCreate();

    await service.create(u.id, DTO);

    expect(created.request.owner_id).toBe(u.id);
    expect(created.request.department_id).toBe('dept-mac-dinh');
  });
});

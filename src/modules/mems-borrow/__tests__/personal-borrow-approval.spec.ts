import { ForbiddenException } from '@nestjs/common';
import { canSign, planApprovals } from '../approval-rules';
import { ApprovalService } from '../approval.service';
import { BorrowRequestService } from '../borrow-request.service';

/**
 * Phiếu mượn phục vụ việc cá nhân phải qua hai chữ ký: leader rồi admin.
 *
 * Khác với các luật khác trong `approval-plan.spec.ts` — ở đó thứ quyết định là địa điểm và giá
 * trị. Ở đây thứ quyết định là MỤC ĐÍCH: máy rời khỏi công việc của công ty thì phải có admin
 * biết, dù chỉ mượn một buổi và dù máy rẻ.
 */

const base = {
  totalValue: 10_000_000,
  fromTime: new Date('2026-08-12T08:00:00Z'),
  toTime: new Date('2026-08-13T18:00:00Z'),
  place: 'Nhà riêng',
};

describe('planApprovals — phiếu mượn cá nhân', () => {
  it('mượn việc cá nhân cần hai chữ ký: leader trước, admin sau', () => {
    const plan = planApprovals({ ...base, purpose: 'PERSONAL' });

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({ level: 1, role: 'LEADER' });
    expect(plan.steps[1]).toMatchObject({ level: 2, role: 'ADMIN' });
  });
});

describe('canSign — phiếu mượn cá nhân', () => {
  it('admin KHÔNG ký thay được cấp của leader trên phiếu cá nhân', () => {
    // Nếu ký thay được thì một mình admin bấm hai lần là xong cả phiếu, và luật hai cấp chỉ
    // còn là hình thức. Trên phiếu công việc thì vẫn cho ký thay (xem approval-plan.spec.ts).
    const plan = planApprovals({ ...base, purpose: 'PERSONAL' });

    expect(canSign(plan.steps[0], ['ADMIN'])).toBe(false);
    expect(canSign(plan.steps[0], ['LEADER'])).toBe(true);
    expect(canSign(plan.steps[1], ['ADMIN'])).toBe(true);
  });
});

const LEADER = { id: 'leader-1', roles: ['LEADER'] };
const LEADER_KHAC = { id: 'leader-2', roles: ['LEADER'] };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'] };

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-020',
    owner_id: 'nguoi-muon',
    status: 'PENDING_APPROVAL',
    from_time: base.fromTime,
    to_time: base.toTime,
    place: 'Nhà riêng',
    purpose: 'PERSONAL',
    approvals: [],
    lines: [{ quantity: 1, model: { reference_price: 10_000_000 } }],
    ...over,
  };
  const tx = {
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      findUniqueOrThrow: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsApproval: { create: jest.fn(async ({ data }: any) => data) },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx };
}

describe('ApprovalService.approve — phiếu mượn cá nhân', () => {
  it('leader ký cấp một xong, phiếu vẫn nằm chờ admin', async () => {
    const { prisma, tx } = buildDeps();
    await new ApprovalService(prisma).approve('req-1', LEADER, {});

    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
    );
  });

  it('admin ký cấp hai xong thì phiếu mới được duyệt và giữ chỗ được xác nhận', async () => {
    const { prisma, tx } = buildDeps({
      approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
    });
    const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});

    expect(result.status).toBe('APPROVED');
    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CONFIRMED' } }),
    );
  });

  it('admin không ký được khi chưa có leader nào ký', async () => {
    // Chốt chặn thật sự của luật hai cấp: không cho admin tự bấm hai lần là xong phiếu.
    const { prisma, tx } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve('req-1', ADMIN, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.memsApproval.create).not.toHaveBeenCalled();
  });

  it('leader khác KHÔNG ký thay được cấp của admin', async () => {
    const { prisma } = buildDeps({
      approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
    });
    await expect(
      new ApprovalService(prisma).approve('req-1', LEADER_KHAC, {}),
    ).rejects.toThrow(/phải do ADMIN ký/);
  });

  it('phiếu công việc vẫn chỉ cần một chữ ký như cũ', async () => {
    // Luật mới không được siết phiếu đi quay, đi sự kiện — chỗ đó vẫn một chữ ký.
    const { prisma } = buildDeps({ purpose: 'WORK', place: 'Đà Nẵng' });
    const result = await new ApprovalService(prisma).approve('req-1', LEADER, {});

    expect(result.status).toBe('APPROVED');
  });

  it('phiếu cũ chưa có cột mục đích vẫn duyệt được bằng một chữ ký', async () => {
    // Cột purpose thêm sau, phiếu tạo trước đó đọc ra null. Nếu null bị hiểu thành cá nhân thì
    // mọi phiếu đang chờ trong DB bỗng dưng kẹt lại đòi chữ ký admin.
    const { prisma } = buildDeps({ purpose: null });
    const result = await new ApprovalService(prisma).approve('req-1', LEADER, {});

    expect(result.status).toBe('APPROVED');
  });
});

describe('BorrowRequestService.create — mục đích mượn', () => {
  const DTO = {
    departmentId: 'dept-1',
    project: 'Chụp ảnh cưới người nhà',
    place: 'Nhà riêng',
    fromTime: '2026-08-15T02:00:00Z',
    toTime: '2026-08-16T10:00:00Z',
    lines: [{ modelId: 'model-1', quantity: 1 }],
  };

  function buildCreateDeps() {
    const tx = {
      $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
      memsBorrowRequest: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({ id: 'req-1', ...data })),
      },
      memsRequestLine: { create: jest.fn(async ({ data }: any) => ({ id: 'line-1', ...data })) },
      memsReservation: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const availability: any = {
      check: jest.fn(async () => ({
        available: 5,
        enough: true,
        shortBy: 0,
        bufferMinutes: 0,
        bufferedTo: new Date('2026-08-16T10:00:00Z'),
        busyByReservation: 0,
        busyByMaintenance: 0,
      })),
    };
    return { prisma, tx, availability };
  }

  it('mục đích cá nhân được ghi vào phiếu', async () => {
    const { prisma, tx, availability } = buildCreateDeps();
    await new BorrowRequestService(prisma, availability).create('user-1', {
      ...DTO,
      purpose: 'PERSONAL',
    });

    expect(tx.memsBorrowRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ purpose: 'PERSONAL' }) }),
    );
  });

  it('không khai mục đích thì mặc định là việc công ty', async () => {
    // Mặc định phải là WORK: client cũ chưa gửi trường này, và đoán nhầm sang cá nhân thì phiếu
    // đi quay bình thường cũng bị đòi chữ ký admin.
    const { prisma, tx, availability } = buildCreateDeps();
    await new BorrowRequestService(prisma, availability).create('user-1', DTO);

    expect(tx.memsBorrowRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ purpose: 'WORK' }) }),
    );
  });
});

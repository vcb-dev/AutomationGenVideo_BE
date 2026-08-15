import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApprovalService } from '../approval.service';

const LEADER1 = { id: 'leader-1', roles: ['LEADER'] };
const LEADER2 = { id: 'leader-2', roles: ['LEADER'] };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'] };

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
    owner_id: 'nguoi-muon',
    status: 'PENDING_APPROVAL',
    from_time: new Date('2026-08-12T08:00:00Z'),
    to_time: new Date('2026-08-13T18:00:00Z'),
    place: 'Studio',
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
    memsReservation: { updateMany: jest.fn(async () => ({ count: 2 })) },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx, request };
}

describe('ApprovalService.approve', () => {
  it('phiếu một cấp: ký xong là APPROVED và giữ chỗ chuyển sang xác nhận', async () => {
    const { prisma, tx } = buildDeps();
    const result = await new ApprovalService(prisma).approve('req-1', LEADER1, {});

    expect(result.status).toBe('APPROVED');
    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CONFIRMED' } }),
    );
  });

  it('phiếu hai cấp: cấp một ký xong phiếu vẫn nằm chờ', async () => {
    // Mang ra ngoài công ty nên cần thêm chữ ký admin; chuyển sang APPROVED sớm là bỏ qua cấp hai.
    const { prisma, tx } = buildDeps({ place: 'Đà Nẵng' });
    await new ApprovalService(prisma).approve('req-1', LEADER1, {});

    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
    );
  });

  it('phiếu hai cấp: cấp hai ký xong mới thành APPROVED', async () => {
    const { prisma } = buildDeps({
      place: 'Đà Nẵng',
      approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
    });
    const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});

    expect(result.status).toBe('APPROVED');
  });

  it('BR-23: một người không ký được hai lần cho cùng phiếu', async () => {
    // Ký hai lần là tự mình đủ hai cấp, vô hiệu hoá toàn bộ ý nghĩa của cấp duyệt thứ hai.
    const { prisma } = buildDeps({
      approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
    });
    await expect(
      new ApprovalService(prisma).approve('req-1', LEADER1, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('phiếu đã duyệt rồi thì không duyệt lại được', async () => {
    const { prisma } = buildDeps({ status: 'APPROVED' });
    await expect(
      new ApprovalService(prisma).approve('req-1', LEADER1, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ApprovalService.reject', () => {
  it('BR-20: lý do toàn khoảng trắng vẫn bị chặn', async () => {
    // @IsNotEmpty của DTO cho chuỗi khoảng trắng lọt qua, nên service phải tự chặn.
    const { prisma } = buildDeps();
    await expect(
      new ApprovalService(prisma).reject('req-1', LEADER1, { reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('BR-32: từ chối nhả giữ chỗ ngay trong cùng giao dịch', async () => {
    // Để sang lượt sau thì khoảng đó vẫn hiện là bận, người khác không xin được máy đang rảnh.
    const { prisma, tx } = buildDeps();
    const result = await new ApprovalService(prisma).reject('req-1', LEADER1, {
      reason: 'Trùng lịch dự án khác',
    });

    expect(result.status).toBe('REJECTED');
    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'RELEASED' } }),
    );
    expect(tx.memsRequestLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
  });

  it('lý do được lưu kèm bản ghi quyết định', async () => {
    const { prisma, tx } = buildDeps();
    await new ApprovalService(prisma).reject('req-1', LEADER1, { reason: '  Hết máy  ' });

    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: 'REJECTED', reason: 'Hết máy' }),
      }),
    );
  });
});

describe('ApprovalService — chốt chặn vai trò', () => {
  it('người đứng tên phiếu không tự duyệt được', async () => {
    // Chốt chặn quan trọng nhất: leader và admin làm được gần như mọi việc như nhau, nên nếu
    // người xin ký được cho chính mình thì cấp duyệt chỉ còn là một nút bấm thừa.
    const { prisma, tx } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve('req-1', { id: 'nguoi-muon', roles: ['LEADER'] }, {}),
    ).rejects.toThrow(/Không tự duyệt/);
    expect(tx.memsApproval.create).not.toHaveBeenCalled();
  });

  it('member không ký được cấp nào', async () => {
    const { prisma } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve('req-1', { id: 'ai-do', roles: ['MEMBER'] }, {}),
    ).rejects.toThrow(/phải do LEADER ký/);
  });

  it('leader KHÔNG ký thay được cấp của admin ở phiếu mang ra ngoài', async () => {
    // Cửa canh tài sản ra khỏi công ty phải do admin gác, không thì chỉ là hình thức.
    const { prisma } = buildDeps({
      place: 'Đà Nẵng',
      approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
    });
    await expect(
      new ApprovalService(prisma).approve('req-1', LEADER2, {}),
    ).rejects.toThrow(/phải do ADMIN ký/);
  });

  it('admin ký thay được cấp của leader khi không còn ai khác', async () => {
    const { prisma } = buildDeps();
    const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});
    expect(result.status).toBe('APPROVED');
  });

  it('cấp được ghi đúng số thứ tự trong kế hoạch, không phải đếm bản ghi', async () => {
    const { prisma, tx } = buildDeps({
      place: 'Đà Nẵng',
      approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
    });
    await new ApprovalService(prisma).approve('req-1', ADMIN, {});
    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 2 }) }),
    );
  });
});

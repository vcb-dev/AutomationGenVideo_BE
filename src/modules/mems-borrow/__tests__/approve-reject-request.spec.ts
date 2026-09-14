import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApprovalService } from '../approval.service';

// Kho thiết bị là tài sản của bộ phận Media, nên người ký cấp leader phải thuộc team đó.
const LEADER1 = { id: 'leader-1', roles: ['LEADER'], team: 'MEDIA' };
const LEADER2 = { id: 'leader-2', roles: ['LEADER'], team: 'MEDIA' };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
    owner_id: 'nguoi-muon',
    status: 'PENDING_APPROVAL',
    from_time: new Date('2026-08-12T08:00:00Z'),
    to_time: new Date('2026-08-13T18:00:00Z'),
    place: 'Studio',
    purpose: 'WORK',
    approvals: [],
    lines: [{ quantity: 1, model: { reference_price: 10_000_000 } }],
    ...over,
  };
  const tx = {
    // Khai tham số để test đọc được mock.calls[0][0] khi kiểm khoá.
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
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

describe('ApprovalService.decide — chống hai người ký cùng lúc', () => {
  it('khoá phiếu trước khi đọc danh sách chữ ký', async () => {
    // Không khoá thì hai người bấm Duyệt cùng khoảnh khắc sẽ cùng đọc thấy "chưa ai ký", cùng
    // tính ra cấp 1 và cùng ghi một bản ghi cấp 1. Với phiếu hai cấp, phiếu kẹt vĩnh viễn:
    // `approvedSoFar` thành 2 nên `nextStep` trả null, mọi lần ký sau đều nhận "đã đủ chữ ký"
    // trong khi phiếu vẫn PENDING_APPROVAL — mà module không có endpoint sửa hay huỷ phiếu.
    // Schema cũng không có ràng buộc duy nhất (request_id, level) để chặn giúp.
    const { prisma, tx } = buildDeps();
    await new ApprovalService(prisma).approve('req-1', LEADER1, {});

    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(String(tx.$executeRawUnsafe.mock.calls[0][1])).toContain('req-1');
  });

  it('từ chối cũng đi qua cùng cái khoá đó', async () => {
    const { prisma, tx } = buildDeps();
    await new ApprovalService(prisma).reject('req-1', LEADER1, { reason: 'Trùng lịch quay' });

    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });
});

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
    // Mượn cho việc riêng nên cần thêm chữ ký admin; chuyển sang APPROVED sớm là bỏ qua cấp hai.
    const { prisma, tx } = buildDeps({ purpose: 'PERSONAL' });
    await new ApprovalService(prisma).approve('req-1', LEADER1, {});

    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
    );
  });

  it('phiếu hai cấp: cấp hai ký xong mới thành APPROVED', async () => {
    const { prisma } = buildDeps({
      purpose: 'PERSONAL',
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
  it('người đứng tên phiếu nếu không phải Leader Media/Admin thì không tự duyệt được', async () => {
    const { prisma, tx } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve(
        'req-1',
        { id: 'nguoi-muon', roles: ['LEADER'], team: 'Team K1' },
        {},
      ),
    ).rejects.toThrow(/Không tự duyệt/);
    expect(tx.memsApproval.create).not.toHaveBeenCalled();
  });

  it('leader Team Media tự duyệt được phiếu do chính mình tạo', async () => {
    const { prisma } = buildDeps();
    const result = await new ApprovalService(prisma).approve(
      'req-1',
      { id: 'nguoi-muon', roles: ['LEADER'], team: 'MEDIA' },
      {},
    );
    expect(result.status).toBe('APPROVED');
  });

  it('member không ký được cấp nào', async () => {
    const { prisma } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve('req-1', { id: 'ai-do', roles: ['MEMBER'] }, {}),
    ).rejects.toThrow(/phải do LEADER ký/);
  });

  it('leader KHÔNG ký thay được cấp của admin ở phiếu mượn cá nhân', async () => {
    // Cửa canh thiết bị rời khỏi việc công ty phải do admin gác, không thì chỉ là hình thức.
    const { prisma } = buildDeps({
      purpose: 'PERSONAL',
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

  it('leader team khác KHÔNG ký duyệt được phiếu mượn thiết bị', async () => {
    const { prisma } = buildDeps();
    await expect(
      new ApprovalService(prisma).approve(
        'req-1',
        { id: 'leader-k1', roles: ['LEADER'], team: 'Team K1' },
        {},
      ),
    ).rejects.toThrow(/phải do LEADER ký/);
  });

  it('leader Team Media ký duyệt thành công', async () => {
    const { prisma } = buildDeps();
    const result = await new ApprovalService(prisma).approve(
      'req-1',
      { id: 'leader-media', roles: ['LEADER'], team: 'MEDIA' },
      {},
    );
    expect(result.status).toBe('APPROVED');
  });

  it('cấp được ghi đúng số thứ tự trong kế hoạch, không phải đếm bản ghi', async () => {
    // Ghi `level` bằng cách đếm số bản ghi duyệt đã có thì một lần từ chối rồi ký lại sẽ đẩy
    // số cấp lệch đi, và nhật ký duyệt của phiếu không còn khớp với kế hoạch chữ ký.
    const { prisma, tx } = buildDeps({
      purpose: 'PERSONAL',
      approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
    });
    await new ApprovalService(prisma).approve('req-1', ADMIN, {});

    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 2 }) }),
    );
  });
});

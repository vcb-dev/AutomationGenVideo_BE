import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApprovalService } from '../approval.service';

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
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
    const result = await new ApprovalService(prisma).approve('req-1', 'user-1', {});

    expect(result.status).toBe('APPROVED');
    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CONFIRMED' } }),
    );
  });

  it('phiếu hai cấp: cấp một ký xong phiếu vẫn nằm chờ', async () => {
    // Giá trị vượt ngưỡng nên BR-22 đòi hai cấp; chuyển sang APPROVED sớm là bỏ qua cấp hai.
    const { prisma, tx } = buildDeps({
      lines: [{ quantity: 1, model: { reference_price: 90_000_000 } }],
    });
    await new ApprovalService(prisma).approve('req-1', 'user-1', {});

    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
    );
  });

  it('phiếu hai cấp: cấp hai ký xong mới thành APPROVED', async () => {
    const { prisma } = buildDeps({
      lines: [{ quantity: 1, model: { reference_price: 90_000_000 } }],
      approvals: [{ decided_by: 'user-1', decision: 'APPROVED' }],
    });
    const result = await new ApprovalService(prisma).approve('req-1', 'user-2', {});

    expect(result.status).toBe('APPROVED');
  });

  it('BR-23: một người không ký được hai lần cho cùng phiếu', async () => {
    // Ký hai lần là tự mình đủ hai cấp, vô hiệu hoá toàn bộ ý nghĩa của cấp duyệt thứ hai.
    const { prisma } = buildDeps({
      approvals: [{ decided_by: 'user-1', decision: 'APPROVED' }],
    });
    await expect(
      new ApprovalService(prisma).approve('req-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('phiếu đã duyệt rồi thì không duyệt lại được', async () => {
    const { prisma } = buildDeps({ status: 'APPROVED' });
    await expect(
      new ApprovalService(prisma).approve('req-1', 'user-9', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ApprovalService.reject', () => {
  it('BR-20: lý do toàn khoảng trắng vẫn bị chặn', async () => {
    // @IsNotEmpty của DTO cho chuỗi khoảng trắng lọt qua, nên service phải tự chặn.
    const { prisma } = buildDeps();
    await expect(
      new ApprovalService(prisma).reject('req-1', 'user-1', { reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('BR-32: từ chối nhả giữ chỗ ngay trong cùng giao dịch', async () => {
    // Để sang lượt sau thì khoảng đó vẫn hiện là bận, người khác không xin được máy đang rảnh.
    const { prisma, tx } = buildDeps();
    const result = await new ApprovalService(prisma).reject('req-1', 'user-1', {
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
    await new ApprovalService(prisma).reject('req-1', 'user-1', { reason: '  Hết máy  ' });

    expect(tx.memsApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: 'REJECTED', reason: 'Hết máy' }),
      }),
    );
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalService } from '../approval.service';

/**
 * Ai được nhìn thấy phiếu mượn của ai.
 *
 * Phiếu mượn lộ dự án, địa điểm, tên và email người mượn của cả công ty. Trước đây hai endpoint
 * này không có `@Roles` lẫn guard nào, nên bất kỳ tài khoản đăng nhập nào cũng đọc được toàn bộ
 * — trong khi chính module này lọc rất kỹ ở `AssetBorrowHistoryService` ("thành viên chỉ thấy
 * lượt của mình"). Cửa rộng nhất lại là cửa để mở.
 *
 * Lọc phải nằm TRONG câu truy vấn. Lọc sau khi đã nạp thì dữ liệu người khác vẫn rời khỏi máy chủ.
 */
const MEMBER = { id: 'member-1', roles: ['MEMBER'], team: 'Team K1' };
const LEADER_KHAC = { id: 'leader-k1', roles: ['LEADER'], team: 'Team K1' };
const LEADER_MEDIA = { id: 'leader-media', roles: ['LEADER'], team: 'MEDIA' };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

function buildPrisma(request: any = null) {
  return {
    memsBorrowRequest: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => request),
    },
    user: { findMany: jest.fn(async () => []) },
  } as any;
}

const REQUEST_CUA_NGUOI_KHAC = {
  id: 'req-1',
  request_code: 'REQ-20260815-001',
  owner_id: 'nguoi-khac',
  from_time: new Date('2026-08-15T02:00:00Z'),
  to_time: new Date('2026-08-16T10:00:00Z'),
  place: 'Studio A',
  purpose: 'WORK',
  lines: [],
  approvals: [],
};

describe('ApprovalService.list — lọc theo người xem', () => {
  it('thành viên thường chỉ thấy phiếu của chính mình', async () => {
    const prisma = buildPrisma();
    await new ApprovalService(prisma).list({}, MEMBER);

    expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBe('member-1');
  });

  it('leader bộ phận khác cũng chỉ thấy phiếu của chính mình', async () => {
    // Kho là tài sản của bộ phận Media. Mang chức leader ở bộ phận khác không cho quyền đọc
    // thói quen mượn máy của cả công ty.
    const prisma = buildPrisma();
    await new ApprovalService(prisma).list({}, LEADER_KHAC);

    expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBe('leader-k1');
  });

  it('leader Team Media và admin thấy toàn bộ', async () => {
    for (const viewer of [LEADER_MEDIA, ADMIN]) {
      const prisma = buildPrisma();
      await new ApprovalService(prisma).list({}, viewer);

      expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBeUndefined();
    }
  });

  it('lọc theo người xem không đè mất bộ lọc trạng thái', async () => {
    // Màn Duyệt phiếu gọi kèm status. Ghép sai thì hoặc mất bộ lọc trạng thái, hoặc mất chốt
    // quyền — cả hai đều hỏng âm thầm.
    const prisma = buildPrisma();
    await new ApprovalService(prisma).list({ status: 'PENDING_APPROVAL' }, MEMBER);

    const where = prisma.memsBorrowRequest.findMany.mock.calls[0][0].where;
    expect(where.owner_id).toBe('member-1');
    expect(where.status).toBe('PENDING_APPROVAL');
  });

  it('lọc nhiều trạng thái cùng lúc vẫn giữ chốt quyền', async () => {
    const prisma = buildPrisma();
    await new ApprovalService(prisma).list({ status: 'ON_LOAN,PARTIALLY_RETURNED' }, MEMBER);

    const where = prisma.memsBorrowRequest.findMany.mock.calls[0][0].where;
    expect(where.owner_id).toBe('member-1');
    expect(where.status).toEqual({ in: ['ON_LOAN', 'PARTIALLY_RETURNED'] });
  });
});

describe('ApprovalService.detail — lọc theo người xem', () => {
  it('thành viên KHÔNG xem được phiếu của người khác', async () => {
    const prisma = buildPrisma(REQUEST_CUA_NGUOI_KHAC);
    await expect(
      new ApprovalService(prisma).detail('req-1', MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('thành viên xem được phiếu của chính mình', async () => {
    const prisma = buildPrisma({ ...REQUEST_CUA_NGUOI_KHAC, owner_id: MEMBER.id });
    const result = await new ApprovalService(prisma).detail('req-1', MEMBER);

    expect(result.request_code).toBe('REQ-20260815-001');
  });

  it('leader Team Media xem được mọi phiếu', async () => {
    const prisma = buildPrisma(REQUEST_CUA_NGUOI_KHAC);
    const result = await new ApprovalService(prisma).detail('req-1', LEADER_MEDIA);

    expect(result.request_code).toBe('REQ-20260815-001');
  });

  it('phiếu không tồn tại thì báo không tìm thấy, không phải không có quyền', async () => {
    // Trả 403 cho phiếu không tồn tại là nói dối người dùng và khiến họ đi hỏi quyền vô ích.
    const prisma = buildPrisma(null);
    await expect(
      new ApprovalService(prisma).detail('req-lạ', LEADER_MEDIA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

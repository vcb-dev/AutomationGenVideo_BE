import { BadRequestException } from '@nestjs/common';
import { BorrowRequestService } from '../borrow-request.service';

/**
 * Gọi thẳng hàm suy bộ phận qua create(), vì nó là bước đầu tiên trong giao dịch.
 * Chỉ cần mock đủ những gì create() chạm tới.
 */
function buildDeps(over: {
  membership?: { department_id: string } | null;
  team?: string | null;
  departments?: { id: string }[];
  matchedByTeam?: { id: string } | null;
}) {
  const captured: any = {};
  const tx = {
    $executeRawUnsafe: jest.fn(async () => 1),
    memsMember: { findFirst: jest.fn(async () => over.membership ?? null) },
    user: { findUnique: jest.fn(async () => ({ team: over.team ?? null })) },
    memsDepartment: {
      findFirst: jest.fn(async () => over.matchedByTeam ?? null),
      findMany: jest.fn(async () => over.departments ?? []),
    },
    memsBorrowRequest: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => {
        captured.request = data;
        return { id: 'req-1', ...data };
      }),
    },
    memsRequestLine: { create: jest.fn(async ({ data }: any) => ({ id: 'line-1', ...data })) },
    memsReservation: { createMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const availability: any = {
    check: jest.fn(async () => ({
      available: 5,
      enough: true,
      shortBy: 0,
      bufferMinutes: 0,
      bufferedTo: new Date('2026-10-03T10:00:00Z'),
      busyByReservation: 0,
      busyByMaintenance: 0,
    })),
  };
  return { prisma, availability, captured, tx };
}

const DTO = {
  project: 'Quay TVC',
  place: 'Studio',
  fromTime: '2026-10-01T01:00:00Z',
  toTime: '2026-10-03T10:00:00Z',
  lines: [{ modelId: 'model-1', quantity: 1 }],
};

describe('BorrowRequestService — suy bộ phận từ người đăng nhập', () => {
  it('có bản ghi thành viên MEMS thì lấy bộ phận đó, nguồn chắc chắn nhất', async () => {
    const { prisma, availability, captured } = buildDeps({
      membership: { department_id: 'dep-mems' },
    });
    await new BorrowRequestService(prisma, availability).create('user-1', DTO);

    expect(captured.request.department_id).toBe('dep-mems');
  });

  it('chưa có thành viên thì khớp team trên hồ sơ với mã hoặc tên bộ phận', async () => {
    const { prisma, availability, captured } = buildDeps({
      membership: null,
      team: 'MEDIA',
      matchedByTeam: { id: 'dep-media' },
    });
    await new BorrowRequestService(prisma, availability).create('user-1', DTO);

    expect(captured.request.department_id).toBe('dep-media');
  });

  it('không khớp được team nhưng cả hệ thống chỉ có một bộ phận thì dùng luôn nó', async () => {
    // Giai đoạn đầu chỉ bộ phận Media dùng MEMS — bắt gán thành viên trước khi mượn được
    // là dựng rào cho một lựa chọn không có gì để chọn.
    const { prisma, availability, captured } = buildDeps({
      membership: null,
      team: 'Team K2',
      matchedByTeam: null,
      departments: [{ id: 'dep-duy-nhat' }],
    });
    await new BorrowRequestService(prisma, availability).create('user-1', DTO);

    expect(captured.request.department_id).toBe('dep-duy-nhat');
  });

  it('nhiều bộ phận mà không suy được thì báo lỗi chỉ rõ phải làm gì, không đoán bừa', async () => {
    // Đoán bừa một bộ phận là quy trách nhiệm sai người khi máy hỏng.
    const { prisma, availability } = buildDeps({
      membership: null,
      team: null,
      matchedByTeam: null,
      departments: [{ id: 'dep-1' }, { id: 'dep-2' }],
    });
    await expect(
      new BorrowRequestService(prisma, availability).create('user-1', DTO),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('client vẫn truyền departmentId thì tôn trọng, không tra lại', async () => {
    const { prisma, availability, captured, tx } = buildDeps({ membership: null });
    await new BorrowRequestService(prisma, availability).create('user-1', {
      ...DTO,
      departmentId: 'dep-client-chon',
    });

    expect(captured.request.department_id).toBe('dep-client-chon');
    expect(tx.memsMember.findFirst).not.toHaveBeenCalled();
  });
});

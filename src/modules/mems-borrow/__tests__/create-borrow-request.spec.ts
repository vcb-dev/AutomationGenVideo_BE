import { BadRequestException } from '@nestjs/common';
import { BorrowRequestService } from '../borrow-request.service';

const DTO = {
  departmentId: 'dept-1',
  project: 'Quay TVC tháng 8',
  place: 'Studio A',
  fromTime: '2026-08-15T02:00:00Z',
  toTime: '2026-08-16T10:00:00Z',
  lines: [{ modelId: 'model-1', quantity: 2 }],
};

function buildDeps(available: number) {
  const created: any = { lines: [], reservations: [] };
  const tx = {
    // Khai báo tham số để TypeScript cho phép đọc mock.calls[0][0] ở test kiểm tra khoá.
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    memsBorrowRequest: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'req-1', ...data })),
    },
    memsRequestLine: {
      create: jest.fn(async ({ data }: any) => {
        created.lines.push(data);
        return { id: `line-${created.lines.length}`, ...data };
      }),
    },
    memsReservation: {
      createMany: jest.fn(async ({ data }: any) => {
        created.reservations.push(...data);
        return { count: data.length };
      }),
    },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const availability: any = {
    check: jest.fn(async () => ({
      available,
      enough: available >= 2,
      shortBy: Math.max(0, 2 - available),
      bufferMinutes: 120,
      bufferedTo: new Date('2026-08-16T12:00:00Z'),
      busyByReservation: 0,
      busyByMaintenance: 0,
    })),
  };
  return { prisma, tx, availability, created };
}

describe('BorrowRequestService.create', () => {
  it('đủ máy thì dòng ở trạng thái Đã giữ chỗ và sinh đúng số bản ghi giữ chỗ', async () => {
    // Xin 2 máy thì phải có 2 bản ghi: hàm khả dụng đếm số BẢN GHI, không đọc cột số lượng.
    const { prisma, availability, created } = buildDeps(5);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO);

    expect(created.lines[0].status).toBe('RESERVED');
    expect(created.reservations).toHaveLength(2);
  });

  it('bản ghi giữ chỗ mang buffer_to_time chứ không phải to_time', async () => {
    const { prisma, availability, created } = buildDeps(5);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO);

    expect(created.reservations[0].buffer_to_time.toISOString()).toBe('2026-08-16T12:00:00.000Z');
    expect(created.reservations[0].to_time.toISOString()).toBe('2026-08-16T10:00:00.000Z');
  });

  it('thiếu máy thì vẫn nhận phiếu, dòng chuyển sang Chờ hàng và KHÔNG giữ chỗ', async () => {
    // QĐ-08: không chặn cứng. Chặn thì người dùng quay lại mượn tay và hệ thống mất dữ liệu.
    const { prisma, availability, created } = buildDeps(0);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO);

    expect(created.lines[0].status).toBe('BACKORDERED');
    expect(created.reservations).toHaveLength(0);
  });

  it('khoá theo model trước khi ghi giữ chỗ', async () => {
    // BR-13: hai người cùng xin chiếc máy cuối cùng thì người sau phải nhận Chờ hàng,
    // không được cùng ghi giữ chỗ rồi kho phát hiện thiếu lúc bàn giao.
    const { prisma, tx, availability } = buildDeps(5);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO);

    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('thời điểm trả không sau thời điểm nhận thì báo lỗi', async () => {
    const { prisma, availability } = buildDeps(5);
    const service = new BorrowRequestService(prisma, availability);

    await expect(
      service.create('user-1', { ...DTO, toTime: DTO.fromTime }),
    ).rejects.toThrow(BadRequestException);
  });
});

/**
 * Một phiếu có hai dòng CÙNG model.
 *
 * Khoá `pg_advisory_xact_lock` chỉ xếp hàng hai NGƯỜI khác nhau; nó không ngăn một phiếu tự đá
 * nhau. Thứ ngăn được điều đó là dòng thứ hai phải nhìn thấy giữ chỗ mà dòng thứ nhất vừa ghi —
 * nghĩa là phép đếm khả dụng phải chạy trên chính client của giao dịch, không phải một kết nối
 * khác đứng ngoài.
 *
 * Fake dưới đây mô phỏng đúng ranh giới đó: chỉ client của giao dịch mới thấy bản ghi chưa commit.
 */
function buildSameModelDeps(totalAssets: number) {
  const created: any = { lines: [], reservations: [] };
  const tx: any = {
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    memsMember: { findFirst: jest.fn(async () => ({ department_id: 'dept-1' })) },
    user: { findUnique: jest.fn(async () => ({ team: 'MEDIA' })) },
    memsDepartment: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    memsBorrowRequest: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'req-1', ...data })),
    },
    memsRequestLine: {
      create: jest.fn(async ({ data }: any) => {
        created.lines.push(data);
        return { id: `line-${created.lines.length}`, ...data };
      }),
    },
    memsReservation: {
      createMany: jest.fn(async ({ data }: any) => {
        created.reservations.push(...data);
        return { count: data.length };
      }),
    },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

  const availability: any = {
    check: jest.fn(async (args: any, client?: any) => {
      // Kết nối đứng ngoài giao dịch KHÔNG thấy bản ghi chưa commit — đó là toàn bộ nội dung
      // của lỗi này. Chỉ khi được truyền đúng `tx` thì số giữ chỗ đang dở mới trừ vào.
      const seesUncommitted = client === tx;
      const held = seesUncommitted ? created.reservations.length : 0;
      const available = Math.max(0, totalAssets - held);
      return {
        available,
        enough: available >= args.quantity,
        shortBy: Math.max(0, args.quantity - available),
        bufferMinutes: 120,
        bufferedTo: new Date('2026-08-16T12:00:00Z'),
        busyByReservation: held,
        busyByMaintenance: 0,
      };
    }),
  };
  return { prisma, tx, availability, created };
}

describe('BorrowRequestService.create — hai dòng cùng một model', () => {
  const DTO_TRUNG_MODEL = {
    ...DTO,
    lines: [
      { modelId: 'model-1', quantity: 2 },
      { modelId: 'model-1', quantity: 2 },
    ],
  };

  it('không giữ chỗ vượt quá số máy thực có của model', async () => {
    // Kho có đúng 2 chiếc. Dòng đầu giữ hết 2, dòng sau phải là Chờ hàng chứ không được giữ
    // thêm 2 chiếc không tồn tại — nếu không, kho chỉ phát hiện thiếu vào đúng lúc gán serial.
    const { prisma, availability, created } = buildSameModelDeps(2);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO_TRUNG_MODEL);

    expect(created.reservations).toHaveLength(2);
    expect(created.lines[0].status).toBe('RESERVED');
    expect(created.lines[1].status).toBe('BACKORDERED');
  });

  it('hỏi khả dụng bằng chính client của giao dịch', async () => {
    const { prisma, tx, availability } = buildSameModelDeps(4);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO_TRUNG_MODEL);

    for (const call of availability.check.mock.calls) {
      expect(call[1]).toBe(tx);
    }
  });

  it('đủ máy cho cả hai dòng thì cả hai đều được giữ chỗ', async () => {
    const { prisma, availability, created } = buildSameModelDeps(4);
    const service = new BorrowRequestService(prisma, availability);

    await service.create('user-1', DTO_TRUNG_MODEL);

    expect(created.reservations).toHaveLength(4);
    expect(created.lines.every((l: any) => l.status === 'RESERVED')).toBe(true);
  });
});

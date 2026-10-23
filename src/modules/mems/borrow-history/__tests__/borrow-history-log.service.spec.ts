import { BorrowHistoryLogService } from '../borrow-history-log.service';

/**
 * Chức năng: nhật ký toàn bộ lượt mượn của cả kho, có lọc và phân trang.
 *
 * Khác với lịch sử theo từng máy (`asset-borrow-history.service.ts`) ở chỗ nó nhìn ngang toàn
 * kho, nên câu hỏi quan trọng nhất đổi thành: "ai đang giữ gì và có quá hạn không". Vì vậy phải
 * lọc được theo trạng thái và theo khoảng ngày, và MẶC ĐỊNH sắp xếp lượt mới nhất lên đầu —
 * nhật ký mà xếp cũ trước thì mở ra chỉ thấy chuyện năm ngoái.
 *
 * Quyền xem đã chốt là chỉ ADMIN/quản lý kho, và chốt đó đặt ở controller (`@Roles`) chứ không
 * ở đây — service này luôn trả toàn kho.
 */

const HANDED = '2026-08-02T09:00:00Z';
const NOW = new Date('2026-08-20T00:00:00Z');

function line(over: {
  asset?: string;
  owner?: string;
  project?: string;
  receivedAt?: string;
  dueAt?: string | null;
  returnedAt?: string | null;
}) {
  return {
    asset: { id: `id-${over.asset ?? 'CAM-001'}`, asset_code: over.asset ?? 'CAM-001' },
    handover: {
      received_at: new Date(over.receivedAt ?? HANDED),
      request: {
        owner_id: over.owner ?? 'user-a',
        project: over.project ?? 'Dự án X',
        to_time: over.dueAt === null ? null : new Date(over.dueAt ?? '2026-08-07T09:00:00Z'),
      },
    },
    returnLines: over.returnedAt
      ? [{ returnRecord: { returned_at: new Date(over.returnedAt) } }]
      : [],
  };
}

function buildService(lines: any[], total = lines.length) {
  const findMany = jest.fn(async (_args: any) => lines);
  const count = jest.fn(async (_args: any) => total);
  const prisma: any = {
    memsHandoverLine: { findMany, count },
    user: {
      findMany: jest.fn(async () => [
        { id: 'user-a', full_name: 'Nguyễn Văn A' },
        { id: 'user-b', full_name: 'Trần Thị B' },
      ]),
    },
  };
  return { service: new BorrowHistoryLogService(prisma), findMany, count };
}

describe('BorrowHistoryLogService.list', () => {
  it('trả về lượt mượn kèm mã máy, tên người và số ngày giữ', async () => {
    const { service } = buildService([
      line({ asset: 'CAM-001', owner: 'user-a', returnedAt: '2026-08-09T09:00:00Z' }),
    ]);

    const res = await service.list({}, NOW);

    expect(res.rows[0].assetCode).toBe('CAM-001');
    expect(res.rows[0].borrowerName).toBe('Nguyễn Văn A');
    expect(res.rows[0].heldDays).toBe(7);
    expect(res.rows[0].lateDays).toBe(2);
  });

  it('mặc định xếp lượt mới nhất lên đầu', async () => {
    const { service } = buildService([
      line({ asset: 'A', receivedAt: '2026-07-20T09:00:00Z', returnedAt: '2026-07-25T09:00:00Z' }),
      line({ asset: 'B', receivedAt: '2026-08-02T09:00:00Z', returnedAt: '2026-08-09T09:00:00Z' }),
    ]);

    const res = await service.list({}, NOW);

    expect(res.rows[0].assetCode).toBe('B');
  });

  it('lọc "đang giữ" chỉ trả về máy chưa trả và CÒN trong hạn', async () => {
    const { service } = buildService([
      line({ asset: 'A', returnedAt: '2026-08-09T09:00:00Z' }),
      // Hạn phải nằm ở tương lai, nếu không máy chưa trả sẽ là OVERDUE chứ không phải HOLDING —
      // đó là hai ca khác nhau và bộ lọc phải tách được.
      line({ asset: 'B', returnedAt: null, dueAt: '2026-09-30T09:00:00Z' }),
    ]);

    const res = await service.list({ status: 'HOLDING' }, NOW);

    expect(res.rows.map((r) => r.assetCode)).toEqual(['B']);
  });

  it('lọc "quá hạn" chỉ trả về máy còn ở ngoài VÀ đã trễ', async () => {
    const { service } = buildService([
      // chưa trả, còn trong hạn → không phải quá hạn
      line({ asset: 'A', returnedAt: null, dueAt: '2026-09-30T09:00:00Z' }),
      // chưa trả, đã trễ → đúng ca cần tìm
      line({ asset: 'B', returnedAt: null, dueAt: '2026-08-07T09:00:00Z' }),
      // đã trả tuy trễ → máy đã về kho, KHÔNG tính là quá hạn
      line({ asset: 'C', returnedAt: '2026-08-09T09:00:00Z', dueAt: '2026-08-07T09:00:00Z' }),
    ]);

    const res = await service.list({ status: 'OVERDUE' }, NOW);

    expect(res.rows.map((r) => r.assetCode)).toEqual(['B']);
  });

  it('lọc khoảng ngày được đẩy xuống truy vấn, không lọc sau khi đã lấy hết về', async () => {
    const { service, findMany } = buildService([]);

    await service.list({ from: '2026-08-01', to: '2026-08-31' }, NOW);

    const where = findMany.mock.calls[0][0].where;
    expect(where.handover.received_at.gte).toEqual(new Date('2026-08-01'));
    expect(where.handover.received_at.lte).toBeDefined();
  });

  it('phân trang: trả kèm tổng số để giao diện dựng được thanh trang', async () => {
    const { service, findMany } = buildService([line({})], 57);

    const res = await service.list({ page: 3, pageSize: 20 }, NOW);

    expect(res.total).toBe(57);
    expect(res.page).toBe(3);
    expect(findMany.mock.calls[0][0].skip).toBe(40);
    expect(findMany.mock.calls[0][0].take).toBe(20);
  });

  it('chặn pageSize quá lớn để một lần bấm không kéo cả kho về', async () => {
    const { service, findMany } = buildService([]);

    await service.list({ pageSize: 5000 }, NOW);

    expect(findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });

  it('lọc trạng thái thì total phải khớp số dòng thật, không phải tổng chưa lọc', async () => {
    // Đây là lỗi quan sát được trên màn hình: bảng báo "không có lượt nào khớp" mà góc phải
    // vẫn ghi "2 lượt". Người dùng không biết tin cái nào.
    const { service } = buildService(
      [
        line({ asset: 'A', returnedAt: '2026-08-09T09:00:00Z' }),
        line({ asset: 'B', returnedAt: '2026-08-09T09:00:00Z' }),
      ],
      2,
    );

    const res = await service.list({ status: 'OVERDUE' }, NOW);

    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  it('không có lượt nào thì trả rỗng kèm total 0, không lỗi', async () => {
    const { service } = buildService([], 0);

    const res = await service.list({}, NOW);

    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
  });
});

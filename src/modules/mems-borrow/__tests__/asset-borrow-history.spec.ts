import { AssetBorrowHistoryService } from '../asset-borrow-history.service';

/**
 * Chức năng: lịch sử "máy này từng ai mượn", lọc theo quyền người xem.
 *
 * Vì sao đáng một file test riêng: đây là chỗ dữ liệu của người này lộ ra cho người khác nếu
 * lọc sai. Luật đã chốt: thành viên thường CHỈ thấy lượt mượn của chính mình; ADMIN và quản lý
 * kho thấy toàn bộ. Sai chiều nào cũng hỏng — lọc lỏng thì lộ, lọc chặt quá thì quản lý kho
 * không truy được ai đang giữ máy.
 *
 * Mỗi `MemsHandoverLine` của một máy là một lượt mượn: giao lúc `handover.received_at`, trả lúc
 * `returnLines[].returnRecord.returned_at` (chưa có nghĩa là đang giữ).
 */

const ASSET = 'asset-1';

function line(over: {
  ownerId: string;
  ownerName?: string;
  project?: string;
  receivedAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
}) {
  return {
    id: `line-${over.receivedAt}`,
    handover: {
      received_at: new Date(over.receivedAt),
      request: {
        owner_id: over.ownerId,
        project: over.project ?? 'Dự án X',
        to_time: over.dueAt === null ? null : new Date(over.dueAt ?? '2026-08-07T09:00:00Z'),
      },
    },
    returnLines: over.returnedAt
      ? [{ returnRecord: { returned_at: new Date(over.returnedAt) } }]
      : [],
  };
}

function buildService(lines: any[]) {
  const findMany = jest.fn(async (_args: any) => lines);
  const prisma: any = {
    memsHandoverLine: { findMany },
    user: {
      findMany: jest.fn(async () => [
        { id: 'user-a', full_name: 'Nguyễn Văn A' },
        { id: 'user-b', full_name: 'Trần Thị B' },
      ]),
    },
  };
  return { service: new AssetBorrowHistoryService(prisma), findMany };
}

const NOW = new Date('2026-08-20T00:00:00Z');

describe('AssetBorrowHistoryService.forAsset', () => {
  it('thành viên thường chỉ thấy lượt mượn của chính mình', async () => {
    const { service } = buildService([
      line({ ownerId: 'user-a', receivedAt: '2026-08-02T09:00:00Z', returnedAt: '2026-08-07T09:00:00Z' }),
      line({ ownerId: 'user-b', receivedAt: '2026-07-20T09:00:00Z', returnedAt: '2026-07-25T09:00:00Z' }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'user-a', roles: ['MEMBER'] }, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0].borrowerId).toBe('user-a');
  });

  it('ADMIN thấy toàn bộ lượt mượn của máy', async () => {
    const { service } = buildService([
      line({ ownerId: 'user-a', receivedAt: '2026-08-02T09:00:00Z', returnedAt: '2026-08-07T09:00:00Z' }),
      line({ ownerId: 'user-b', receivedAt: '2026-07-20T09:00:00Z', returnedAt: '2026-07-25T09:00:00Z' }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'user-a', roles: ['ADMIN'] }, NOW);

    expect(rows).toHaveLength(2);
  });

  it('sắp xếp lượt mới nhất lên đầu', async () => {
    const { service } = buildService([
      line({ ownerId: 'user-a', receivedAt: '2026-07-20T09:00:00Z', returnedAt: '2026-07-25T09:00:00Z' }),
      line({ ownerId: 'user-b', receivedAt: '2026-08-02T09:00:00Z', returnedAt: '2026-08-07T09:00:00Z' }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(rows[0].handedOverAt).toEqual(new Date('2026-08-02T09:00:00Z'));
  });

  it('kèm sẵn số ngày giữ và số ngày trễ cho từng lượt', async () => {
    const { service } = buildService([
      line({
        ownerId: 'user-a',
        receivedAt: '2026-08-02T09:00:00Z',
        dueAt: '2026-08-07T09:00:00Z',
        returnedAt: '2026-08-09T09:00:00Z',
      }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(rows[0].heldDays).toBe(7);
    expect(rows[0].lateDays).toBe(2);
    expect(rows[0].status).toBe('RETURNED');
  });

  it('lượt chưa trả hiện là đang giữ, không phải đã trả', async () => {
    const { service } = buildService([
      line({ ownerId: 'user-a', receivedAt: '2026-08-18T09:00:00Z', dueAt: '2026-08-25T09:00:00Z' }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(rows[0].status).toBe('HOLDING');
    expect(rows[0].returnedAt).toBeNull();
  });

  it('kèm tên người mượn để giao diện khỏi phải gọi thêm', async () => {
    const { service } = buildService([
      line({ ownerId: 'user-a', receivedAt: '2026-08-02T09:00:00Z', returnedAt: '2026-08-07T09:00:00Z' }),
    ]);

    const rows = await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(rows[0].borrowerName).toBe('Nguyễn Văn A');
  });

  it('máy chưa ai mượn thì trả danh sách rỗng, không lỗi', async () => {
    const { service } = buildService([]);

    const rows = await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(rows).toEqual([]);
  });

  it('chỉ truy vấn đúng máy được hỏi', async () => {
    const { service, findMany } = buildService([]);

    await service.forAsset(ASSET, { id: 'x', roles: ['ADMIN'] }, NOW);

    expect(findMany.mock.calls[0][0].where.asset_id).toBe(ASSET);
  });
});

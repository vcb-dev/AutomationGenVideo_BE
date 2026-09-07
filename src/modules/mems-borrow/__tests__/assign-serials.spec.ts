import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssignmentService } from '../assignment.service';

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
    status: 'APPROVED',
    lines: [
      {
        id: 'line-1',
        model_id: 'model-1',
        quantity: 2,
        reservations: [
          { id: 'res-1', status: 'CONFIRMED' },
          { id: 'res-2', status: 'CONFIRMED' },
        ],
      },
    ],
    ...over,
  };
  const assets = over.assets ?? [
    { id: 'asset-1', asset_code: 'CAM-001', model_id: 'model-1', condition: 'GOOD' },
    { id: 'asset-2', asset_code: 'CAM-002', model_id: 'model-1', condition: 'USED' },
  ];
  const tx = {
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    // Lọc theo đúng `where.id.in` như Prisma thật. Bản trước trả về TOÀN BỘ danh sách bất kể
    // bộ lọc, nên phiếu nhiều dòng bị hiểu nhầm là "có mã máy không tồn tại" — mock nói dối thì
    // test đa dòng không dựng được.
    memsAsset: {
      findMany: jest.fn(async (args: any) => {
        const wanted: string[] | undefined = args?.where?.id?.in;
        return wanted ? assets.filter((a: any) => wanted.includes(a.id)) : assets;
      }),
    },

    memsReservation: { update: jest.fn(async ({ data }: any) => data) },
    memsRequestLine: { update: jest.fn(async ({ data }: any) => data) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx, request };
}

const DTO = { lines: [{ lineId: 'line-1', assetIds: ['asset-1', 'asset-2'] }] };

describe('AssignmentService.assign', () => {
  it('gán đủ máy thì phiếu chuyển sang Đang chuẩn bị và mỗi giữ chỗ ghim một máy', async () => {
    const { prisma, tx } = buildDeps();
    const result = await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(result.status).toBe('PREPARING');
    expect(tx.memsReservation.update).toHaveBeenCalledTimes(2);
    expect(tx.memsRequestLine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ALLOCATED' } }),
    );
  });

  it('khoá theo model trước khi ghim máy', async () => {
    // Không khoá thì hai thủ kho cùng chuẩn bị hai phiếu sẽ cùng thấy chiếc cuối là rảnh.
    const { prisma, tx } = buildDeps();
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.$executeRawUnsafe.mock.calls[0][1]).toBe('mems:model:model-1');
  });

  it('lấy hết khoá TRƯỚC khi đọc gì, theo thứ tự cố định', async () => {
    // Hai lỗi cùng một gốc. Một: khoá nằm trong vòng lặp nên phiếu nhiều dòng đi xin khoá xen
    // giữa các lần đọc, và thứ tự thì theo mảng client gửi — hai thủ kho gửi hai thứ tự ngược
    // nhau là ôm chéo khoá, Postgres giết một giao dịch và người kia ăn 500. Hai: cùng một
    // model ở hai dòng thì xin khoá hai lần vô ích.
    const { prisma, tx } = buildDeps({
      lines: [
        { id: 'line-1', model_id: 'model-b', quantity: 1, reservations: [{ id: 'rsv-1', status: 'TENTATIVE' }] },
        { id: 'line-2', model_id: 'model-a', quantity: 1, reservations: [{ id: 'rsv-2', status: 'TENTATIVE' }] },
      ],
      assets: [
        { id: 'asset-1', asset_code: 'CAM-001', model_id: 'model-b', condition: 'GOOD', status: 'AVAILABLE', is_disabled: false },
        { id: 'asset-2', asset_code: 'CAM-002', model_id: 'model-a', condition: 'GOOD', status: 'AVAILABLE', is_disabled: false },
      ],
    });

    await new AssignmentService(prisma, {} as any).assign('req-1', {
      lines: [
        { lineId: 'line-1', assetIds: ['asset-1'] },
        { lineId: 'line-2', assetIds: ['asset-2'] },
      ],
    });

    const lockKeys = tx.$executeRawUnsafe.mock.calls.map((call: any[]) => String(call[1]));
    expect(lockKeys).toEqual(['mems:model:model-a', 'mems:model:model-b']);
  });

  it('gán thiếu máy so với số lượng đã duyệt thì báo lỗi', async () => {
    const { prisma } = buildDeps();
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', {
        lines: [{ lineId: 'line-1', assetIds: ['asset-1'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('một máy gán cho hai dòng trong cùng phiếu thì báo lỗi', async () => {
    // Trùng là lúc soạn hàng kho đếm thừa một chiếc không tồn tại.
    const { prisma } = buildDeps();
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', {
        lines: [{ lineId: 'line-1', assetIds: ['asset-1', 'asset-1'] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('máy khác model với dòng phiếu thì bị chặn', async () => {
    const { prisma } = buildDeps({
      assets: [
        { id: 'asset-1', asset_code: 'CAM-001', model_id: 'model-1', condition: 'GOOD' },
        { id: 'asset-2', asset_code: 'LEN-001', model_id: 'model-9', condition: 'GOOD' },
      ],
    });
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/không thuộc model/);
  });

  it('máy đang chờ kiểm tra thì không gán được dù rảnh lịch', async () => {
    // Rảnh lịch không có nghĩa là dùng được — chưa ai xác nhận chiếc này còn tốt.
    const { prisma } = buildDeps({
      assets: [
        { id: 'asset-1', asset_code: 'CAM-001', model_id: 'model-1', condition: 'GOOD' },
        { id: 'asset-2', asset_code: 'CAM-003', model_id: 'model-1', condition: 'NEEDS_CHECK' },
      ],
    });
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/chưa giao được/);
  });

  it('phiếu chưa duyệt thì chưa tới bước gán serial', async () => {
    const { prisma } = buildDeps({ status: 'PENDING_APPROVAL' });
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

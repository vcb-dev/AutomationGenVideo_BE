import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssignmentService } from '../assignment.service';

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260812-014',
    status: 'APPROVED',
    from_time: new Date('2026-08-15T02:00:00Z'),
    to_time: new Date('2026-08-16T10:00:00Z'),
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
    {
      id: 'asset-1',
      asset_code: 'CAM-001',
      model_id: 'model-1',
      condition: 'GOOD',
      status: 'AVAILABLE',
      is_disabled: false,
    },
    {
      id: 'asset-2',
      asset_code: 'CAM-002',
      model_id: 'model-1',
      condition: 'USED',
      status: 'AVAILABLE',
      is_disabled: false,
    },
  ];
  const tx = {
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsAssetModel: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'model-1',
        category: { buffer_minutes: 120 },
      })),
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
    // Mặc định máy rảnh lịch: từng test muốn dựng xung đột thì ghi đè hai mock này.
    // Khai báo tham số để TypeScript cho phép đọc mock.calls[0][0] ở test kiểm tra điều kiện lọc.
    memsReservation: {
      update: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(async (_args?: any) => over.clashingReservations ?? []),
      create: jest.fn(async ({ data }: any) => ({ id: `res-moi-${Math.random()}`, ...data })),
    },
    memsMaintenance: { findMany: jest.fn(async (_args?: any) => over.clashingMaintenances ?? []) },
    memsHandoverLine: { findMany: jest.fn(async (_args?: any) => over.overdueOut ?? []) },
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
});

/**
 * Đọc lại lịch NGAY TRONG giao dịch, sau khi đã lấy khoá.
 *
 * Đây mới là thứ cái khoá theo model bảo vệ. Trước đây hàm chỉ kiểm model và tình trạng, nên
 * khoá chỉ xếp hàng hai thủ kho chứ không ngăn họ gán trùng: cả hai đã xem danh sách máy rảnh
 * từ trước khi vào đây, và danh sách đó có thể đã cũ vài phút.
 */
describe('AssignmentService.assign — chống gán trùng một chiếc máy', () => {
  it('máy đã ghim cho phiếu khác trùng khoảng thời gian thì bị chặn, nêu rõ phiếu nào', async () => {
    const { prisma } = buildDeps({
      clashingReservations: [
        {
          asset: { asset_code: 'CAM-001' },
          request_line: { request: { request_code: 'REQ-20260815-002' } },
        },
      ],
    });

    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/CAM-001 đã được gán cho phiếu REQ-20260815-002/);
  });

  it('giữ chỗ của CHÍNH phiếu này không bị coi là xung đột', async () => {
    // Bản ghi giữ chỗ của phiếu đang gán chính là thứ sắp được ghim máy vào. Đếm nó là xung
    // đột thì không phiếu nào gán nổi, kể cả khi kho trống trơn.
    const { prisma, tx } = buildDeps();
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.memsReservation.findMany.mock.calls[0][0].where.request_line).toEqual({
      request_id: { not: 'req-1' },
    });
  });

  it('máy có lịch bảo trì trùng khoảng thời gian thì bị chặn', async () => {
    const { prisma } = buildDeps({
      clashingMaintenances: [{ asset: { asset_code: 'CAM-002' } }],
    });

    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/CAM-002 có lịch bảo trì/);
  });

  it('khoảng thời gian xét xung đột có cộng buffer của danh mục', async () => {
    // Buffer là quãng nghỉ để kiểm máy sau mỗi lượt trả. Bỏ qua nó thì phiếu sau nhận máy đúng
    // lúc phiếu trước vừa trả, chưa ai kịp mở hộp ra xem.
    const { prisma, tx } = buildDeps();
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    // to_time 10:00 + 120 phút buffer = 12:00
    expect(tx.memsReservation.findMany.mock.calls[0][0].where.from_time.lt).toEqual(
      new Date('2026-08-16T12:00:00Z'),
    );
  });

  it('máy đã ngừng sử dụng hoặc đang ở trạng thái không cho mượn thì bị chặn', async () => {
    const disabled = buildDeps({
      assets: [
        {
          id: 'asset-1',
          asset_code: 'CAM-001',
          model_id: 'model-1',
          condition: 'GOOD',
          status: 'AVAILABLE',
          is_disabled: true,
        },
        {
          id: 'asset-2',
          asset_code: 'CAM-002',
          model_id: 'model-1',
          condition: 'GOOD',
          status: 'AVAILABLE',
          is_disabled: false,
        },
      ],
    });
    await expect(
      new AssignmentService(disabled.prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/đã ngừng sử dụng/);

    // Máy báo mất vẫn có thể mang `condition` GOOD từ lần đối chiếu cuối — chỉ cột trạng thái
    // mới biết là nó không còn trong kho.
    const lost = buildDeps({
      assets: [
        {
          id: 'asset-1',
          asset_code: 'CAM-001',
          model_id: 'model-1',
          condition: 'GOOD',
          status: 'LOST',
          is_disabled: false,
        },
        {
          id: 'asset-2',
          asset_code: 'CAM-002',
          model_id: 'model-1',
          condition: 'GOOD',
          status: 'AVAILABLE',
          is_disabled: false,
        },
      ],
    });
    await expect(
      new AssignmentService(lost.prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/chưa cho mượn được/);
  });

  it('phiếu chưa duyệt thì chưa tới bước gán serial', async () => {
    const { prisma } = buildDeps({ status: 'PENDING_APPROVAL' });
    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * Máy đang ở ngoài mà đã quá hạn trả.
 *
 * Ca này lọt qua cả hai lớp canh sẵn có: giữ chỗ của lượt cũ đã hết hiệu lực nên không tính là
 * xung đột thời gian, còn `ON_LOAN` thì cố ý không nằm trong `NOT_USABLE_STATUSES` vì máy đang
 * mượn hôm nay vẫn phải đặt trước cho tuần sau được. Kết quả: chiếc máy lẽ ra về từ tuần trước,
 * chưa ai thấy mặt, vẫn được gán cho phiếu mới — và kho chỉ biết lúc đứng ra bàn giao.
 */
describe('AssignmentService.assign — máy chưa trả về từ lượt trước', () => {
  const NOW = new Date('2026-08-14T00:00:00Z');

  const overdueLine = {
    asset: { asset_code: 'CAM-001' },
    handover: {
      request: { request_code: 'REQ-20260801-003', to_time: new Date('2026-08-05T10:00:00Z') },
    },
  };

  it('chặn gán, nêu rõ máy nào kẹt ở phiếu nào và hạn trả là bao giờ', async () => {
    const { prisma } = buildDeps({ overdueOut: [overdueLine] });

    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO, NOW),
    ).rejects.toThrow(/CAM-001 chưa được trả về từ phiếu REQ-20260801-003.*2026-08-05/s);
  });

  it('chỉ xét lượt CHƯA có dòng trả và ĐÃ quá hạn tính tới lúc gán', async () => {
    // Lọc sai một trong hai vế là chặn oan mọi máy từng được mượn.
    const { prisma, tx } = buildDeps();
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO, NOW);

    const where = tx.memsHandoverLine.findMany.mock.calls[0][0].where;
    expect(where.returnLines).toEqual({ none: {} });
    expect(where.handover.request.to_time).toEqual({ lt: NOW });
  });

  it('máy đang mượn nhưng CÒN trong hạn thì vẫn đặt trước được cho phiếu sau', async () => {
    // Không được chặn cứng theo trạng thái ON_LOAN: khả dụng là hàm của khoảng thời gian, chặn
    // cứng thì cả kho mất khả năng đặt lịch trước.
    const { prisma } = buildDeps({ overdueOut: [] });

    const result = await new AssignmentService(prisma, {} as any).assign('req-1', DTO, NOW);

    expect(result.status).toBe('PREPARING');
  });
});

/**
 * Dòng "Chờ hàng" (QĐ-08) — lúc tạo phiếu kho thiếu máy nên dòng đó ra đời KHÔNG kèm giữ chỗ.
 *
 * Trước đây tới bước gán là ném `ConflictException('Số bản ghi giữ chỗ ít hơn số máy muốn gán')`,
 * nghĩa là phiếu chết cứng: không gán được, không có đường nào tính lại, kể cả sau khi máy đã
 * về kho. Màn Chuẩn bị chỉ hiện một ô chọn rỗng và một nút xám, không nói vì sao.
 *
 * Bù giữ chỗ ở đây an toàn vì mỗi chiếc máy sắp ghim đều vừa qua ba cửa phía trên: không trùng
 * lịch phiếu khác, không có lệnh bảo trì, không kẹt ở lượt mượn quá hạn.
 */
describe('AssignmentService.assign — dòng Chờ hàng, chưa có giữ chỗ', () => {
  const backordered = {
    lines: [{ id: 'line-1', model_id: 'model-1', quantity: 2, reservations: [] }],
  };

  it('gán được khi máy đã về kho, thay vì chết cứng', async () => {
    const { prisma } = buildDeps(backordered);

    const result = await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(result.status).toBe('PREPARING');
  });

  it('bù đúng số bản ghi giữ chỗ còn thiếu, mang khoảng thời gian của phiếu', async () => {
    const { prisma, tx } = buildDeps(backordered);
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.memsReservation.create).toHaveBeenCalledTimes(2);
    expect(tx.memsReservation.create.mock.calls[0][0].data).toMatchObject({
      request_line_id: 'line-1',
      model_id: 'model-1',
      from_time: new Date('2026-08-15T02:00:00Z'),
      to_time: new Date('2026-08-16T10:00:00Z'),
      // to_time 10:00 + 120 phút buffer của danh mục
      buffer_to_time: new Date('2026-08-16T12:00:00Z'),
      status: 'CONFIRMED',
    });
  });

  it('dòng đã có đủ giữ chỗ thì KHÔNG đẻ thêm bản ghi nào', async () => {
    // Bù thừa là đếm trùng: hàm khả dụng đếm số bản ghi giữ chỗ giao nhau, thừa một bản ghi là
    // cả kho hụt đi một máy trong khoảng đó.
    const { prisma, tx } = buildDeps();
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.memsReservation.create).not.toHaveBeenCalled();
    expect(tx.memsReservation.update).toHaveBeenCalledTimes(2);
  });

  it('chỉ bù phần THIẾU khi dòng mới có một nửa giữ chỗ', async () => {
    const { prisma, tx } = buildDeps({
      lines: [
        {
          id: 'line-1',
          model_id: 'model-1',
          quantity: 2,
          reservations: [{ id: 'res-1', status: 'CONFIRMED' }],
        },
      ],
    });
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.memsReservation.create).toHaveBeenCalledTimes(1);
  });

  it('giữ chỗ đã nhả không tính là còn dùng được, phải bù lại', async () => {
    // RELEASED nghĩa là khoảng thời gian đó đã trả về kho — ghim máy vào bản ghi đó thì phép
    // tính khả dụng vẫn coi như không ai giữ.
    const { prisma, tx } = buildDeps({
      lines: [
        {
          id: 'line-1',
          model_id: 'model-1',
          quantity: 2,
          reservations: [
            { id: 'res-1', status: 'RELEASED' },
            { id: 'res-2', status: 'RELEASED' },
          ],
        },
      ],
    });
    await new AssignmentService(prisma, {} as any).assign('req-1', DTO);

    expect(tx.memsReservation.create).toHaveBeenCalledTimes(2);
  });

  it('máy không rảnh thì vẫn chặn, không phải cứ thiếu giữ chỗ là bù bừa', async () => {
    const { prisma, tx } = buildDeps({
      ...backordered,
      clashingReservations: [
        {
          asset: { asset_code: 'CAM-001' },
          request_line: { request: { request_code: 'REQ-20260815-002' } },
        },
      ],
    });

    await expect(
      new AssignmentService(prisma, {} as any).assign('req-1', DTO),
    ).rejects.toThrow(/đã được gán cho phiếu/);
    expect(tx.memsReservation.create).not.toHaveBeenCalled();
  });
});

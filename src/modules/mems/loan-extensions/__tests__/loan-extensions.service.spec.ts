import { BadRequestException, ConflictException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { LoanExtensionsService } from '../loan-extensions.service';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MemsMediaLeaderGuard } from '../../../../common/guards/mems-media-leader.guard';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { MemsLoanExtensionsController } from '../loan-extensions.controller';

const TO = new Date('2026-10-19T18:00:00Z');
const NEW_TO = new Date('2026-10-20T10:00:00Z');
const OWNER = { id: 'owner-1', roles: ['USER'] };
const LEADER = { id: 'leader-1', roles: ['ADMIN'] };

function buildDeps(over: { request?: any; pending?: any | null; enough?: boolean } = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20261019-001',
    owner_id: 'owner-1',
    status: 'ON_LOAN',
    to_time: TO,
    lines: [
      {
        id: 'line-1',
        model_id: 'model-1',
        model: { name: 'Sony A7 IV' },
        reservations: [{ status: 'CONFIRMED' }, { status: 'RELEASED' }],
      },
    ],
    ...over.request,
  };
  const lockKeys: string[] = [];
  const tx: any = {
    $executeRawUnsafe: jest.fn(async (_sql: string, key: string) => {
      lockKeys.push(key);
      return 1;
    }),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => request),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsLoanExtension: {
      findFirst: jest.fn(async () => (over.pending === undefined ? null : over.pending)),
      create: jest.fn(async ({ data }: any) => ({ id: 'ext-1', status: 'PENDING', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'ext-1', ...data })),
    },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const availability: any = {
    check: jest.fn(async (args: any) => ({
      enough: over.enough ?? true,
      bufferedTo: new Date(args.toTime.getTime() + 3_600_000),
    })),
  };
  return { service: new LoanExtensionsService(prisma, availability), tx, availability, lockKeys };
}

describe('Xin gia hạn phiếu đang mượn', () => {
  const DTO = { toTime: NEW_TO.toISOString(), reason: 'Quay bù cảnh hoàng hôn' };

  it('chủ phiếu xin được, tạo một yêu cầu chờ duyệt', async () => {
    const { service, tx } = buildDeps();
    await service.request('req-1', OWNER, DTO);
    expect(tx.memsLoanExtension.create).toHaveBeenCalledWith({
      data: {
        request_id: 'req-1',
        requested_to_time: NEW_TO,
        reason: 'Quay bù cảnh hoàng hôn',
        requested_by: 'owner-1',
      },
    });
  });

  it('người không phải chủ phiếu, không phải quản lý kho thì bị chặn', async () => {
    const { service } = buildDeps();
    await expect(service.request('req-1', { id: 'other', roles: ['USER'] }, DTO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('phiếu chưa giao máy thì không gia hạn được', async () => {
    const { service } = buildDeps({ request: { status: 'APPROVED' } });
    await expect(service.request('req-1', OWNER, DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('hạn mới không sau hạn cũ thì từ chối', async () => {
    const { service } = buildDeps();
    await expect(
      service.request('req-1', OWNER, { ...DTO, toTime: TO.toISOString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lý do toàn khoảng trắng thì từ chối', async () => {
    const { service } = buildDeps();
    await expect(service.request('req-1', OWNER, { ...DTO, reason: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đang có yêu cầu chờ duyệt thì không xin thêm', async () => {
    const { service } = buildDeps({ pending: { id: 'ext-0' } });
    await expect(service.request('req-1', OWNER, DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('hỏi khả dụng cho khoảng dời thêm, bỏ qua giữ chỗ của chính phiếu, đúng số máy còn ở ngoài', async () => {
    const { service, tx, availability } = buildDeps();
    await service.request('req-1', OWNER, DTO);
    expect(availability.check).toHaveBeenCalledWith(
      { modelId: 'model-1', fromTime: TO, toTime: NEW_TO, quantity: 1, excludeRequestId: 'req-1' },
      tx,
    );
  });

  it('kho không đủ máy cho khoảng dời thêm thì từ chối, không tạo yêu cầu', async () => {
    const { service, tx } = buildDeps({ enough: false });
    await expect(service.request('req-1', OWNER, DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memsLoanExtension.create).not.toHaveBeenCalled();
  });

  it('khoá phiếu trước rồi mới khoá model', async () => {
    const { service, lockKeys } = buildDeps();
    await service.request('req-1', OWNER, DTO);
    expect(lockKeys).toEqual(['mems:request:req-1', 'mems:model:model-1']);
  });
});

describe('Duyệt và từ chối gia hạn', () => {
  const PENDING = { id: 'ext-1', request_id: 'req-1', status: 'PENDING', requested_to_time: NEW_TO };

  it('duyệt thì dời hạn trả của phiếu', async () => {
    const { service, tx } = buildDeps({ pending: PENDING });
    await service.decide('req-1', LEADER, { decision: 'APPROVED' });
    expect(tx.memsBorrowRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { to_time: NEW_TO },
    });
  });

  it('duyệt thì dời giữ chỗ còn hiệu lực, buffer tính lại theo danh mục', async () => {
    const { service, tx } = buildDeps({ pending: PENDING });
    await service.decide('req-1', LEADER, { decision: 'APPROVED' });
    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith({
      where: { request_line_id: 'line-1', status: { in: ['TENTATIVE', 'CONFIRMED'] } },
      data: { to_time: NEW_TO, buffer_to_time: new Date('2026-10-20T11:00:00Z') },
    });
  });

  it('duyệt thì ghi người duyệt và thời điểm', async () => {
    const { service, tx } = buildDeps({ pending: PENDING });
    await service.decide('req-1', LEADER, { decision: 'APPROVED' });
    const data = tx.memsLoanExtension.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'APPROVED', decided_by: 'leader-1' });
    expect(data.decided_at).toBeInstanceOf(Date);
  });

  it('kho đã kín lịch lúc duyệt thì không dời gì cả', async () => {
    const { service, tx } = buildDeps({ pending: PENDING, enough: false });
    await expect(service.decide('req-1', LEADER, { decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
  });

  it('phiếu đã trả xong thì không duyệt được', async () => {
    const { service } = buildDeps({ pending: PENDING, request: { status: 'CLOSED' } });
    await expect(service.decide('req-1', LEADER, { decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('không có yêu cầu chờ duyệt thì báo lỗi', async () => {
    const { service } = buildDeps({ pending: null });
    await expect(service.decide('req-1', LEADER, { decision: 'APPROVED' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('từ chối bắt buộc nêu lý do', async () => {
    const { service } = buildDeps({ pending: PENDING });
    await expect(
      service.decide('req-1', LEADER, { decision: 'REJECTED', reason: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('từ chối thì ghi lý do và giữ nguyên hạn trả', async () => {
    const { service, tx } = buildDeps({ pending: PENDING });
    await service.decide('req-1', LEADER, { decision: 'REJECTED', reason: 'Máy đã có lịch quay khác' });
    expect(tx.memsLoanExtension.update.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED',
      rejection_reason: 'Máy đã có lịch quay khác',
    });
    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    expect(tx.memsReservation.updateMany).not.toHaveBeenCalled();
  });
});

describe('MemsLoanExtensionsController — route & auth', () => {
  const proto = MemsLoanExtensionsController.prototype as any;
  // [handler, method đường-dẫn, có canh Team Media (kèm @Roles) hay không]
  const ROUTES: [string, string, boolean][] = [
    ['requestExtension', 'POST mems/requests/:id/extensions', false],
    ['decideExtension', 'POST mems/requests/:id/extensions/decision', true],
  ];

  it('không có route ngoài bảng', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.hasMetadata(METHOD_METADATA, proto[name]),
    );
    expect(handlers.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  it.each(ROUTES)('%s: %s, canh Team Media = %s', (name, route, guarded) => {
    const handler = proto[name];
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
    const base = Reflect.getMetadata(PATH_METADATA, MemsLoanExtensionsController);
    expect(`${method} ${base}/${Reflect.getMetadata(PATH_METADATA, handler)}`).toBe(route);
    expect((Reflect.getMetadata('__guards__', handler) ?? []).includes(MemsMediaLeaderGuard)).toBe(guarded);
    expect(Reflect.getMetadata(ROLES_KEY, handler) !== undefined).toBe(guarded);
  });
});

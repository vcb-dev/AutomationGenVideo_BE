import { ReturnAlertsService } from '../return-alerts.service';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MemsMediaLeaderGuard } from '../../../../common/guards/mems-media-leader.guard';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { MemsReturnAlertsController } from '../return-alerts.controller';

const NOW = new Date('2026-10-19T14:00:00Z');

function buildPrisma(rows: any[] = []) {
  return {
    memsBorrowRequest: { findMany: jest.fn(async () => rows) },
    user: { findMany: jest.fn(async () => [{ id: 'u-1', full_name: 'Nguyễn Văn A' }]) },
  } as any;
}

describe('ReturnAlertsService.list', () => {
  it('thành viên chỉ đọc phiếu của chính mình', async () => {
    const prisma = buildPrisma();
    await new ReturnAlertsService(prisma).list({ id: 'u-1', roles: ['USER'] }, NOW);
    expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBe('u-1');
  });

  it('admin đọc cả kho', async () => {
    const prisma = buildPrisma();
    await new ReturnAlertsService(prisma).list({ id: 'admin-1', roles: ['ADMIN'] }, NOW);
    expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBeUndefined();
  });

  it('chỉ lấy phiếu còn máy ở ngoài và hạn trả trước mép cửa sổ', async () => {
    const prisma = buildPrisma();
    await new ReturnAlertsService(prisma).list({ id: 'u-1', roles: ['USER'] }, NOW);
    const where = prisma.memsBorrowRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['ON_LOAN', 'PARTIALLY_RETURNED'] });
    expect(where.to_time.lte.toISOString()).toBe('2026-10-19T16:00:00.000Z');
  });

  it('gắn tên người mượn vào từng dòng', async () => {
    const prisma = buildPrisma([
      { id: 'r-1', request_code: 'REQ-1', owner_id: 'u-1', to_time: new Date('2026-10-19T12:00:00Z') },
    ]);
    const { overdue } = await new ReturnAlertsService(prisma).list({ id: 'admin-1', roles: ['ADMIN'] }, NOW);
    expect(overdue[0]).toMatchObject({ owner_name: 'Nguyễn Văn A', overdue_minutes: 120 });
  });
});

describe('MemsReturnAlertsController — route & auth', () => {
  const proto = MemsReturnAlertsController.prototype as any;
  // [handler, method đường-dẫn, có canh Team Media (kèm @Roles) hay không]
  const ROUTES: [string, string, boolean][] = [['returnAlerts', 'GET mems/return-alerts', false]];

  it('không có route ngoài bảng', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.hasMetadata(METHOD_METADATA, proto[name]),
    );
    expect(handlers.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  it.each(ROUTES)('%s: %s, canh Team Media = %s', (name, route, guarded) => {
    const handler = proto[name];
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
    const base = Reflect.getMetadata(PATH_METADATA, MemsReturnAlertsController);
    expect(`${method} ${base}/${Reflect.getMetadata(PATH_METADATA, handler)}`).toBe(route);
    expect((Reflect.getMetadata('__guards__', handler) ?? []).includes(MemsMediaLeaderGuard)).toBe(guarded);
    expect(Reflect.getMetadata(ROLES_KEY, handler) !== undefined).toBe(guarded);
  });
});

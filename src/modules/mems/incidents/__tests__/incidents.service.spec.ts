import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MemsIncidentsService } from '../incidents.service';

const OWNER = { id: 'owner-1', roles: ['USER'] };
const PHOTO = '33333333-3333-4333-8333-333333333333';
const DTO = { assetId: 'asset-1', kind: 'CONDITION_WORSENED' as const, description: '  Rơi máy, nứt màn hình  ' };

function buildDeps(over: { request?: any; notHandedOver?: boolean; photoCount?: number } = {}) {
  const request = { id: 'req-1', request_code: 'REQ-1', owner_id: 'owner-1', status: 'ON_LOAN', ...over.request };
  const tx: any = {
    memsBorrowRequest: { findUnique: jest.fn(async () => request) },
    memsHandoverLine: {
      findFirst: jest.fn(async () => (over.notHandedOver ? null : { id: 'hl-1', asset: { asset_code: 'CAM-001' } })),
    },
    memsIncident: { create: jest.fn(async ({ data }: any) => ({ id: 'inc-1', ...data })) },
    memsRequestPhoto: {
      updateMany: jest.fn(async ({ where }: any) => ({ count: over.photoCount ?? where.id.in.length })),
    },
    memsAssetEvent: { create: jest.fn(async ({ data }: any) => data) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { service: new MemsIncidentsService(prisma), tx };
}

describe('Báo sự cố khi đang mượn', () => {
  it('chủ phiếu báo được; trách nhiệm thuộc chủ phiếu, ghi người báo', async () => {
    const { service, tx } = buildDeps();
    await service.report('req-1', OWNER, DTO);
    expect(tx.memsIncident.create).toHaveBeenCalledWith({
      data: {
        asset_id: 'asset-1',
        request_id: 'req-1',
        responsible_id: 'owner-1',
        reported_by: 'owner-1',
        kind: 'CONDITION_WORSENED',
        description: 'Rơi máy, nứt màn hình',
        status: 'OPEN',
      },
    });
  });

  it('chỉ nhận máy đã giao cho phiếu và chưa trả', async () => {
    const { service, tx } = buildDeps();
    await service.report('req-1', OWNER, DTO);
    expect(tx.memsHandoverLine.findFirst.mock.calls[0][0].where).toEqual({
      asset_id: 'asset-1',
      handover: { request_id: 'req-1' },
      returnLines: { none: {} },
    });
  });

  it('máy không thuộc phiếu thì từ chối, không ghi gì', async () => {
    const { service, tx } = buildDeps({ notHandedOver: true });
    await expect(service.report('req-1', OWNER, DTO)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.memsIncident.create).not.toHaveBeenCalled();
  });

  it('người ngoài bị chặn', async () => {
    const { service } = buildDeps();
    await expect(service.report('req-1', { id: 'x', roles: ['USER'] }, DTO)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('phiếu không còn đang mượn thì không báo được', async () => {
    const { service } = buildDeps({ request: { status: 'CLOSED' } });
    await expect(service.report('req-1', OWNER, DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ảnh gắn vào cả phiếu lẫn sự cố', async () => {
    const { service, tx } = buildDeps();
    await service.report('req-1', OWNER, { ...DTO, photoIds: [PHOTO] });
    expect(tx.memsRequestPhoto.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [PHOTO] }, uploaded_by: 'owner-1', request_id: null },
      data: { request_id: 'req-1', incident_id: 'inc-1' },
    });
  });

  it('ảnh không hợp lệ thì từ chối cả lần báo', async () => {
    const { service } = buildDeps({ photoCount: 0 });
    await expect(service.report('req-1', OWNER, { ...DTO, photoIds: [PHOTO] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ghi nhật ký vòng đời máy loại INCIDENT', async () => {
    const { service, tx } = buildDeps();
    await service.report('req-1', OWNER, DTO);
    expect(tx.memsAssetEvent.create.mock.calls[0][0].data).toMatchObject({ asset_id: 'asset-1', kind: 'INCIDENT' });
  });
});

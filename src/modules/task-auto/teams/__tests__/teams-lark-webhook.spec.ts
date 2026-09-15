import { TaskAutoTeamsService } from '../teams.service';

// create()/update() gọi seedEditorKpiForMembers + recomputeUserTeamFieldsBatch (qua
// syncAffectedUsers) bằng chính transaction client — không liên quan gì tới việc lưu đúng
// field webhook Lark của Team, mock hẳn ra để test không phải dựng lại toàn bộ prisma mock
// của 2 helper đó.
jest.mock('../../../../common/utils/team-membership.util', () => ({
  ...jest.requireActual('../../../../common/utils/team-membership.util'),
  seedEditorKpiForMembers: jest.fn(async () => undefined),
  recomputeUserTeamFieldsBatch: jest.fn(async () => undefined),
}));

describe('TaskAutoTeamsService.create/update — webhook Lark riêng của team', () => {
  function build(opts: { existingTeam?: any } = {}) {
    const createCalls: any[] = [];
    const updateCalls: any[] = [];
    const tx: any = {
      team: {
        create: jest.fn(async (a: any) => {
          createCalls.push(a.data);
          return { id: 'team-new', ...a.data, lark_webhook_secret: a.data.lark_webhook_secret ?? null };
        }),
        update: jest.fn(async (a: any) => {
          updateCalls.push(a.data);
          return { id: 'team-1', leader_id: null, ...a.data };
        }),
      },
      teamMember: { createMany: jest.fn(async () => ({ count: 0 })), deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    const prisma: any = {
      team: { findUnique: jest.fn(async () => opts.existingTeam ?? null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const service = new TaskAutoTeamsService(prisma, {} as any) as any;
    jest.spyOn(service, 'findOneForAuth').mockResolvedValue({ id: 'team-1', leader_id: null, members: [] });
    return { service, tx, createCalls, updateCalls };
  }

  it('create(): lưu đúng lark_webhook_url/secret truyền vào, không bị rớt mất', async () => {
    const { service, createCalls } = build();
    await service.create(
      { name: 'Team X', lark_webhook_url: 'https://open.larksuite.com/hook/abc', lark_webhook_secret: 'shh' },
      'creator-1',
    );
    expect(createCalls[0]).toMatchObject({
      lark_webhook_url: 'https://open.larksuite.com/hook/abc',
      lark_webhook_secret: 'shh',
    });
  });

  it('create(): không truyền webhook Lark → không set field (không lỗi, không rác undefined)', async () => {
    const { service, createCalls } = build();
    await service.create({ name: 'Team Y' }, 'creator-1');
    expect(createCalls[0].lark_webhook_url).toBeUndefined();
    expect(createCalls[0].lark_webhook_secret).toBeUndefined();
  });

  it('update(): lưu đúng lark_webhook_url/secret truyền vào', async () => {
    const { service, updateCalls } = build();
    await service.update(
      'team-1',
      { lark_webhook_url: 'https://open.larksuite.com/hook/xyz', lark_webhook_secret: 'new-secret' },
      'admin-1',
      ['ADMIN'],
    );
    expect(updateCalls[0]).toMatchObject({
      lark_webhook_url: 'https://open.larksuite.com/hook/xyz',
      lark_webhook_secret: 'new-secret',
    });
  });
});

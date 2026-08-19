import { TaskAutoCatalogService } from '../catalog.service';

/**
 * listTeamPushRequests() (leader duyệt push request) — trước đây `pushRequestInclude.editor_content`
 * select hẹp chỉ lấy title, khiến ContentViewModal ở FE (TeamPushRequestsTab.tsx) không hiện được
 * kịch bản. Giờ select đủ body/script/voice_url/file_content_url để leader xem trước khi duyệt.
 */
describe('TaskAutoCatalogService.listTeamPushRequests — editor_content select đủ field kịch bản', () => {
  function build(opts: { team?: any } = {}) {
    const findManyCalls: any[] = [];
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined
            ? { id: 'team-1', leader_id: 'leader-1' }
            : opts.team,
        ),
      },
      teamPushRequest: {
        findMany: jest.fn(async (args: any) => {
          findManyCalls.push(args);
          return [];
        }),
      },
    };
    const service = new TaskAutoCatalogService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma, findManyCalls };
  }

  it('select editor_content kèm code/market/status/body/script/voice_url/file_content_url', async () => {
    const { service, findManyCalls } = build();

    await service.listTeamPushRequests('team-1', undefined, 'leader-1', ['LEADER']);

    expect(findManyCalls).toHaveLength(1);
    const editorContentSelect = findManyCalls[0].include.editor_content.select;
    expect(editorContentSelect).toEqual(
      expect.objectContaining({
        code: true,
        title: true,
        market: true,
        status: true,
        body: true,
        script: true,
        voice_url: true,
        file_content_url: true,
      }),
    );
  });

  it('editor_product vẫn giữ select hẹp (không có body/script — Product không có field kịch bản)', async () => {
    const { service, findManyCalls } = build();

    await service.listTeamPushRequests('team-1', undefined, 'leader-1', ['LEADER']);

    const editorProductSelect = findManyCalls[0].include.editor_product.select;
    expect(editorProductSelect).not.toHaveProperty('body');
    expect(editorProductSelect).not.toHaveProperty('script');
  });
});

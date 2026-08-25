import { TaskAutoTasksService } from '../tasks.service';

/**
 * create() — fallback content_line_id về bản ghi gốc (source_team_content/source_editor_content)
 * khi field thô trên chính record bị null. TeamContent/Content chỉ copy content_line_id tại thời
 * điểm push (copyEditorContentToTeam/pushTeamContentToGlobal), nên record cũ hoặc content được
 * gán tuyến SAU khi đã push vẫn có thể null dù nội dung thực sự thuộc 1 tuyến — thiếu fallback
 * này khiến task tạo thủ công từ content đó rơi khỏi "Số video theo tuyến nội dung".
 */
describe('TaskAutoTasksService.create — fallback content_line_id qua bản ghi gốc', () => {
  function build(opts: {
    content?: any;
    teamContent?: any;
  }) {
    let createArgs: any;
    const prisma: any = {
      team: { findUnique: jest.fn(async () => ({ id: 'team-1', brand_type: 'DO_DA' })) },
      content: { findUnique: jest.fn(async () => opts.content ?? null) },
      editorContent: { findUnique: jest.fn(async () => null) },
      teamContent: { findUnique: jest.fn(async () => opts.teamContent ?? null) },
      teamMember: { findFirst: jest.fn(async () => ({ team_id: 'team-1' })) },
      task: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => {
          createArgs = args;
          return { id: 'task-1', ...args.data };
        }),
      },
    };
    const service = new TaskAutoTasksService(prisma, {} as any, {} as any, {} as any);
    return { service, prisma, getCreateArgs: () => createArgs };
  }

  it('content_id: content.content_line_id có sẵn → dùng trực tiếp, không cần fallback', async () => {
    const { service, getCreateArgs } = build({
      content: { content_line_id: 'line-direct', source_team_content: null },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-direct');
  });

  it('content_id: content_line_id null, fallback 1 cấp qua source_team_content.content_line_id', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: { content_line_id: 'line-from-team-content', source_editor_content: null },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-team-content');
  });

  it('content_id: cả content_line_id và source_team_content.content_line_id đều null → fallback 2 cấp qua source_editor_content', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: {
          content_line_id: null,
          source_editor_content: { content_line_id: 'line-from-editor-content' },
        },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-editor-content');
  });

  it('content_id: không còn fallback nào → content_line_id null', async () => {
    const { service, getCreateArgs } = build({
      content: { content_line_id: null, source_team_content: null },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBeNull();
  });

  it('team_content_id: content_line_id null → fallback qua source_editor_content.content_line_id', async () => {
    const { service, getCreateArgs } = build({
      teamContent: {
        content_line_id: null,
        source_editor_content: { content_line_id: 'line-from-editor-content' },
      },
    });

    await service.create(
      { team_id: 'team-1', team_content_id: 'tc-1' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-from-editor-content');
  });

  it('dto.content_line_id truyền tay → luôn ưu tiên, bỏ qua mọi fallback', async () => {
    const { service, getCreateArgs } = build({
      content: {
        content_line_id: null,
        source_team_content: { content_line_id: 'line-fallback', source_editor_content: null },
      },
    });

    await service.create(
      { team_id: 'team-1', content_id: 'content-1', content_line_id: 'line-explicit' } as any,
      'admin-1',
      ['ADMIN'],
    );

    expect(getCreateArgs().data.content_line_id).toBe('line-explicit');
  });
});

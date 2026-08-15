import { TaskAutoKpiService } from '../kpi.service';
import { BadRequestException } from '@nestjs/common';

/**
 * getContentCreatorKpiReport() — báo cáo TỰ TÍNH (không phải target đặt tay) từ dữ liệu thật:
 * số content sưu tầm (TeamContent.added_by), số bản dịch (ContentTranslation.translated_by),
 * và danh sách video đã lên (Task trỏ tới content do người này thêm, qua content_id hoặc
 * team_content_id). Khác ContentCreatorKpi (target tháng thủ công) — đây là báo cáo, không ghi DB.
 */
describe('TaskAutoKpiService.getContentCreatorKpiReport', () => {
  function build(opts: {
    users?: any[];
    collectedGroups?: any[];
    translationGroups?: any[];
    tasks?: any[];
    members?: { user_id: string }[];
  } = {}) {
    const prisma: any = {
      teamMember: {
        findMany: jest.fn(async () =>
          opts.members === undefined ? [{ user_id: 'creator-1' }] : opts.members,
        ),
      },
      user: {
        findMany: jest.fn(async () =>
          opts.users === undefined
            ? [{ id: 'creator-1', full_name: 'Người sưu tầm 1' }]
            : opts.users,
        ),
      },
      teamContent: {
        groupBy: jest.fn(async () =>
          opts.collectedGroups === undefined
            ? [{ added_by_id: 'creator-1', _count: { id: 4 } }]
            : opts.collectedGroups,
        ),
      },
      contentTranslation: {
        groupBy: jest.fn(async () =>
          opts.translationGroups === undefined
            ? [{ translated_by_id: 'creator-1', _count: { id: 2 } }]
            : opts.translationGroups,
        ),
      },
      task: {
        findMany: jest.fn(async () => (opts.tasks === undefined ? [] : opts.tasks)),
      },
    };
    const service = new TaskAutoKpiService(prisma);
    return { service, prisma };
  }

  afterEach(() => jest.clearAllMocks());

  it('không truyền cả user_id lẫn team_id → BadRequestException', async () => {
    const { service } = build();

    await expect(service.getContentCreatorKpiReport({})).rejects.toThrow(BadRequestException);
  });

  it('truyền team_id → lấy toàn bộ member của team làm userIds', async () => {
    const { service, prisma } = build({ members: [{ user_id: 'creator-1' }, { user_id: 'creator-2' }] });

    await service.getContentCreatorKpiReport({ team_id: 'team-1' });

    expect(prisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { team_id: 'team-1' } }),
    );
  });

  it('team không có thành viên nào → trả mảng rỗng, không query tiếp', async () => {
    const { service, prisma } = build({ members: [] });

    const result = await service.getContentCreatorKpiReport({ team_id: 'team-empty' });

    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('gộp đúng content_collected + translations_count + videos_made cho từng user', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-1',
          status: 'PUBLISHED',
          published_links: [],
          assignee: { id: 'editor-1', full_name: 'Editor A' },
          team_content: { added_by_id: 'creator-1', code: 'TC1', title: 'Content 1' },
          content: null,
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result).toEqual([
      expect.objectContaining({
        user_id: 'creator-1',
        content_collected: 4,
        translations_count: 2,
        videos_made: 1,
      }),
    ]);
    expect(result[0].videos[0]).toEqual(
      expect.objectContaining({ task_id: 'task-1', content_code: 'TC1', content_title: 'Content 1' }),
    );
  });

  it('lấy owner qua content.source_team_content.added_by_id khi task không gắn trực tiếp team_content', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-2',
          status: 'PUBLISHED',
          published_links: [],
          assignee: null,
          team_content: null,
          content: { id: 'c-1', code: 'C1', title: 'Content pushed', source_team_content: { added_by_id: 'creator-1' } },
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result[0].videos_made).toBe(1);
    expect(result[0].videos[0].content_id).toBe('c-1');
  });

  it('task không xác định được owner (thiếu cả team_content lẫn source_team_content) → bị bỏ qua', async () => {
    const { service } = build({
      tasks: [
        {
          id: 'task-orphan',
          status: 'PUBLISHED',
          published_links: [],
          assignee: null,
          team_content: null,
          content: { id: 'c-2', code: 'C2', title: 'X', source_team_content: null },
        },
      ],
    });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result[0].videos_made).toBe(0);
  });

  it('user chưa sưu tầm/dịch/lên video gì → tất cả field về 0, không lỗi', async () => {
    const { service } = build({ collectedGroups: [], translationGroups: [], tasks: [] });

    const result = await service.getContentCreatorKpiReport({ user_id: 'creator-1' });

    expect(result).toEqual([
      expect.objectContaining({ content_collected: 0, translations_count: 0, videos_made: 0, videos: [] }),
    ]);
  });

  it('truyền from/to → range được áp vào where của teamContent/contentTranslation/task', async () => {
    const { service, prisma } = build();

    await service.getContentCreatorKpiReport({ user_id: 'creator-1', from: '2026-08-01', to: '2026-08-31' });

    const groupByArgs = prisma.teamContent.groupBy.mock.calls[0][0];
    expect(groupByArgs.where.added_at.gte).toEqual(new Date(2026, 7, 1));
    // "to" là mốc lt của ngày kế tiếp (2026-09-01), không phải lte 2026-08-31 — bao trọn cả ngày cuối.
    expect(groupByArgs.where.added_at.lt).toEqual(new Date(2026, 8, 1));
  });
});

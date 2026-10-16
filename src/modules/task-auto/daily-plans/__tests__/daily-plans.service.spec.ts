import { NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  DailyPlanBuilderService,
  pickContentSuggestions,
  pickWinVideoSuggestions,
  suggestionCount,
} from '../daily-plan-builder.service';
import { captionToContent, DailyPlansService } from '../daily-plans.service';
import {
  editorContentCandidate,
  globalContentCandidate,
  teamContentCandidate,
} from '../steps/content-pool';
import {
  contentMatchesMarket,
  contentMatchesQuery,
  dedupeContentCopies,
  defaultSearchMarket,
  lineNameFromCaption,
  normalizeSearchText,
  videoMarketParam,
} from '../steps/system-search';
import { ContentCandidate, WinVideoCandidate } from '../types';

const VN = 'Asia/Ho_Chi_Minh';
// Chạy 17:00 ngày 9/10 (giờ VN) → kế hoạch cho 10/10, còn 22 ngày (10→31/10).
const RUN_AT = DateTime.fromISO('2026-10-09T17:00:00', { zone: VN });
const DEADLINE = new Date('2026-10-10T10:00:00Z');
const win = { won_at: null, win_video_views: null };

// ── Lập kế hoạch ngày (DailyPlanBuilderService) ──

function content(id: string, extra: Partial<ContentCandidate> = {}): ContentCandidate {
  return {
    source: 'global', id, tier: 2, ownerUserId: null, market: 'VIETNAM', contentLineId: 'cl-a1', code: null, title: id,
    isWin: false, winViews: null, keys: [`gc:${id}`], ...extra,
  };
}

function video(postId: string, extra: Partial<WinVideoCandidate> = {}): WinVideoCandidate {
  return {
    platform: 'facebook', post_id: postId, url: `https://fb.com/reel/${postId}`, caption: `Video ${postId} #A1`,
    thumbnail_url: null, views: 20000, published_at: null, page_name: 'Huy K', fromTeam: true, ...extra,
  };
}

describe('captionToContent — content kho cá nhân từ caption video win, bỏ hashtag', () => {
  it('bỏ mọi hashtag, dòng đầu làm tiêu đề', () => {
    expect(captionToContent('Cách đo size nhẫn tại nhà #K301 #a1 #C #Huykvienchibao')).toEqual({
      title: 'Cách đo size nhẫn tại nhà',
      body: 'Cách đo size nhẫn tại nhà',
    });
    expect(captionToContent('#A1 Nhẫn bị rộng phải làm sao?\nChỉnh size tại #huyk nhé\n#trangsuc #vang')).toEqual({
      title: 'Nhẫn bị rộng phải làm sao?',
      body: 'Nhẫn bị rộng phải làm sao?\nChỉnh size tại nhé',
    });
  });

  it('caption chỉ có hashtag / trống → tiêu đề mặc định; tiêu đề dài bị cắt', () => {
    expect(captionToContent('#A1 #jewelry').title).toBe('Content từ video win');
    expect(captionToContent(null)).toEqual({ title: 'Content từ video win', body: '' });
    const long = captionToContent(`${'a'.repeat(200)} #A1`);
    expect(long.title).toHaveLength(120);
    expect(long.title.endsWith('…')).toBe(true);
  });
});

describe('content candidate — resolve tuyến/tiêu đề qua bản gốc, khoá cùng 1 content qua các kho', () => {
  it('kho tổng push từ kho team push từ kho cá nhân: tiêu đề + tuyến lấy từ bản gốc, khoá phủ cả 3 kho', () => {
    const c = globalContentCandidate({
      id: 'g1', code: null, title: null, content_line_id: null, ...win,
      source_team_content_id: 't1', source_editor_content_id: null,
      source_team_content: {
        code: 'C01', title: null, content_line_id: null, source_editor_content_id: 'e1',
        source_editor_content: { code: 'C01', title: 'Nhẫn cưới', content_line_id: 'cl-a1' },
      },
    } as any);
    expect(c).toMatchObject({ source: 'global', title: 'Nhẫn cưới', code: 'C01', contentLineId: 'cl-a1', isWin: false });
    expect(c.keys.sort()).toEqual(['ec:e1', 'gc:g1', 'tc:t1']);
  });

  it('content kho team/kho cá nhân đã win (bản kho tổng có won_at) → isWin', () => {
    const t = teamContentCandidate({
      id: 't1', code: null, title: 'T', content_line_id: 'cl-a1', source_editor_content_id: null, source_content_id: null,
      source_editor_content: null, source_content: null,
      global_content: { id: 'g1', won_at: new Date(), win_video_views: BigInt(52000) },
    } as any);
    expect(t).toMatchObject({ isWin: true, winViews: 52000 });
    expect(t.keys.sort()).toEqual(['gc:g1', 'tc:t1']);

    const e = editorContentCandidate({
      id: 'e1', user_id: 'u1', code: null, title: null, content_line_id: null, source_content_id: 'g2',
      source_content: { code: null, title: 'Từ kho tổng', content_line_id: 'cl-a2', ...win }, global_content: null,
    } as any);
    expect(e).toMatchObject({ ownerUserId: 'u1', title: 'Từ kho tổng', contentLineId: 'cl-a2', tier: 0 });
    expect(e.keys.sort()).toEqual(['ec:e1', 'gc:g2']);
  });
});

describe('content trùng tiêu đề ở kho khác (không trỏ về nhau) vẫn là cùng 1 content', () => {
  const editorRow = (id: string, title: string) => ({
    id, user_id: 'u1', code: null, title, content_line_id: 'cl-a1', source_content_id: null,
    source_content: null, global_content: null,
  });
  const globalRow = (id: string, title: string) => ({
    id, code: null, title, content_line_id: 'cl-a1', ...win,
    source_team_content_id: null, source_editor_content_id: null, source_team_content: null,
  });

  it('không gợi ý 2 bản cùng tiêu đề; làm 1 bản trong 14 ngày chặn cả bản kia', () => {
    const e = editorContentCandidate(editorRow('e1', 'Quy tắc  đeo vòng tay') as any);
    const g = globalContentCandidate(globalRow('g1', 'quy tắc đeo vòng tay') as any);
    const other = globalContentCandidate(globalRow('g2', 'Cách đo size nhẫn tại nhà') as any);
    expect(e.keys).toContain('title:quy tắc đeo vòng tay');
    expect(g.keys).toContain('title:quy tắc đeo vòng tay');

    const base = { userId: 'u1', need: 3, pickedInRun: new Map(), today: RUN_AT };
    expect(pickContentSuggestions({ ...base, pool: [e, g, other], lastUsed: new Map() }).map((c) => c.id)).toEqual(['e1', 'g2']);
    const lastUsed = new Map([[g.keys[1], new Date('2026-10-05T03:00:00Z')]]);
    expect(pickContentSuggestions({ ...base, pool: [e, g, other], lastUsed }).map((c) => c.id)).toEqual(['g2']);
  });

  it('tiêu đề ngắn chung chung ("asmr", "content01") không dùng để nhận diện', () => {
    expect(globalContentCandidate(globalRow('g1', 'ASMR') as any).keys).toEqual(['gc:g1']);
  });
});

describe('pickContentSuggestions — chọn content gợi ý cho 1 người', () => {
  const pick = (args: Partial<Parameters<typeof pickContentSuggestions>[0]>) =>
    pickContentSuggestions({
      pool: [], userId: 'u1', need: 3, lastUsed: new Map(), pickedInRun: new Map(), today: RUN_AT, ...args,
    }).map((c) => c.id);

  it('content đã làm trong 14 ngày bị loại — kể cả làm bản ở kho khác của cùng content', () => {
    const pool = [
      content('g1', { keys: ['gc:g1', 'tc:t1'] }),
      content('g2'),
      content('g3'),
    ];
    const lastUsed = new Map([
      ['tc:t1', new Date('2026-09-26T03:00:00Z')], // 26/9 → 13 ngày trước 9/10: còn chặn
      ['gc:g2', new Date('2026-09-25T03:00:00Z')], // 25/9 → đủ 14 ngày: gợi ý lại được
    ]);
    expect(pick({ pool, lastUsed })).toEqual(['g3', 'g2']);
  });

  it('kho cá nhân chỉ gợi ý cho chính chủ; ưu tiên kho cá nhân → kho team → kho tổng', () => {
    const pool = [
      content('g1'),
      content('t1', { source: 'team', tier: 1, keys: ['tc:t1'] }),
      content('e-u2', { source: 'editor', tier: 0, ownerUserId: 'u2', keys: ['ec:e-u2'] }),
      content('e-u1', { source: 'editor', tier: 0, ownerUserId: 'u1', keys: ['ec:e-u1'] }),
    ];
    expect(pick({ pool })).toEqual(['e-u1', 't1', 'g1']);
  });

  it('content win lên trước; rải cho team: content đã gợi ý cho người khác trong lượt xếp sau', () => {
    const pool = [content('g1'), content('g2', { isWin: true }), content('g3')];
    expect(pick({ pool, need: 1 })).toEqual(['g2']);
    expect(pick({ pool, need: 2, pickedInRun: new Map([['gc:g2', 1]]) })).toEqual(['g1', 'g3']);
  });

  it('người đó lâu chưa làm lên trước (chưa từng làm đầu tiên)', () => {
    const pool = [content('g1'), content('g2'), content('g3')];
    const lastUsed = new Map([
      ['gc:g1', new Date('2026-09-20T03:00:00Z')],
      ['gc:g2', new Date('2026-08-20T03:00:00Z')],
    ]);
    expect(pick({ pool, lastUsed })).toEqual(['g3', 'g2', 'g1']);
  });

  it('không gợi ý 2 bản của cùng 1 content', () => {
    const pool = [
      content('e1', { source: 'editor', tier: 0, ownerUserId: 'u1', keys: ['ec:e1', 'gc:g1'] }),
      content('g1', { keys: ['gc:g1'] }),
      content('g2'),
    ];
    expect(pick({ pool })).toEqual(['e1', 'g2']);
  });

  it('số gợi ý = gấp đôi số còn thiếu, tối thiểu 3; đã đủ task thì không gợi ý', () => {
    expect(suggestionCount(0)).toBe(0);
    expect(suggestionCount(1)).toBe(3);
    expect(suggestionCount(4)).toBe(8);
  });
});

describe('pickWinVideoSuggestions — chọn video win gợi ý cho 1 người', () => {
  it('bỏ video người đó đã lấy làm content; ưu tiên video chưa gợi ý cho ai → kênh của team → nhiều view', () => {
    const pool = [
      video('p1', { views: 90000, fromTeam: false }),
      video('p2', { views: 15000 }),
      video('p3', { views: 30000 }),
      video('p4', { views: 99000 }),
    ];
    const ids = pickWinVideoSuggestions({
      pool, need: 3, excludedPostIds: new Set(['p4']), pickedInRun: new Map([['p3', 1]]),
    }).map((v) => v.post_id);
    expect(ids).toEqual(['p2', 'p1', 'p3']);
  });
});

describe('DailyPlanBuilderService.buildDailyPlans — lập kế hoạch, không tạo task', () => {
  const team = { id: 'team-1', name: 'Team K4', brand_type: 'TRANG_SUC' as const, market: 'VIETNAM' };

  function globalRow(id: string, extra: Record<string, any> = {}) {
    return {
      id, code: null, title: `Content ${id}`, content_line_id: 'cl-a1', ...win,
      source_team_content_id: null, source_editor_content_id: null, source_team_content: null, ...extra,
    };
  }

  function ownedVideo(postId: string, views: number) {
    return {
      platform: 'facebook', post_id: postId, url: `https://www.facebook.com/reel/${postId}`,
      description: `Nhẫn ${postId} #A1 #huyk`, thumbnail_url: '', play_count: views,
      date_posted: '2026-09-20T03:00:00.000Z', author_name: 'Huy K Trang Sức',
    };
  }

  function buildPlanner(opts: { existingPlan?: any; history?: any[]; matches?: any[]; converted?: any[] } = {}) {
    const prisma: any = {
      contentLine: { findMany: jest.fn(async () => [{ id: 'cl-a1', name: 'A1' }]) },
      // KPI A1 tháng 10: u1 = 44 (2 video/ngày), u2 = 22 (1 video/ngày)
      teamMember: {
        findMany: jest.fn(async () => [
          { user: { id: 'u1', editor_kpis: [{ allocations: [{ content_line_id: 'cl-a1', quantity: 44 }] }] } },
          { user: { id: 'u2', editor_kpis: [{ allocations: [{ content_line_id: 'cl-a1', quantity: 22 }] }] } },
        ]),
      },
      task: {
        // 2 query: đếm task theo tuyến (có content_line_id) và lịch sử dùng content (có OR)
        findMany: jest.fn(async (args: any) => (args.where.content_line_id ? [] : opts.history ?? [])),
      },
      content: { findMany: jest.fn(async () => ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => globalRow(id))) },
      teamContent: { findMany: jest.fn(async () => []) },
      editorContent: {
        findMany: jest.fn(async (args: any) => (args.where.reference_video_post_id ? opts.converted ?? [] : [])),
      },
      taskVideoMatch: { findMany: jest.fn(async () => opts.matches ?? []) },
      dailyLinePlan: {
        findUnique: jest.fn(async (args: any) =>
          opts.existingPlan && args.where.user_id_team_id_plan_date_content_line_id.user_id === 'u1'
            ? opts.existingPlan
            : null,
        ),
        create: jest.fn(async (args: any) => ({ id: `plan-${args.data.user_id}` })),
        update: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      dailyLinePlanSuggestion: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({})),
      },
      notification: { createMany: jest.fn(async () => ({})) },
    };
    const push: any = { sendToUser: jest.fn(async () => ({})) };
    const scraperRead: any = {
      ownedChannelVideos: jest.fn(async (args: any) => ({
        videos: args.team_id
          ? [ownedVideo('p1', 50000), ownedVideo('p2', 30000)]
          : [ownedVideo('p2', 30000), ownedVideo('p3', 20000), ownedVideo('p4', 12000)],
      })),
    };
    const service = new DailyPlanBuilderService(prisma, push, scraperRead);
    const run = () =>
      service.buildDailyPlans({ teams: [team], lineNames: ['A1', 'A2'], now: RUN_AT, month: '2026-10', deadline: DEADLINE, runId: 'run-1' });
    return { prisma, push, scraperRead, run };
  }

  const suggestionRows = (prisma: any, planId: string) =>
    prisma.dailyLinePlanSuggestion.createMany.mock.calls
      .map((c: any) => c[0].data)
      .find((rows: any[]) => rows[0]?.plan_id === planId);

  it('mỗi người 1 kế hoạch tuyến A1 theo KPI, gợi ý content kho + video win, rải không trùng trong team', async () => {
    const { prisma, scraperRead, run } = buildPlanner();

    const summary = await run();

    expect(summary).toMatchObject({ plan_date: '2026-10-10', lines: ['A1'], plans: 2 });
    const created = prisma.dailyLinePlan.create.mock.calls.map((c: any) => c[0].data);
    expect(created).toEqual([
      expect.objectContaining({ user_id: 'u1', content_line_id: 'cl-a1', target: 2, monthly_target: 44, deadline: DEADLINE, run_id: 'run-1', plan_date: new Date('2026-10-10T00:00:00Z') }),
      expect.objectContaining({ user_id: 'u2', target: 1, monthly_target: 22 }),
    ]);

    // u1 thiếu 2 → 4 content + 4 video (chỉ có 4 video); u2 thiếu 1 → 3 content khác u1 + video còn lại xếp trước
    const u1 = suggestionRows(prisma, 'plan-u1');
    const u1Contents = u1.filter((r: any) => r.kind === 'CONTENT').map((r: any) => r.content_id);
    expect(u1Contents).toEqual(['g1', 'g2', 'g3', 'g4']);
    const u1Videos = u1.filter((r: any) => r.kind === 'WIN_VIDEO');
    // Video kênh của team (p1, p2) trước, rồi video cùng thị trường nhiều view hơn
    expect(u1Videos.map((r: any) => r.video_post_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(u1Videos[0]).toMatchObject({
      video_url: 'https://www.facebook.com/reel/p1', video_views: 50000, video_page_name: 'Huy K Trang Sức',
      video_caption: 'Nhẫn p1 #A1 #huyk',
    });
    expect(u1.map((r: any) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const u2 = suggestionRows(prisma, 'plan-u2');
    expect(u2.filter((r: any) => r.kind === 'CONTENT').map((r: any) => r.content_id)).toEqual(['g5', 'g6', 'g1']);

    // Video win cùng nguồn lưới "Video win": FB > 10K view, 90 ngày, hashtag tuyến, kênh team trước rồi cùng thị trường
    expect(scraperRead.ownedChannelVideos.mock.calls[0][0]).toMatchObject({
      platform: 'facebook', min_plays: '10001', content_line: 'A1', date_from: '2026-07-11', sort: 'plays', team_id: 'team-1',
    });
    expect(scraperRead.ownedChannelVideos.mock.calls[1][0]).toMatchObject({ market: 'vn' });

    expect(prisma.task.createMany).toBeUndefined();
  });

  it('content làm trong 14 ngày không gợi ý lại; video đã lấy làm content không gợi ý lại', async () => {
    const { prisma, run } = buildPlanner({
      history: [{ assignee_id: 'u1', created_at: new Date('2026-10-01T03:00:00Z'), content: globalRow('g1'), team_content: null, editor_content: null }],
      converted: [{ user_id: 'u1', reference_video_post_id: 'p1' }],
    });

    await run();

    const u1 = suggestionRows(prisma, 'plan-u1');
    expect(u1.filter((r: any) => r.kind === 'CONTENT').map((r: any) => r.content_id)).not.toContain('g1');
    expect(u1.filter((r: any) => r.kind === 'WIN_VIDEO').map((r: any) => r.video_post_id)).not.toContain('p1');
  });

  it('video win đã khớp về task có content → gợi ý content đó (win) thay vì video', async () => {
    const { prisma, run } = buildPlanner({
      matches: [{ post_id: 'p1', task: { content: globalRow('g6'), team_content: null, editor_content: null } }],
    });

    await run();

    const u1 = suggestionRows(prisma, 'plan-u1');
    expect(u1[0]).toMatchObject({ kind: 'CONTENT', content_id: 'g6' });
    expect(u1.map((r: any) => r.video_post_id)).not.toContain('p1');
  });

  it('1 thông báo / người cho kế hoạch mới', async () => {
    const { prisma, push, run } = buildPlanner();

    await run();

    const notices = prisma.notification.createMany.mock.calls[0][0].data;
    expect(notices).toEqual([
      expect.objectContaining({ user_id: 'u1', type: 'DAILY_PLAN', title: 'Kế hoạch ngày 10/10', body: expect.stringContaining('A1: 2 video') }),
      expect.objectContaining({ user_id: 'u2', body: expect.stringContaining('A1: 1 video') }),
    ]);
    expect(push.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('chạy lại trong ngày: cập nhật chỉ tiêu, giữ gợi ý đã tạo task, không báo lại, xoá kế hoạch cũ không còn', async () => {
    const { prisma, run } = buildPlanner({
      existingPlan: { id: 'plan-old', suggestions: [{ rank: 2, content_id: 'g1', team_content_id: null, editor_content_id: null, video_post_id: null }] },
    });

    await run();

    expect(prisma.dailyLinePlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-old' },
      data: { target: 2, monthly_target: 44, deadline: DEADLINE, run_id: 'run-1' },
    });
    // Chỉ thay gợi ý chưa gắn task và không đang được tạo (giữ chỗ quá 2 phút coi như bỏ)
    const deleteWhere = prisma.dailyLinePlanSuggestion.deleteMany.mock.calls[0][0].where;
    expect(deleteWhere).toMatchObject({ plan_id: 'plan-old', task_id: null });
    expect(deleteWhere.OR[0]).toEqual({ used_at: null });
    expect(deleteWhere.OR[1].used_at.lt).toBeInstanceOf(Date);
    const rows = suggestionRows(prisma, 'plan-old');
    expect(rows.map((r: any) => r.content_id)).not.toContain('g1');
    expect(rows[0].rank).toBe(3);
    // Chỉ u2 là kế hoạch mới → chỉ báo u2
    expect(prisma.notification.createMany.mock.calls[0][0].data.map((n: any) => n.user_id)).toEqual(['u2']);
    expect(prisma.dailyLinePlan.deleteMany.mock.calls[0][0].where).toMatchObject({
      team_id: 'team-1',
      plan_date: new Date('2026-10-10T00:00:00Z'),
      id: { notIn: ['plan-old', 'plan-u2'] },
      suggestions: { none: { task_id: { not: null } } },
    });
  });
});

// ── Xem kế hoạch, tìm kiếm, tạo task (DailyPlansService) ──

function planOf(userId = 'u1') {
  return {
    user_id: userId,
    team_id: 'team-1',
    content_line_id: 'cl-a1',
    deadline: DEADLINE,
    team: { brand_type: 'TRANG_SUC', market: 'VIETNAM' },
  };
}

function suggestion(id: string, extra: Record<string, any> = {}) {
  return {
    id, kind: 'CONTENT', content_id: null, team_content_id: null, editor_content_id: null,
    video_post_id: null, video_url: null, video_caption: null, used_at: null, task_id: null,
    plan: planOf(), ...extra,
  };
}

function build(opts: { suggestions?: any[]; claimCount?: number; existingVideoContent?: any; createTask?: jest.Mock } = {}) {
  const prisma: any = {
    dailyLinePlan: { findMany: jest.fn() },
    task: { count: jest.fn(), groupBy: jest.fn(async () => []) },
    dailyLinePlanSuggestion: {
      findMany: jest.fn(async () => opts.suggestions ?? []),
      updateMany: jest.fn(async () => ({ count: opts.claimCount ?? 1 })),
    },
    editorContent: {
      findFirst: jest.fn(async () => opts.existingVideoContent ?? null),
      create: jest.fn(async () => ({ id: 'ec-new' })),
      delete: jest.fn(async () => ({})),
    },
  };
  const tasks: any = {
    create: opts.createTask ?? jest.fn(async (dto: any) => ({ id: `task-for-${dto.content_id ?? dto.team_content_id ?? dto.editor_content_id}` })),
  };
  const scraperRead: any = { ownedChannelVideos: jest.fn() };
  return { service: new DailyPlansService(prisma, tasks, scraperRead), prisma, tasks, scraperRead };
}

describe('DailyPlansService.getMyPlans — kế hoạch ngày của chính mình', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') }); // 9/10 19:00 giờ VN
  });
  afterAll(() => jest.useRealTimers());

  function planRow(id: string, date: string, line: string, target: number) {
    return {
      id, plan_date: new Date(`${date}T00:00:00Z`), target, monthly_target: 44, deadline: DEADLINE,
      team: { id: 'team-1', name: 'Team K4', market: 'VIETNAM' }, content_line: { id: `cl-${line}`, name: line.toUpperCase() },
    };
  }

  it('mặc định chỉ hôm nay (kể cả khi đã có kế hoạch ngày mai): chi tiết + gợi ý, đã làm đếm task có hạn trong ngày', async () => {
    const { service, prisma } = build({
      suggestions: [
        {
          id: 's1', plan_id: 'plan-1', kind: 'CONTENT', rank: 1, used_at: new Date(), task: { id: 't1', status: 'ASSIGNED' },
          content: null, editor_content: null,
          team_content: {
            id: 'tc1', code: null, title: null, content_line_id: null, source_editor_content_id: 'ec1', source_content_id: null,
            source_editor_content: { code: 'C09', title: 'Nhẫn cưới', content_line_id: 'cl-a1', source_content_id: null },
            source_content: null, global_content: { id: 'g1', won_at: new Date(), win_video_views: BigInt(40000) },
          },
        },
        {
          id: 's2', plan_id: 'plan-1', kind: 'WIN_VIDEO', rank: 2, used_at: null, task: null, content: null, team_content: null, editor_content: null,
          video_platform: 'facebook', video_post_id: 'p1', video_url: 'https://fb.com/reel/1', video_caption: 'Nhẫn #A1',
          video_thumbnail_url: null, video_views: 25000, video_published_at: null, video_page_name: 'Huy K',
        },
      ],
    });
    prisma.dailyLinePlan.findMany.mockResolvedValueOnce([planRow('plan-1', '2026-10-09', 'a1', 3)]);
    prisma.task.groupBy.mockResolvedValueOnce([{ team_id: 'team-1', content_line_id: 'cl-a1', _count: { _all: 1 } }]);

    const result = await service.getMyPlans('u1');

    expect(result).toMatchObject({ from: '2026-10-09', to: '2026-10-09', plan_date: '2026-10-09', plan_dates: ['2026-10-09'] });
    // Lọc đúng ngày hôm nay ở DB — kế hoạch ngày mai (lập lúc 17:00) không lọt vào
    expect(prisma.dailyLinePlan.findMany.mock.calls[0][0].where).toEqual({
      user_id: 'u1',
      plan_date: { gte: new Date('2026-10-09T00:00:00Z'), lte: new Date('2026-10-09T00:00:00Z') },
    });
    expect(prisma.dailyLinePlanSuggestion.findMany.mock.calls[0][0].where).toEqual({ plan_id: { in: ['plan-1'] } });
    expect(result.totals).toEqual([expect.objectContaining({ target: 3, done: 1, remaining: 2, days: 1 })]);
    expect(result.plans[0]).toMatchObject({ target: 3, done: 1, remaining: 2, content_line: { name: 'A1' } });
    expect(result.plans[0].suggestions[0]).toMatchObject({
      used: true, task: { id: 't1' },
      content: { source: 'team', id: 'tc1', code: 'C09', title: 'Nhẫn cưới', is_win: true, win_views: 40000 },
      video: null,
    });
    expect(result.plans[0].suggestions[1]).toMatchObject({ used: false, content: null, video: { post_id: 'p1', views: 25000 } });
    // Đã làm = task A1 của mình ở team đó, chưa huỷ, hạn trong ngày 9/10 giờ VN
    const where = prisma.task.groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({ assignee_id: 'u1', team_id: { in: ['team-1'] }, content_line_id: { in: ['cl-a1'] }, status: { not: 'CANCELLED' } });
    expect(where.OR[0].deadline).toEqual({ gte: new Date('2026-10-08T17:00:00Z'), lt: new Date('2026-10-09T17:00:00Z') });
  });

  it('khoảng nhiều ngày: cộng dồn chỉ tiêu theo tuyến, không kèm gợi ý; đã làm tính từ ngày có kế hoạch đầu tiên', async () => {
    const { service, prisma } = build();
    prisma.dailyLinePlan.findMany.mockResolvedValueOnce([
      planRow('p1', '2026-10-07', 'a1', 2), planRow('p2', '2026-10-08', 'a1', 3), planRow('p3', '2026-10-08', 'a3', 1),
    ]);
    prisma.task.groupBy.mockResolvedValueOnce([{ team_id: 'team-1', content_line_id: 'cl-a1', _count: { _all: 4 } }]);

    const result = await service.getMyPlans('u1', { from: '2026-10-01', to: '2026-10-09' });

    expect(result).toMatchObject({ from: '2026-10-01', to: '2026-10-09', plan_date: null, plan_dates: ['2026-10-07', '2026-10-08'], plans: [] });
    expect(result.totals.map((t: any) => [t.content_line.name, t.target, t.done, t.remaining, t.days])).toEqual([
      ['A1', 5, 4, 1, 2],
      ['A3', 1, 0, 1, 1],
    ]);
    // Từ 7/10 (kế hoạch đầu) tới hết 8/10 — không từ 1/10 (đầu khoảng lọc) khi chưa có kế hoạch
    expect(prisma.task.groupBy.mock.calls[0][0].where.OR[0].deadline).toEqual({
      gte: new Date('2026-10-06T17:00:00Z'),
      lt: new Date('2026-10-08T17:00:00Z'),
    });
    expect(prisma.dailyLinePlanSuggestion.findMany).not.toHaveBeenCalled();
  });

  it('"Tất cả ngày" không lọc ngày; chỉ có từ ngày → không giới hạn đến ngày', async () => {
    const { service, prisma } = build();
    prisma.dailyLinePlan.findMany.mockResolvedValue([]);

    expect(await service.getMyPlans('u1', { all: 'true' })).toEqual({
      from: null, to: null, plan_date: null, plan_dates: [], plans: [], totals: [],
    });
    expect(prisma.dailyLinePlan.findMany.mock.calls[0][0].where).toEqual({ user_id: 'u1' });

    await service.getMyPlans('u1', { from: '2026-10-01' });
    expect(prisma.dailyLinePlan.findMany.mock.calls[1][0].where).toEqual({
      user_id: 'u1',
      plan_date: { gte: new Date('2026-10-01T00:00:00Z') },
    });
    expect(prisma.task.groupBy).not.toHaveBeenCalled();
  });

  it('ngày được chọn chưa có kế hoạch → rỗng', async () => {
    const { service, prisma } = build();
    prisma.dailyLinePlan.findMany.mockResolvedValueOnce([]);

    expect(await service.getMyPlans('u1', { date: '2026-10-10' })).toEqual({
      from: '2026-10-10', to: '2026-10-10', plan_date: '2026-10-10', plan_dates: [], plans: [], totals: [],
    });
  });
});

describe('DailyPlansService.getMyPlans — gợi ý có task bị xoá', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') });
  });
  afterAll(() => jest.useRealTimers());

  it('giữ chỗ quá 2 phút mà không còn task (task đã bị xoá) → hiện là chưa dùng, tạo lại được', async () => {
    const row = (id: string, usedAt: string) => ({
      id, plan_id: 'plan-1', kind: 'CONTENT', rank: 1, used_at: new Date(usedAt), task: null,
      content: { id: 'g1', code: null, title: 'Nhẫn cưới', content_line_id: 'cl-a1', ...win,
        source_team_content_id: null, source_editor_content_id: null, source_team_content: null },
      team_content: null, editor_content: null,
    });
    const { service, prisma } = build({
      suggestions: [row('s-stale', '2026-10-09T11:50:00Z'), row('s-inflight', '2026-10-09T11:59:30Z')],
    });
    prisma.dailyLinePlan.findMany.mockResolvedValueOnce([{
      id: 'plan-1', plan_date: new Date('2026-10-09T00:00:00Z'), target: 2, monthly_target: 44, deadline: DEADLINE,
      team: { id: 'team-1', name: 'Team K4' }, content_line: { id: 'cl-a1', name: 'A1' },
    }]);

    const result = await service.getMyPlans('u1');

    expect(result.plans[0].suggestions.map((s: any) => [s.id, s.used])).toEqual([['s-stale', false], ['s-inflight', true]]);
  });
});

describe('DailyPlansService.quickCreate — tạo task từ gợi ý', () => {
  it('gợi ý content → task gắn đúng content, tuyến + hạn theo kế hoạch, người nhận là mình', async () => {
    const { service, prisma, tasks } = build({
      suggestions: [suggestion('s1', { team_content_id: 'tc1' }), suggestion('s2', { content_id: 'g1' })],
    });

    const result = await service.quickCreate('u1', ['MEMBER'], ['s1', 's2']);

    expect(result).toEqual({
      created: [{ suggestion_id: 's1', task_id: 'task-for-tc1' }, { suggestion_id: 's2', task_id: 'task-for-g1' }],
      failed: [],
    });
    expect(tasks.create).toHaveBeenCalledWith(
      {
        team_id: 'team-1', team_content_id: 'tc1', content_id: undefined, editor_content_id: undefined,
        content_line_id: 'cl-a1', assignee_id: 'u1', deadline: '2026-10-10T10:00:00.000Z',
      },
      'u1',
      ['MEMBER'],
    );
    // Giữ chỗ gợi ý trước khi tạo (chưa giữ chỗ hoặc giữ chỗ đã quá hạn), gắn task sau khi tạo
    const claim = prisma.dailyLinePlanSuggestion.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 's1', task_id: null });
    expect(claim.where.OR[0]).toEqual({ used_at: null });
    expect(prisma.dailyLinePlanSuggestion.updateMany).toHaveBeenCalledWith({ where: { id: 's1' }, data: { task_id: 'task-for-tc1' } });
  });

  it('gợi ý video win → tạo content kho cá nhân từ caption bỏ hashtag, rồi tạo task với content đó', async () => {
    const { service, prisma, tasks } = build({
      suggestions: [suggestion('s1', {
        kind: 'WIN_VIDEO', video_post_id: 'p1', video_url: 'https://fb.com/reel/1',
        video_caption: 'Cách đo size nhẫn tại nhà #K301 #a1 #Huykvienchibao',
      })],
    });

    const result = await service.quickCreate('u1', [], ['s1']);

    expect(prisma.editorContent.create).toHaveBeenCalledWith({
      data: {
        user_id: 'u1', added_by_id: 'u1', brand_type: 'TRANG_SUC', market: 'VIETNAM',
        title: 'Cách đo size nhẫn tại nhà', body: 'Cách đo size nhẫn tại nhà',
        content_line_id: 'cl-a1', reference_video_url: 'https://fb.com/reel/1', reference_video_post_id: 'p1',
      },
      select: { id: true },
    });
    expect(tasks.create.mock.calls[0][0]).toMatchObject({ editor_content_id: 'ec-new', content_line_id: 'cl-a1' });
    expect(result.created).toEqual([{ suggestion_id: 's1', task_id: 'task-for-ec-new' }]);
  });

  it('đã có content từ đúng video đó trong kho cá nhân → dùng lại, không tạo content trùng', async () => {
    const { service, prisma, tasks } = build({
      suggestions: [suggestion('s1', { kind: 'WIN_VIDEO', video_post_id: 'p1', video_caption: 'x' })],
      existingVideoContent: { id: 'ec-old' },
    });

    await service.quickCreate('u1', [], ['s1']);

    expect(prisma.editorContent.create).not.toHaveBeenCalled();
    expect(tasks.create.mock.calls[0][0]).toMatchObject({ editor_content_id: 'ec-old' });
  });

  it('gợi ý của người khác / đã tạo task / bấm 2 lần → không tạo', async () => {
    const { service, tasks } = build({
      suggestions: [
        suggestion('s-other', { content_id: 'g1', plan: planOf('u2') }),
        suggestion('s-done', { content_id: 'g2', task_id: 't9', used_at: new Date() }),
      ],
    });

    const result = await service.quickCreate('u1', [], ['s-other', 's-done', 's-missing']);

    expect(result.created).toEqual([]);
    expect(result.failed.map((f) => f.suggestion_id)).toEqual(['s-other', 's-done', 's-missing']);
    expect(tasks.create).not.toHaveBeenCalled();

    // Request thứ 2 đến sau khi request đầu đã giữ chỗ
    const racing = build({ suggestions: [suggestion('s1', { content_id: 'g1' })], claimCount: 0 });
    expect((await racing.service.quickCreate('u1', [], ['s1'])).failed).toEqual([
      { suggestion_id: 's1', message: 'Gợi ý này đã được tạo task' },
    ]);
    expect(racing.tasks.create).not.toHaveBeenCalled();
  });

  it('tạo task lỗi → nhả gợi ý để thử lại, xoá content vừa tạo từ video', async () => {
    const { service, prisma } = build({
      suggestions: [suggestion('s1', { kind: 'WIN_VIDEO', video_post_id: 'p1', video_caption: 'Nhẫn #A1' })],
      createTask: jest.fn(async () => { throw new Error('Bạn không thuộc team này'); }),
    });

    const result = await service.quickCreate('u1', [], ['s1']);

    expect(result.failed).toEqual([{ suggestion_id: 's1', message: 'Bạn không thuộc team này' }]);
    expect(prisma.dailyLinePlanSuggestion.updateMany).toHaveBeenLastCalledWith({
      where: { id: 's1', task_id: null }, data: { used_at: null },
    });
    expect(prisma.editorContent.delete).toHaveBeenCalledWith({ where: { id: 'ec-new' } });
  });

  it('task đã tạo nhưng không gắn được vào gợi ý (lượt chia vừa thay gợi ý) → vẫn tính đã tạo, không dọn content', async () => {
    const { service, prisma } = build({
      suggestions: [suggestion('s1', { kind: 'WIN_VIDEO', video_post_id: 'p1', video_caption: 'Nhẫn #A1' })],
    });
    prisma.dailyLinePlanSuggestion.updateMany
      .mockResolvedValueOnce({ count: 1 }) // giữ chỗ
      .mockRejectedValueOnce(new Error('Record to update not found')); // gắn task

    const result = await service.quickCreate('u1', [], ['s1']);

    expect(result).toEqual({ created: [{ suggestion_id: 's1', task_id: 'task-for-ec-new' }], failed: [] });
    expect(prisma.editorContent.delete).not.toHaveBeenCalled();
  });
});

describe('tìm trong hệ thống — khớp từ khoá, gộp bản trùng, tuyến từ hashtag', () => {
  it('không phân biệt dấu / hoa thường / khoảng trắng; mọi từ đều phải có trong tiêu đề hoặc mã', () => {
    expect(normalizeSearchText('  Nhẫn   CƯỚI Đá ')).toBe('nhan cuoi da');
    const c = { title: 'Cách đo size nhẫn tại nhà', code: 'K301' };
    expect(contentMatchesQuery(c, 'do size nhan')).toBe(true);
    expect(contentMatchesQuery(c, 'k301 nhẫn')).toBe(true);
    expect(contentMatchesQuery(c, 'nhẫn cưới')).toBe(false);
    expect(contentMatchesQuery(c, '')).toBe(true);
  });

  it('cùng content ở nhiều kho chỉ giữ bản gần người làm nhất (cá nhân → team → tổng)', () => {
    const cand = (id: string, tier: number, keys: string[]) => ({ id, tier, keys } as any);
    const kept = dedupeContentCopies([cand('g1', 2, ['gc:g1', 'ec:e1']), cand('e1', 0, ['ec:e1']), cand('t9', 1, ['tc:t9'])]);
    expect(kept.map((c) => c.id)).toEqual(['e1', 't9']);
  });

  it('tuyến lấy từ hashtag #A1..#A5 trong caption, không nhầm #A10 / #a1b', () => {
    expect(lineNameFromCaption('Nhẫn bị rộng #K102 #a1 #huyk')).toBe('A1');
    expect(lineNameFromCaption('Video #A10 #a1b')).toBeNull();
    expect(lineNameFromCaption(null)).toBeNull();
  });
});

describe('DailyPlansService.searchForPlan — tìm content kho / video win cho kế hoạch', () => {
  const PLAN = { id: 'plan-1', team_id: 'team-1', content_line_id: 'cl-a1', deadline: DEADLINE, team: { brand_type: 'TRANG_SUC', market: 'VIETNAM' } };
  const globalRow = (id: string, title: string, line: string | null, extra: Record<string, any> = {}) => ({
    id, code: null, title, content_line_id: line, ...win,
    source_team_content_id: null, source_editor_content_id: null, source_team_content: null, ...extra,
  });
  const editorRow = (id: string, title: string, line: string, extra: Record<string, any> = {}) => ({
    id, user_id: 'u1', code: null, title, content_line_id: line, source_content_id: null,
    source_content: null, global_content: null, ...extra,
  });

  function setup(opts: { globals?: any[]; editors?: any[]; history?: any[]; converted?: any[] } = {}) {
    const ctx = build();
    const { prisma } = ctx;
    prisma.dailyLinePlan.findFirst = jest.fn(async (args: any) => (args.where.user_id === 'u1' ? PLAN : null));
    prisma.contentLine = { findMany: jest.fn(async () => [{ id: 'cl-a1', name: 'A1' }, { id: 'cl-a2', name: 'A2' }]) };
    prisma.content = { findMany: jest.fn(async () => opts.globals ?? []) };
    prisma.teamContent = { findMany: jest.fn(async () => []) };
    prisma.editorContent.findMany = jest.fn(async (args: any) =>
      args.where.reference_video_post_id ? opts.converted ?? [] : opts.editors ?? []);
    prisma.task.findMany = jest.fn(async () => opts.history ?? []);
    return ctx;
  }

  it('mặc định lọc theo tuyến của kế hoạch; tìm không dấu; content win lên trước, rồi kho cá nhân', async () => {
    const { service, prisma } = setup({
      globals: [
        globalRow('g1', 'Cách đo size nhẫn tại nhà', 'cl-a1'),
        globalRow('g2', 'Nhẫn cưới đẹp', 'cl-a1', { won_at: new Date(), win_video_views: BigInt(52000) }),
        globalRow('g3', 'Nhẫn tuyến khác', 'cl-a2'),
      ],
      editors: [editorRow('e1', 'Nhẫn kim tiền', 'cl-a1')],
    });

    const res = await service.searchForPlan('u1', 'plan-1', { kind: 'content', q: 'nhan' });

    expect(res.items.map((i: any) => i.id)).toEqual(['g2', 'e1', 'g1']);
    expect(res.items[0]).toMatchObject({ source: 'global', is_win: true, win_views: 52000, line: { name: 'A1' } });
    // Chỉ lấy kho cá nhân của chính mình + kho team của kế hoạch
    expect(prisma.editorContent.findMany.mock.calls[0][0].where.user_id).toEqual({ in: ['u1'] });
    expect(prisma.teamContent.findMany.mock.calls[0][0].where.team_id).toBe('team-1');

    const all = await service.searchForPlan('u1', 'plan-1', { kind: 'content', q: 'nhan', line: 'all' });
    expect(all.items.map((i: any) => i.id)).toContain('g3');
  });

  it('báo lần gần nhất mình đã làm content đó (vẫn cho tạo)', async () => {
    const { service } = setup({
      globals: [globalRow('g1', 'Cách đo size nhẫn tại nhà', 'cl-a1')],
      history: [{ assignee_id: 'u1', created_at: new Date('2026-10-02T03:00:00Z'), content: globalRow('g1', 'Cách đo size nhẫn tại nhà', 'cl-a1'), team_content: null, editor_content: null }],
    });

    const res = await service.searchForPlan('u1', 'plan-1', { kind: 'content' });

    expect((res.items[0] as any).last_used_at).toEqual(new Date('2026-10-02T03:00:00Z'));
  });

  it('video win: tìm trên mọi kênh FB > 10K view theo tuyến của kế hoạch; đánh dấu video đã có trong kho cá nhân', async () => {
    const { service, scraperRead } = setup({ converted: [{ user_id: 'u1', reference_video_post_id: 'p2' }] });
    scraperRead.ownedChannelVideos.mockResolvedValue({
      count: 25, total_pages: 2,
      videos: [
        { platform: 'facebook', post_id: 'p1', url: 'https://fb.com/reel/1', description: 'Nhẫn #A1 #huyk', thumbnail_url: '', play_count: 50000, date_posted: '2026-09-20', author_name: 'Huy K' },
        { platform: 'facebook', post_id: 'p2', url: 'https://fb.com/reel/2', description: 'Vòng #a1', thumbnail_url: 't.jpg', play_count: 20000, date_posted: '2026-09-21', author_name: 'Huy K' },
      ],
    });

    const res = await service.searchForPlan('u1', 'plan-1', { kind: 'video', q: 'nhẫn', page: 1 });

    expect(scraperRead.ownedChannelVideos).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'facebook', min_plays: '10001', q: 'nhẫn', content_line: 'A1', sort: 'plays', page: '1', page_size: '20',
    }));
    expect(scraperRead.ownedChannelVideos.mock.calls[0][0].team_id).toBeUndefined();
    expect(res).toMatchObject({ total: 25, has_more: true });
    expect(res.items.map((v: any) => [v.post_id, v.line_name, v.in_my_warehouse])).toEqual([['p1', 'A1', false], ['p2', 'A1', true]]);
  });

  it('kế hoạch của người khác → không tìm', async () => {
    const { service } = setup();
    await expect(service.searchForPlan('u2', 'plan-1', { kind: 'content' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DailyPlansService.quickCreateFromSearch — tạo task từ kết quả tìm kiếm', () => {
  const PLAN = { id: 'plan-1', team_id: 'team-1', content_line_id: 'cl-a1', deadline: DEADLINE, team: { brand_type: 'TRANG_SUC', market: 'VIETNAM' } };

  function setup(opts: { recentTask?: any; suggestion?: any; video?: any[] } = {}) {
    const ctx = build();
    const { prisma } = ctx;
    prisma.dailyLinePlan.findFirst = jest.fn(async (args: any) => (args.where.user_id === 'u1' ? PLAN : null));
    prisma.teamContent = {
      findFirst: jest.fn(async (args: any) => (args.where.team_id === 'team-1' && args.where.id === 'tc1'
        ? { id: 'tc1', code: null, title: 'T', content_line_id: 'cl-a2', source_editor_content_id: null, source_content_id: null, source_editor_content: null, source_content: null, global_content: null }
        : null)),
    };
    prisma.editorContent.findFirst = jest.fn(async () => null);
    prisma.contentLine = { findFirst: jest.fn(async (args: any) => (args.where.name.equals === 'A2' ? { id: 'cl-a2' } : null)) };
    prisma.task.findFirst = jest.fn(async () => opts.recentTask ?? null);
    prisma.dailyLinePlanSuggestion.findFirst = jest.fn(async () => opts.suggestion ?? null);
    prisma.$queryRaw = jest.fn(async () => opts.video ?? []);
    return ctx;
  }

  it('content kho team của kế hoạch → task theo tuyến của content, hạn theo kế hoạch; trùng gợi ý thì gắn luôn', async () => {
    const { service, prisma, tasks } = setup({ suggestion: { id: 's7' } });

    const res = await service.quickCreateFromSearch('u1', ['MEMBER'], 'plan-1', { kind: 'CONTENT', source: 'team', content_id: 'tc1' });

    expect(res).toEqual({ task_id: 'task-for-tc1', reused: false });
    expect(tasks.create).toHaveBeenCalledWith(
      { team_id: 'team-1', team_content_id: 'tc1', content_line_id: 'cl-a2', assignee_id: 'u1', deadline: '2026-10-10T10:00:00.000Z' },
      'u1',
      ['MEMBER'],
    );
    expect(prisma.dailyLinePlanSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 's7', task_id: null }, data: { task_id: 'task-for-tc1', used_at: expect.any(Date) },
    });
  });

  it('content không thuộc kho được dùng (kho team khác / kho cá nhân người khác) → từ chối', async () => {
    const { service, tasks } = setup();
    await expect(
      service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'CONTENT', source: 'team', content_id: 'tc-other-team' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'CONTENT', source: 'editor', content_id: 'ec-of-u2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('video win → BE tự tra video, tạo content kho cá nhân bỏ hashtag, tuyến theo hashtag của video', async () => {
    const { service, prisma, tasks } = setup({
      video: [{ post_id: 'p9', url: 'https://fb.com/reel/9', caption: 'Nhẫn bị rộng phải làm sao? #K102 #a2 #huyk' }],
    });

    const res = await service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'WIN_VIDEO', post_id: 'p9' });

    expect(prisma.editorContent.create.mock.calls[0][0].data).toMatchObject({
      user_id: 'u1', title: 'Nhẫn bị rộng phải làm sao?', body: 'Nhẫn bị rộng phải làm sao?',
      content_line_id: 'cl-a2', reference_video_post_id: 'p9', reference_video_url: 'https://fb.com/reel/9',
    });
    expect(tasks.create.mock.calls[0][0]).toMatchObject({ editor_content_id: 'ec-new', content_line_id: 'cl-a2' });
    expect(res.task_id).toBe('task-for-ec-new');
  });

  it('video không phải video win của kênh nội bộ → từ chối, không tạo gì', async () => {
    const { service, prisma, tasks } = setup({ video: [] });
    await expect(service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'WIN_VIDEO', post_id: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.editorContent.create).not.toHaveBeenCalled();
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('bấm 2 lần trong 1 phút → trả lại task vừa tạo, không tạo trùng', async () => {
    const { service, tasks } = setup({ recentTask: { id: 't-just-now' } });

    const res = await service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'CONTENT', source: 'team', content_id: 'tc1' });

    expect(res).toEqual({ task_id: 't-just-now', reused: true });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('tạo task lỗi → xoá content vừa tạo từ video', async () => {
    const { service, prisma } = setup({ video: [{ post_id: 'p9', url: null, caption: 'Nhẫn #a1' }] });
    (service as any).tasks.create = jest.fn(async () => { throw new Error('Bạn không thuộc team này'); });

    await expect(service.quickCreateFromSearch('u1', [], 'plan-1', { kind: 'WIN_VIDEO', post_id: 'p9' })).rejects.toThrow('Bạn không thuộc team này');
    expect(prisma.editorContent.delete).toHaveBeenCalledWith({ where: { id: 'ec-new' } });
  });
});

describe('tìm trong hệ thống — lọc thị trường Việt Nam / Global', () => {
  it('mặc định theo thị trường của team; Global = mọi thị trường ngoài Việt Nam', () => {
    expect(defaultSearchMarket({ market: 'VIETNAM' })).toBe('vn');
    expect(defaultSearchMarket({ market: 'THAILAND' })).toBe('global');
    expect(defaultSearchMarket({ market: null })).toBe('vn');
    expect(contentMatchesMarket({ market: 'VIETNAM' }, 'vn')).toBe(true);
    expect(contentMatchesMarket({ market: 'JAPAN' }, 'vn')).toBe(false);
    expect(contentMatchesMarket({ market: 'JAPAN' }, 'global')).toBe(true);
    expect(contentMatchesMarket({ market: 'GLOBAL' }, 'global')).toBe(true);
    expect(contentMatchesMarket({ market: 'VIETNAM' }, 'all')).toBe(true);
  });

  it('video: Đồ Da chọn Việt Nam dùng nhánh "doda" (nhánh "vn" của lưới video loại video Đồ Da)', () => {
    expect(videoMarketParam('vn', 'TRANG_SUC')).toBe('vn');
    expect(videoMarketParam('vn', 'DO_DA')).toBe('doda');
    expect(videoMarketParam('global', 'TRANG_SUC')).toBe('global');
    expect(videoMarketParam('all', 'TRANG_SUC')).toBeUndefined();
  });

  it('content kho team đẩy từ kho cá nhân không tự lưu data → thị trường theo bản gốc (cột market chỉ là mặc định)', () => {
    const c = teamContentCandidate({
      id: 'tc1', code: null, title: null, market: 'VIETNAM', content_line_id: null,
      source_editor_content_id: 'e1', source_content_id: null,
      source_editor_content: { code: null, title: 'Cincin', market: 'INDONESIA', content_line_id: 'cl-a1', source_content_id: null },
      source_content: null, global_content: null,
    } as any);
    expect(c.market).toBe('INDONESIA');
  });
});

describe('DailyPlansService.searchForPlan — mặc định lọc thị trường của team', () => {
  function setup(teamMarket: string, brandType = 'TRANG_SUC') {
    const ctx = build();
    const { prisma } = ctx;
    const plan = { id: 'plan-1', team_id: 'team-1', content_line_id: 'cl-a1', deadline: DEADLINE, team: { brand_type: brandType, market: teamMarket } };
    const row = (id: string, market: string) => ({
      id, code: null, title: `Content ${id}`, market, content_line_id: 'cl-a1', ...win,
      source_team_content_id: null, source_editor_content_id: null, source_team_content: null,
    });
    prisma.dailyLinePlan.findFirst = jest.fn(async () => plan);
    prisma.contentLine = { findMany: jest.fn(async () => [{ id: 'cl-a1', name: 'A1' }]) };
    prisma.content = { findMany: jest.fn(async () => [row('vn1', 'VIETNAM'), row('th1', 'THAILAND'), row('gl1', 'GLOBAL')]) };
    prisma.teamContent = { findMany: jest.fn(async () => []) };
    prisma.editorContent.findMany = jest.fn(async () => []);
    prisma.task.findMany = jest.fn(async () => []);
    ctx.scraperRead.ownedChannelVideos.mockResolvedValue({ count: 0, total_pages: 1, videos: [] });
    return ctx;
  }

  it('team Việt Nam → mặc định chỉ content Việt Nam; chọn Global / tất cả thì mở rộng', async () => {
    const { service } = setup('VIETNAM');
    const ids = async (market?: any) =>
      (await service.searchForPlan('u1', 'plan-1', { kind: 'content', market })).items.map((i: any) => i.id).sort();

    expect(await ids()).toEqual(['vn1']);
    expect(await ids('global')).toEqual(['gl1', 'th1']);
    expect(await ids('all')).toEqual(['gl1', 'th1', 'vn1']);
    expect((await service.searchForPlan('u1', 'plan-1', { kind: 'content' })).market).toBe('vn');
  });

  it('team nước ngoài → mặc định Global; video truyền đúng bộ lọc thị trường', async () => {
    const { service, scraperRead } = setup('THAILAND');

    expect((await service.searchForPlan('u1', 'plan-1', { kind: 'content' })).items.map((i: any) => i.id).sort()).toEqual(['gl1', 'th1']);
    await service.searchForPlan('u1', 'plan-1', { kind: 'video' });
    expect(scraperRead.ownedChannelVideos.mock.calls[0][0].market).toBe('global');
  });

  it('team Đồ Da (Việt Nam) → video lọc nhánh Đồ Da', async () => {
    const { service, scraperRead } = setup('VIETNAM', 'DO_DA');
    await service.searchForPlan('u1', 'plan-1', { kind: 'video' });
    expect(scraperRead.ownedChannelVideos.mock.calls[0][0].market).toBe('doda');
  });
});

import { VideoLibraryService } from '../src/modules/video-library/video-library.service';

/**
 * Bộ Sưu Tập theo team:
 *  - tab Team: team nào chỉ thấy video của team đó (ADMIN/MANAGER thấy mọi team);
 *  - tab Chung: ai cũng thấy toàn bộ, gồm cả video của mọi team;
 *  - video gắn vào MỌI team của người thêm (leader) / người đề xuất (member).
 */
function libRow(overrides: Partial<any> = {}) {
  return {
    id: 'lib1',
    video_id: 'v1',
    collection_type: 'TEAM',
    created_at: new Date('2026-09-01'),
    teams: [],
    ...overrides,
  };
}

function teamLink(id: string, name: string) {
  return { team: { id, name } };
}

function build() {
  const prisma: any = {
    notification: { create: jest.fn(async () => ({})) },
    team: { findMany: jest.fn(async () => []) },
    videoLibraryTeam: { createMany: jest.fn(async () => ({ count: 0 })) },
    videoLibrary: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'lib-new', ...data })),
      delete: jest.fn(async () => ({})),
    },
    scraperVideoProposal: {
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    },
    approvedContent: { create: jest.fn(async () => ({ id: 'c1' })) },
  };
  const push: any = { sendToUser: jest.fn(async () => {}) };
  const aiIntegration: any = {
    analyzeScrapedVideo: jest.fn(async () => ({ vietnamese_content: 'x', script_outline: 'y', hashtags: [] })),
    fetchVideoDetail: jest.fn(async () => null),
  };
  const service = new VideoLibraryService(prisma, push, aiIntegration);
  /** team.findMany trả team theo user: leader_id hoặc thành viên. */
  const setTeamsOf = (map: Record<string, string[]>) => {
    prisma.team.findMany.mockImplementation(async ({ where }: any) => {
      const userId = where.OR[0].leader_id;
      return (map[userId] ?? []).map((id) => ({ id }));
    });
  };
  return { service, prisma, setTeamsOf };
}

const video = {
  video_id: 'v1',
  platform: 'tiktok',
  title: 'T',
  description: '',
  video_url: 'https://www.tiktok.com/@a/video/7300000000000000001',
  author_username: 'a',
  author_name: 'A',
};

describe('Bộ Sưu Tập theo team — danh sách', () => {
  afterEach(() => jest.clearAllMocks());

  it('getUserTeamIds: lấy team người dùng là leader HOẶC thành viên, chỉ team còn hoạt động', async () => {
    const { service, prisma } = build();
    prisma.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    await expect(service.getUserTeamIds('u1')).resolves.toEqual(['t1', 't2']);
    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { is_active: true, OR: [{ leader_id: 'u1' }, { members: { some: { user_id: 'u1' } } }] },
      select: { id: true },
    });
  });

  it('Tab Team của member chỉ lấy video gắn với team mình', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ member1: ['t1', 't2'] });
    prisma.videoLibrary.findMany.mockResolvedValue([libRow({ teams: [teamLink('t1', 'Team K5')] })]);

    const rows = await service.listVideoLibrary('TEAM', 'member1', ['MEMBER']);

    expect(prisma.videoLibrary.findMany.mock.calls[0][0].where).toEqual({
      collection_type: 'TEAM',
      teams: { some: { team_id: { in: ['t1', 't2'] } } },
    });
    expect(rows).toEqual([expect.objectContaining({ id: 'lib1', teams: [{ id: 't1', name: 'Team K5' }] })]);
  });

  it('Tab Team của người không thuộc team nào → rỗng, không truy vấn video', async () => {
    const { service, prisma } = build();
    await expect(service.listVideoLibrary('TEAM', 'lonely', ['MEMBER'])).resolves.toEqual([]);
    expect(prisma.videoLibrary.findMany).not.toHaveBeenCalled();
  });

  it.each([['ADMIN'], ['MANAGER']])('Tab Team của %s thấy video mọi team', async (role) => {
    const { service, prisma } = build();
    prisma.videoLibrary.findMany.mockResolvedValue([
      libRow({ id: 'a', teams: [teamLink('t1', 'K5')] }),
      libRow({ id: 'b', video_id: 'v2', teams: [teamLink('t2', 'Indo')] }),
    ]);

    const rows = await service.listVideoLibrary('TEAM', 'boss', [role]);

    expect(prisma.videoLibrary.findMany.mock.calls[0][0].where).toEqual({ collection_type: 'TEAM' });
    expect(prisma.team.findMany).not.toHaveBeenCalled();
    expect(rows.map((r: any) => r.id)).toEqual(['a', 'b']);
  });

  it('Tab Chung: ai cũng thấy toàn bộ, gồm cả video của các team', async () => {
    const { service, prisma } = build();
    prisma.videoLibrary.findMany.mockResolvedValue([
      libRow({ id: 'team-vid', teams: [teamLink('t1', 'K5')] }),
      libRow({ id: 'admin-vid', video_id: 'v2', collection_type: 'SHARED' }),
    ]);

    const rows = await service.listVideoLibrary('SHARED', 'member1', ['MEMBER']);

    expect(prisma.videoLibrary.findMany.mock.calls[0][0].where).toBeUndefined();
    expect(rows.map((r: any) => [r.id, r.teams])).toEqual([
      ['team-vid', [{ id: 't1', name: 'K5' }]],
      ['admin-vid', []],
    ]);
  });

  it('Tab Chung gộp video trùng ở cả Team lẫn Chung thành 1 thẻ, giữ dòng Chung + team', async () => {
    const { service, prisma } = build();
    prisma.videoLibrary.findMany.mockResolvedValue([
      libRow({ id: 'team-row', video_id: 'v1', teams: [teamLink('t1', 'K5')] }),
      libRow({ id: 'shared-row', video_id: 'v1', collection_type: 'SHARED' }),
    ]);

    const rows = await service.listVideoLibrary('SHARED', 'u', ['MEMBER']);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: 'shared-row', collection_type: 'SHARED', teams: [{ id: 't1', name: 'K5' }] }));
  });
});

describe('Bộ Sưu Tập theo team — gắn team khi thêm/duyệt', () => {
  afterEach(() => jest.clearAllMocks());

  it('Leader thêm thẳng → video gắn vào TẤT CẢ team của leader', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ leader1: ['t1', 't2'] });

    await service.addVideoDirectly('leader1', 'Leader', ['LEADER'], { ...video } as any);

    expect(prisma.videoLibraryTeam.createMany).toHaveBeenCalledWith({
      data: [
        { video_library_id: 'lib-new', team_id: 't1' },
        { video_library_id: 'lib-new', team_id: 't2' },
      ],
      skipDuplicates: true,
    });
  });

  it('Leader thêm video team khác đã có → chỉ gắn thêm team, không gọi TikHub', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ leaderB: ['tB'] });
    prisma.videoLibrary.findUnique.mockResolvedValue({ id: 'lib-old' });
    const ai = (service as any).aiIntegration;

    const res = await service.addVideoDirectly('leaderB', 'B', ['LEADER'], { ...video } as any);

    expect(res.videoLibraryId).toBe('lib-old');
    expect(prisma.videoLibraryTeam.createMany).toHaveBeenCalledWith({
      data: [{ video_library_id: 'lib-old', team_id: 'tB' }],
      skipDuplicates: true,
    });
    expect(ai.fetchVideoDetail).not.toHaveBeenCalled();
    expect(prisma.videoLibrary.create).not.toHaveBeenCalled();
  });

  it('Admin thêm thẳng → vào tab Chung, không gắn team', async () => {
    const { service, prisma } = build();
    await service.addVideoDirectly('admin1', 'Admin', ['ADMIN'], { ...video } as any);

    expect(prisma.videoLibrary.create.mock.calls[0][0].data.collection_type).toBe('SHARED');
    expect(prisma.videoLibraryTeam.createMany).not.toHaveBeenCalled();
  });

  function pendingProposal() {
    return {
      id: 'p1',
      status: 'PENDING',
      requested_by_id: 'member1',
      ...video,
      thumbnail_url: null,
      views_count: 0n,
      likes_count: 0n,
      comments_count: 0n,
      shares_count: 0n,
      notes: null,
    };
  }

  it('Leader duyệt đề xuất → video gắn vào mọi team của NGƯỜI ĐỀ XUẤT', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ member1: ['t1', 't3'], leader1: ['t1'] });
    prisma.scraperVideoProposal.findUnique.mockResolvedValue(pendingProposal());

    await service.reviewProposal('p1', 'APPROVED', undefined, 'leader1', 'Leader', ['LEADER']);

    expect(prisma.videoLibraryTeam.createMany.mock.calls[0][0].data.map((d: any) => d.team_id)).toEqual(['t1', 't3']);
  });

  it('Người đề xuất không thuộc team nào → lấy team của leader duyệt', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ leader1: ['t9'] });
    prisma.scraperVideoProposal.findUnique.mockResolvedValue(pendingProposal());

    await service.reviewProposal('p1', 'APPROVED', undefined, 'leader1', 'Leader', ['LEADER']);

    expect(prisma.videoLibraryTeam.createMany.mock.calls[0][0].data.map((d: any) => d.team_id)).toEqual(['t9']);
  });

  it('Admin duyệt đề xuất → vẫn vào kho Team của NGƯỜI ĐỀ XUẤT (tab Chung tự hiện mọi video)', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({ member1: ['t1', 't3'] });
    prisma.scraperVideoProposal.findUnique.mockResolvedValue(pendingProposal());

    await service.reviewProposal('p1', 'APPROVED', undefined, 'admin1', 'Admin', ['ADMIN']);

    expect(prisma.videoLibrary.create.mock.calls[0][0].data.collection_type).toBe('TEAM');
    expect(prisma.videoLibraryTeam.createMany.mock.calls[0][0].data.map((d: any) => d.team_id)).toEqual(['t1', 't3']);
  });

  it('Admin duyệt đề xuất của người không thuộc team nào → kho Chung', async () => {
    const { service, prisma, setTeamsOf } = build();
    setTeamsOf({});
    prisma.scraperVideoProposal.findUnique.mockResolvedValue(pendingProposal());

    await service.reviewProposal('p1', 'APPROVED', undefined, 'admin1', 'Admin', ['ADMIN']);

    expect(prisma.videoLibrary.create.mock.calls[0][0].data.collection_type).toBe('SHARED');
    expect(prisma.videoLibraryTeam.createMany).not.toHaveBeenCalled();
  });
});

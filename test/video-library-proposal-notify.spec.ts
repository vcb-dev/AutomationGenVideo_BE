import { VideoLibraryService } from '../src/modules/video-library/video-library.service';

/**
 * Member đề xuất video → báo người duyệt: leader các team của member (chưa có team / team chưa có
 * leader → admin). Dán nhiều link một lúc thì gộp thành 1 thông báo chưa đọc, không đẩy push lặp.
 */
const MEMBER = 'member-1';

function build(opts: { teams?: Array<{ leader_id: string | null }>; admins?: string[]; recent?: any } = {}) {
  const pushes: any[] = [];
  const prisma: any = {
    team: { findMany: jest.fn(async () => opts.teams ?? []) },
    user: {
      findMany: jest.fn(async () => (opts.admins ?? []).map((id) => ({ id }))),
      findUnique: jest.fn(async () => ({ full_name: 'Nguyễn Thùy Linh', email: 'linh@x' })),
    },
    videoLibrary: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
    scraperVideoProposal: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    },
    notification: {
      findFirst: jest.fn(async () => opts.recent ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'n-new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'n-old', ...data })),
    },
  };
  const push: any = { sendToUser: jest.fn(async (userId: string, payload: any) => { pushes.push({ userId, ...payload }); }) };
  const ai: any = { fetchVideoDetail: jest.fn(async () => null) };
  const service = new VideoLibraryService(prisma, push, ai);
  return { service, prisma, pushes };
}

const dto = { video_id: '7644480763848772884', platform: 'tiktok', video_url: 'https://www.tiktok.com/@a/video/7644480763848772884', title: 'Em có 10 cuốn kim cương' };

describe('Báo người duyệt khi member đề xuất', () => {
  it('báo leader của team member (vào chuông + push kèm link tab Chờ duyệt)', async () => {
    const { service, prisma, pushes } = build({ teams: [{ leader_id: 'leader-1' }] });
    await service.proposeVideo(MEMBER, { ...dto } as any);
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: {
      user_id: 'leader-1', type: 'VIDEO_PROPOSAL_NEW', title: 'Nguyễn Thùy Linh đề xuất video mới',
      body: '"Em có 10 cuốn kim cương" đang chờ duyệt.', meta: { proposer_id: MEMBER, count: 1 },
    } });
    expect(pushes).toEqual([expect.objectContaining({ userId: 'leader-1', url: '/dashboard/video-library?tab=pending' })]);
  });

  it('member ở nhiều team → mỗi leader nhận 1 lần; member tự là leader thì không tự báo mình', async () => {
    const { service, prisma } = build({ teams: [{ leader_id: 'leader-1' }, { leader_id: 'leader-2' }, { leader_id: 'leader-1' }, { leader_id: MEMBER }] });
    await service.proposeVideo(MEMBER, { ...dto } as any);
    expect(prisma.notification.create.mock.calls.map((c: any) => c[0].data.user_id)).toEqual(['leader-1', 'leader-2']);
  });

  it('member chưa có team / team chưa có leader → báo admin', async () => {
    const { service, prisma } = build({ teams: [{ leader_id: null }], admins: ['admin-1', 'admin-2'] });
    await service.proposeVideo(MEMBER, { ...dto } as any);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ is_active: true, roles: { has: 'ADMIN' } });
    expect(prisma.notification.create.mock.calls.map((c: any) => c[0].data.user_id)).toEqual(['admin-1', 'admin-2']);
  });

  it('dán nhiều link liên tiếp → gộp vào thông báo chưa đọc gần đây, không đẩy push lần nữa', async () => {
    const recent = { id: 'n-old', meta: { proposer_id: MEMBER, count: 4 } };
    const { service, prisma, pushes } = build({ teams: [{ leader_id: 'leader-1' }], recent });
    await service.proposeVideo(MEMBER, { ...dto } as any);
    const where = prisma.notification.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ user_id: 'leader-1', type: 'VIDEO_PROPOSAL_NEW', is_read: false, meta: { path: ['proposer_id'], equals: MEMBER } });
    expect(Date.now() - where.created_at.gte.getTime()).toBeLessThanOrEqual(VideoLibraryService.PROPOSAL_NOTIFY_WINDOW_MS + 1000);
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n-old' }, data: expect.objectContaining({
      title: 'Nguyễn Thùy Linh đề xuất 5 video mới', meta: { proposer_id: MEMBER, count: 5 },
    }) });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(pushes).toEqual([]);
  });

  it('lỗi khi báo (DB) → đề xuất vẫn lưu và trả về bình thường', async () => {
    const { service, prisma } = build({ teams: [{ leader_id: 'leader-1' }] });
    prisma.notification.findFirst.mockRejectedValue(new Error('DB mất kết nối'));
    await expect(service.proposeVideo(MEMBER, { ...dto } as any)).resolves.toMatchObject({ id: 'p1' });
  });

  it('duyệt / từ chối → push cho member kèm link tab Đề xuất của tôi', async () => {
    const { service, prisma, pushes } = build();
    prisma.scraperVideoProposal.findUnique.mockResolvedValue({ id: 'p1', status: 'PENDING', requested_by_id: MEMBER, title: 'T', video_url: 'u' });
    await service.reviewProposal('p1', 'REJECTED', 'trùng nội dung', 'leader-1', 'Leader', ['LEADER']);
    await new Promise((r) => setImmediate(r));
    expect(pushes).toEqual([expect.objectContaining({ userId: MEMBER, title: 'Video đề xuất đã bị từ chối', url: '/dashboard/video-library?tab=mine' })]);
  });
});

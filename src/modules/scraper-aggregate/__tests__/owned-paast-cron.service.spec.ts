import { OwnedPaastCronService } from '../owned-paast-cron.service';

const USER = { id: 'u1' };

function buildService(over: { videos?: any[]; user?: any; scoreVideo?: any } = {}) {
  const prisma: any = {
    user: { findFirst: jest.fn(async () => ('user' in over ? over.user : USER)) },
    $queryRawUnsafe: jest.fn(async () => over.videos ?? []),
  };
  const script: any = {
    scoreVideo: over.scoreVideo ?? jest.fn(async () => ({ statusCode: 'da_cham' })),
  };
  return { service: new OwnedPaastCronService(prisma, script), prisma, script };
}

beforeEach(() => {
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0;
  }) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('subtitles-only mode execution', () => {
  it.each([
    ['scoreNewVideos', 'scoreNewVideos' as const],
    ['phuNguoc', 'phuNguoc' as const],
  ])('%s invokes scoreVideo with subtitlesOnly = true', async (_name, method) => {
    const { service, script } = buildService({ videos: [{ post_id: 'p1' }, { post_id: 'p2' }] });

    await service[method]();

    expect(script.scoreVideo).toHaveBeenCalledTimes(2);
    for (const call of script.scoreVideo.mock.calls) {
      expect(call).toEqual(['facebook', expect.any(String), 'u1', true]);
    }
  });
});

describe('scope and caps per batch execution', () => {
  it('scoreNewVideos queries last 3 days with a cap of 300', async () => {
    const { service, prisma } = buildService();
    await service.scoreNewVideos();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("v.published_at >= now() - interval '3 days'");
    expect(sql).toContain('LIMIT 300');
  });

  it('phuNguoc scans full catalog with a cap of 400', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('1 = 1');
    expect(sql).toContain('LIMIT 400');
  });

  it('skips videos with existing script records', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('owned_video_scripts');
  });

  it('only queries active pages with valid tokens', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('mp.is_active');
    expect(sql).toContain("mp.page_access_token <> ''");
  });
});

describe('early exit conditions', () => {
  it('aborts cleanly when no active user is available', async () => {
    const { service, script, prisma } = buildService({ user: null, videos: [{ post_id: 'p1' }] });

    await service.phuNguoc();

    expect(script.scoreVideo).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('finishes cleanly when no videos need scoring', async () => {
    const { service, script } = buildService({ videos: [] });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
    expect(script.scoreVideo).not.toHaveBeenCalled();
  });
});

describe('concurrency lock guards', () => {
  it('skips execution if previous run is still active', async () => {
    let releaseLock: () => void = () => undefined;
    const scoreVideo = jest.fn(
      () => new Promise((r) => (releaseLock = () => r({ statusCode: 'da_cham' }))),
    );
    const { service } = buildService({ videos: [{ post_id: 'p1' }], scoreVideo });

    const isRunning = service.phuNguoc();
    await service.scoreNewVideos();

    expect(scoreVideo).toHaveBeenCalledTimes(1);

    releaseLock();
    await isRunning;
  });

  it('releases lock when an error is thrown in query', async () => {
    const { service, prisma, script } = buildService({ videos: [{ post_id: 'p1' }] });
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Postgres connection lost'));

    await expect(service.phuNguoc()).rejects.toThrow('Postgres connection lost');

    await service.scoreNewVideos();
    expect(script.scoreVideo).toHaveBeenCalledTimes(1);
  });
});

describe('resilience to individual video errors', () => {
  it('continues processing subsequent videos when one fails', async () => {
    const scoreVideo = jest.fn(async (_p: string, postId: string) => {
      if (postId === 'p2') throw new Error('AI service 500');
      return { statusCode: 'da_cham' };
    });
    const { service } = buildService({
      videos: [{ post_id: 'p1' }, { post_id: 'p2' }, { post_id: 'p3' }],
      scoreVideo,
    });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
    expect(scoreVideo.mock.calls.map((c) => c[1])).toEqual(['p1', 'p2', 'p3']);
  });

  it('treats videos without subtitles as completed without throwing errors', async () => {
    const { service } = buildService({
      videos: [{ post_id: 'p1' }],
      scoreVideo: jest.fn(async () => ({ statusCode: 'chua_co_kich_ban' })),
    });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
  });
});

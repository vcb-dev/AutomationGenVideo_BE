import { OwnedPaastCronService } from '../owned-paast-cron.service';

/**
 * Cron tự chấm PAAST cho video kênh nội bộ.
 *
 * Ba thứ phải khoá lại, vì hỏng cái nào cũng tốn hạn mức thật chứ không chỉ sai kết quả:
 *   1. scoreVideo() luôn được gọi với chiPhuDe = true — đường Whisper đi qua RapidAPI, gói hiện
 *      tại chỉ 200 lượt/THÁNG, chạy nền hàng loạt là cháy sạch trong một đêm.
 *   2. Hai cron không được chạy đè nhau.
 *   3. Một video lỗi không được làm đứt cả lượt chạy.
 *
 * setTimeout bị thay để không phải chờ thật 1 giây mỗi video.
 */

const USER = { id: 'u1' };

function buildService(over: { videos?: any[]; user?: any; scoreVideo?: any } = {}) {
  const prisma: any = {
    user: { findFirst: jest.fn(async () => ('user' in over ? over.user : USER)) },
    $queryRawUnsafe: jest.fn(async () => over.videos ?? []),
  };
  const script: any = {
    scoreVideo: over.scoreVideo ?? jest.fn(async () => ({ trang_thai: 'da_cham' })),
  };
  return { service: new OwnedPaastCronService(prisma, script), prisma, script };
}

beforeEach(() => {
  // Bỏ nhịp nghỉ 1 giây giữa hai video — test không cần chờ thật.
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0;
  }) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('chỉ đi đường phụ đề', () => {
  /*
   * Chốt quan trọng nhất của cả file. `true` ở tham số thứ tư là "chỉ phụ đề, không Whisper".
   * Mất nó thì mỗi video tốn 1–4 lượt RapidAPI và một đêm là hết hạn mức tháng.
   */
  it.each([
    ['scoreNewVideos', 'scoreNewVideos' as const],
    ['phuNguoc', 'phuNguoc' as const],
  ])('%s gọi scoreVideo với chiPhuDe = true', async (_ten, ham) => {
    const { service, script } = buildService({ videos: [{ post_id: 'p1' }, { post_id: 'p2' }] });

    await service[ham]();

    expect(script.scoreVideo).toHaveBeenCalledTimes(2);
    for (const call of script.scoreVideo.mock.calls) {
      expect(call).toEqual(['facebook', expect.any(String), 'u1', true]);
    }
  });
});

describe('phạm vi và trần của mỗi lượt', () => {
  it('scoreNewVideos chỉ lấy video 3 ngày gần đây, trần 300', async () => {
    const { service, prisma } = buildService();
    await service.scoreNewVideos();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("v.published_at >= now() - interval '3 days'");
    expect(sql).toContain('LIMIT 300');
  });

  it('phuNguoc quét toàn kho, trần 400', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('1 = 1');
    expect(sql).toContain('LIMIT 400');
  });

  /*
   * Loại video ĐÃ CÓ bản ghi — kể cả bản ghi đánh dấu "không có phụ đề". Nhờ vậy chạy đi chạy
   * lại nhiều đêm là tự tiến chứ không giẫm chân lên cùng một nhóm video.
   */
  it('bỏ qua video đã có bản ghi kịch bản', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('owned_video_scripts');
  });

  it('chỉ lấy trang đang bật và còn token', async () => {
    const { service, prisma } = buildService();
    await service.phuNguoc();

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('mp.is_active');
    expect(sql).toContain("mp.page_access_token <> ''");
  });
});

describe('điều kiện dừng sớm', () => {
  it('không có user nào thì dừng, không đụng tới scoreVideo', async () => {
    const { service, script, prisma } = buildService({ user: null, videos: [{ post_id: 'p1' }] });

    await service.phuNguoc();

    expect(script.scoreVideo).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('không còn video nào cần chấm thì kết thúc êm', async () => {
    const { service, script } = buildService({ videos: [] });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
    expect(script.scoreVideo).not.toHaveBeenCalled();
  });
});

describe('khoá chống chạy đè', () => {
  /*
   * Hai cron (01:00 phủ ngược, 07:30 video mới) có thể chồng nhau khi lượt trước chạy quá lâu.
   * Chạy đè thì cùng một video bị chấm hai lần — tốn gấp đôi lượt LLM.
   */
  it('lượt trước chưa xong thì lượt sau bỏ qua', async () => {
    let thaChot: () => void = () => undefined;
    const scoreVideo = jest.fn(
      () => new Promise((r) => (thaChot = () => r({ trang_thai: 'da_cham' }))),
    );
    const { service } = buildService({ videos: [{ post_id: 'p1' }], scoreVideo });

    const isRunning = service.phuNguoc();
    await service.scoreNewVideos(); // chen vào giữa chừng

    expect(scoreVideo).toHaveBeenCalledTimes(1);

    thaChot();
    await isRunning;
  });

  /* Khoá phải nhả trong finally — lượt lỗi mà giữ khoá là cron chết vĩnh viễn tới lần restart. */
  it('lượt trước ném lỗi thì khoá vẫn nhả, lượt sau chạy được', async () => {
    const { service, prisma, script } = buildService({ videos: [{ post_id: 'p1' }] });
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Postgres đứt kết nối'));

    await expect(service.phuNguoc()).rejects.toThrow('Postgres đứt kết nối');

    await service.scoreNewVideos();
    expect(script.scoreVideo).toHaveBeenCalledTimes(1);
  });
});

describe('một video lỗi không làm đứt cả lượt', () => {
  it('vẫn chấm hết các video còn lại', async () => {
    const scoreVideo = jest.fn(async (_p: string, postId: string) => {
      if (postId === 'p2') throw new Error('AI service 500');
      return { trang_thai: 'da_cham' };
    });
    const { service } = buildService({
      videos: [{ post_id: 'p1' }, { post_id: 'p2' }, { post_id: 'p3' }],
      scoreVideo,
    });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
    expect(scoreVideo.mock.calls.map((c) => c[1])).toEqual(['p1', 'p2', 'p3']);
  });

  it('video không có phụ đề vẫn tính là xong, không ném lỗi', async () => {
    const { service } = buildService({
      videos: [{ post_id: 'p1' }],
      scoreVideo: jest.fn(async () => ({ trang_thai: 'chua_co_kich_ban' })),
    });

    await expect(service.phuNguoc()).resolves.toBeUndefined();
  });
});

import { WeeklyReportService, FullWeekVideoDetail } from '../weekly-report.service';
import { LarkSendError } from '../../lark-sync/lark-notify.service';
import { DEFAULT_VIEW_THRESHOLD } from '../select-full-week-videos';

const ABOVE_THRESHOLD = 1_200_000;
const BELOW_THRESHOLD = 5_000;

let dem = 0;
const video = (v: Partial<FullWeekVideoDetail> = {}): FullWeekVideoDetail => ({
  post_id: `p${++dem}`,
  ten_fanpage: 'Fanpage A',
  caption: 'nội dung',
  permalink_url: null,
  published_at: new Date('2026-07-30T00:00:00.000Z'),
  view_count: ABOVE_THRESHOLD,
  like_count: 10,
  comment_count: 1,
  share_count: 0,
  managed_page_id: 1n,
  page_access_token: 'tok',
  ...v,
});

interface Phu {
  videos?: FullWeekVideoDetail[];
  /** `null` = biến môi trường không được đặt. Không dùng `undefined` vì giá trị mặc định của
   *  destructuring sẽ ghi đè và nhánh "thiếu người nhận" không bao giờ chạy. */
  openId?: string | null;
  threshold?: string;
  sendMessage?: jest.Mock;
}

function buildService({ videos = [video()], openId = 'ou_nguoi_nhan', threshold, sendMessage }: Phu = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    ownedVideoWeeklyNotifyLog: { upsert, findMany: jest.fn().mockResolvedValue([]) },
    video_management_ownedvideocontent: { update: jest.fn(), findMany: jest.fn() },
  } as any;
  const aiClient = { fetchMetricsRefresh: jest.fn().mockResolvedValue({ metrics: {} }) } as any;
  const send = sendMessage ?? jest.fn().mockResolvedValue({ messageId: 'om_1' });
  const larkNotify = { sendMessage: send } as any;
  const configService = {
    get: (k: string) => {
      if (k === 'LARK_NOTIFY_OPEN_ID') return openId ?? undefined;
      if (k === 'WEEKLY_REPORT_VIEW_THRESHOLD') return threshold;
      return undefined;
    },
  } as any;

  const service = new WeeklyReportService(prisma, aiClient, larkNotify, configService);
  jest.spyOn(service, 'getFullWeekVideos').mockResolvedValue(videos);

  const record = (i: number) => upsert.mock.calls[i][0];
  return { service, upsert, send, record };
}

describe('ngưỡng view', () => {
  it('mặc định 1 triệu khi .env không đặt', () => {
    expect(buildService().service.viewThreshold).toBe(DEFAULT_VIEW_THRESHOLD);
  });

  it('đọc đè từ WEEKLY_REPORT_VIEW_THRESHOLD', () => {
    expect(buildService({ threshold: '500000' }).service.viewThreshold).toBe(500_000);
  });

  it('giá trị rác thì quay về mặc định, không để ngưỡng thành NaN rồi lọt hết video', () => {
    expect(buildService({ threshold: 'abc' }).service.viewThreshold).toBe(DEFAULT_VIEW_THRESHOLD);
    expect(buildService({ threshold: '-5' }).service.viewThreshold).toBe(DEFAULT_VIEW_THRESHOLD);
  });
});

describe('run — chỉ báo video vượt ngưỡng', () => {
  it('không video nào đạt thì KHÔNG gửi message nào', async () => {
    const { service, send } = buildService({ videos: [video({ view_count: BELOW_THRESHOLD })] });

    const result = await service.run(false);

    expect(result.videosAboveThreshold).toBe(0);
    expect(result.messageContent).toBeNull();
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('video dưới ngưỡng bị chốt duoi_nguong — ngày thứ 8 không xét lại', async () => {
    const { service, record } = buildService({ videos: [video({ view_count: BELOW_THRESHOLD })] });

    await service.run(false);

    expect(record(0).create.trang_thai).toBe('duoi_nguong');
  });

  it('chỉ ghi da_gui cho video ĐẠT ngưỡng, không ghi cho cả lô', async () => {
    const { service, upsert, send } = buildService({
      videos: [video({ view_count: ABOVE_THRESHOLD }), video({ view_count: BELOW_THRESHOLD }), video({ view_count: BELOW_THRESHOLD })],
    });

    const result = await service.run(false);

    expect(result.videosConsidered).toBe(3);
    expect(result.videosAboveThreshold).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    const status = upsert.mock.calls.map((c) => c[0].create.trang_thai);
    expect(status.filter((t) => t === 'duoi_nguong')).toHaveLength(2);
    expect(status.filter((t) => t === 'da_gui')).toHaveLength(1);
  });

  it('lô rỗng thì không gửi, không ghi nhật ký', async () => {
    const { service, upsert, send } = buildService({ videos: [] });

    const result = await service.run(false);

    expect(result.videosConsidered).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('run — chế độ khô', () => {
  it('dựng được message nhưng KHÔNG gửi và KHÔNG ghi nhật ký, kể cả bản ghi duoi_nguong', async () => {
    const { service, upsert, send } = buildService({
      videos: [video({ view_count: ABOVE_THRESHOLD }), video({ view_count: BELOW_THRESHOLD })],
    });

    const result = await service.run(true);

    expect(result.messageContent).toContain('view trong 7 ngày đầu');
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('run — không có người nhận', () => {
  it('thiếu LARK_NOTIFY_OPEN_ID thì ghi khong_co_nguoi_nhan, KHÔNG ném lỗi làm chết cron', async () => {
    const { service, upsert, send } = buildService({ openId: null });

    const result = await service.run(false);

    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const status = upsert.mock.calls.map((c) => c[0].create.trang_thai);
    expect(status).toContain('khong_co_nguoi_nhan');
  });
});

describe('run — xử lý lỗi gửi', () => {
  it('lỗi tạm thì ghi loi và tăng so_lan_thu để lượt sau thử lại', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new LarkSendError('ECONNRESET', -1, false));
    const { service, record } = buildService({ sendMessage });

    const result = await service.run(false);

    expect(result.sent).toBe(false);
    expect(record(0).create.trang_thai).toBe('loi');
    expect(record(0).update.so_lan_thu).toEqual({ increment: 1 });
  });

  it('lỗi chết thì chốt luôn, không để cron thử lại vô ích 3 lượt', async () => {
    const sendMessage = jest.fn().mockRejectedValue(
      new LarkSendError('Bot has NO availability to this user', 230013, true),
    );
    const { service, record } = buildService({ sendMessage });

    await service.run(false);

    expect(record(0).create.so_lan_thu).toBeGreaterThanOrEqual(3);
    expect(record(0).update.so_lan_thu).toBeGreaterThanOrEqual(3);
  });

  it('gửi hỏng vẫn trả về kết quả kèm lý do, không ném ra ngoài', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new LarkSendError('lỗi lạ', 50000, false));
    const { service } = buildService({ sendMessage });

    await expect(service.run(false)).resolves.toMatchObject({ sent: false });
  });
});

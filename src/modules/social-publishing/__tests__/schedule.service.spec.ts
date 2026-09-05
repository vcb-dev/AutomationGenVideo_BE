import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { SocialPostStatus, SocialPostSource } from '@prisma/client';
import { ScheduleService, CLAIM_LEASE_MS } from '../schedule/schedule.service';

/**
 * Trọng tâm: hạn giữ chỗ (`claimed_until`) phải tách bạch với mốc chạy lại
 * (`next_retry_at`). Gộp chung hai vai trò vào một cột đã gây ra 3 lỗi cùng lúc:
 * đăng trùng bài khi job chạy lâu hơn lease, bài chờ retry ăn slot đồng thời của
 * cả platform lẫn account, và người dùng không sửa/huỷ được bài vừa đăng lỗi.
 */

type PostRow = Record<string, any>;

function createPrismaMock(posts: PostRow[] = []) {
  return {
    isHealthy: true,
    markUnhealthy: jest.fn(),
    socialPost: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue(posts),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    socialAccount: { findFirst: jest.fn(), findUnique: jest.fn() },
    task: { findUnique: jest.fn() },
  };
}

function createService(prisma: any) {
  const publishService = {
    executeScheduled: jest.fn().mockResolvedValue({ postId: 'fb_1' }),
    preWarmDownloads: jest.fn(),
    archiveMediaAsync: jest.fn().mockResolvedValue(undefined),
  };
  const history = { getFailedPostAudience: jest.fn().mockResolvedValue([]) };
  const notifyStream = { emitMany: jest.fn() };
  const service = new ScheduleService(
    prisma as any,
    publishService as any,
    history as any,
    notifyStream as any,
  );
  return { service, publishService, history, notifyStream };
}

const basePost = (over: PostRow = {}): PostRow => ({
  id: 'p1',
  user_id: 'u1',
  account_id: 'acc1',
  platform: 'FACEBOOK',
  media_urls: [],
  retry_count: 0,
  next_retry_at: null,
  claimed_until: null,
  result: null,
  ...over,
});

describe('ScheduleService — giữ chỗ và chạy lại', () => {
  afterEach(() => jest.useRealTimers());

  describe('_claimDuePosts', () => {
    it('chỉ đếm bài đang xử lý qua claimed_until, không đụng next_retry_at', async () => {
      const prisma = createPrismaMock([]);
      const { service } = createService(prisma);

      await (service as any)._claimDuePosts(5);

      // Hồi quy: trước đây lọc next_retry_at ∈ (now, now+40'] nên MỌI bài đang chờ
      // backoff (5 và 15 phút) đều bị đếm nhầm là đang chạy.
      for (const call of prisma.socialPost.groupBy.mock.calls) {
        expect(call[0].where).toHaveProperty('claimed_until');
        expect(call[0].where).not.toHaveProperty('next_retry_at');
      }
    });

    it('bỏ qua bài đang được worker khác giữ chỗ', async () => {
      const prisma = createPrismaMock([]);
      const { service } = createService(prisma);

      await (service as any)._claimDuePosts(5);

      const where = prisma.socialPost.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { OR: [{ claimed_until: null }, { claimed_until: expect.objectContaining({ lte: expect.any(Date) }) }] },
        ]),
      );
    });

    it('loại account đã kín slot ngay trong truy vấn thay vì lọc sau', async () => {
      const prisma = createPrismaMock([]);
      // acc_busy đang có 1 bài chạy → với ACCOUNT_CONCURRENCY=1 là đã kín
      prisma.socialPost.groupBy
        .mockResolvedValueOnce([{ platform: 'FACEBOOK', _count: { platform: 1 } }])
        .mockResolvedValueOnce([{ account_id: 'acc_busy', _count: { account_id: 1 } }]);
      const { service } = createService(prisma);

      await (service as any)._claimDuePosts(5);

      // Nếu không loại từ truy vấn, một hàng chờ dài của acc_busy sẽ chiếm hết 50 bản
      // ghi lấy về và bài của kênh đang rảnh xếp sau không bao giờ được xét.
      const where = prisma.socialPost.findMany.mock.calls[0][0].where;
      expect(where.account_id).toEqual({ notIn: ['acc_busy'] });
    });

    it('không thêm điều kiện account khi chưa kênh nào kín slot', async () => {
      const prisma = createPrismaMock([]);
      const { service } = createService(prisma);

      await (service as any)._claimDuePosts(5);

      expect(prisma.socialPost.findMany.mock.calls[0][0].where).not.toHaveProperty('account_id');
    });

    it('giành chỗ bằng claimed_until để 2 tiến trình không cùng nhận một bài', async () => {
      const prisma = createPrismaMock([basePost()]);
      const { service } = createService(prisma);

      const claimed = await (service as any)._claimDuePosts(5);

      const claimCall = prisma.socialPost.updateMany.mock.calls[0][0];
      expect(claimCall.where).toMatchObject({ id: 'p1', status: SocialPostStatus.PENDING });
      expect(claimCall.where.OR).toEqual([
        { claimed_until: null },
        { claimed_until: expect.objectContaining({ lte: expect.any(Date) }) },
      ]);
      expect(claimCall.data.claimed_until.getTime()).toBeGreaterThan(Date.now());
      expect(claimed).toHaveLength(1);
    });

    it('không trả về bài khi tiến trình khác giành được trước (count = 0)', async () => {
      const prisma = createPrismaMock([basePost()]);
      prisma.socialPost.updateMany.mockResolvedValue({ count: 0 });
      const { service } = createService(prisma);

      expect(await (service as any)._claimDuePosts(5)).toEqual([]);
    });
  });

  describe('executePost — nhả chỗ giữ trên mọi nhánh thoát', () => {
    it('đăng thành công thì xoá claimed_until', async () => {
      const prisma = createPrismaMock();
      const { service } = createService(prisma);

      await (service as any).executePost(basePost());

      const completed = prisma.socialPost.updateMany.mock.calls
        .map((c: any[]) => c[0].data)
        .find((d: any) => d.status === SocialPostStatus.COMPLETED);
      expect(completed).toMatchObject({ claimed_until: null, next_retry_at: null });
    });

    it('đăng lỗi lần đầu thì hẹn chạy lại VÀ nhả chỗ giữ', async () => {
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);
      publishService.executeScheduled.mockRejectedValue(new Error('Meta 400'));

      await (service as any).executePost(basePost({ retry_count: 0 }));

      const data = prisma.socialPost.updateMany.mock.calls.at(-1)![0].data;
      expect(data.next_retry_at.getTime()).toBeGreaterThan(Date.now());
      // Không nhả chỗ thì bài chỉ nằm chờ vẫn khoá slot của cả kênh suốt 5-15 phút.
      expect(data.claimed_until).toBeNull();
    });

    it('hết lượt thử thì chuyển FAILED và nhả chỗ giữ', async () => {
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);
      publishService.executeScheduled.mockRejectedValue(new Error('Meta 400'));

      await (service as any).executePost(basePost({ retry_count: 2 }));

      const data = prisma.socialPost.updateMany.mock.calls.at(-1)![0].data;
      expect(data).toMatchObject({
        status: SocialPostStatus.FAILED,
        claimed_until: null,
        next_retry_at: null,
      });
    });

    it('lỗi vĩnh viễn thì FAILED ngay ở lượt đầu, không hẹn chạy lại', async () => {
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);
      publishService.executeScheduled.mockRejectedValue(
        new Error(
          'Instagram createContainer (HTTP 400): {"error":{"message":"The image format is not supported.",' +
          '"code":36001,"error_subcode":2207083,"is_transient":false}}',
        ),
      );

      await (service as any).executePost(basePost({ retry_count: 0 }));

      // Thử thêm 2 lượt chỉ tốn ~20 phút và khoá kênh đó, trong khi Meta đã báo rõ
      // is_transient=false — lỗi không bao giờ tự khỏi.
      const data = prisma.socialPost.updateMany.mock.calls.at(-1)![0].data;
      expect(data).toMatchObject({
        status: SocialPostStatus.FAILED,
        retry_count: 1,
        next_retry_at: null,
        claimed_until: null,
      });
    });

    it('lỗi tạm thời vẫn được hẹn chạy lại như cũ', async () => {
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);
      publishService.executeScheduled.mockRejectedValue(new Error('{"error":{"code":613}}'));

      await (service as any).executePost(basePost({ retry_count: 0 }));

      const data = prisma.socialPost.updateMany.mock.calls.at(-1)![0].data;
      expect(data.status).toBeUndefined(); // chưa chuyển FAILED
      expect(data.next_retry_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('bài đã có result thì đánh dấu hoàn thành, không đăng lại', async () => {
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);

      await (service as any).executePost(basePost({ result: { postId: 'fb_da_dang' } }));

      expect(publishService.executeScheduled).not.toHaveBeenCalled();
      expect(prisma.socialPost.updateMany.mock.calls[0][0].data).toMatchObject({
        status: SocialPostStatus.COMPLETED,
        claimed_until: null,
      });
    });
  });

  describe('heartbeat giữ chỗ', () => {
    it('gia hạn định kỳ trong lúc đăng rồi dừng khi xong', async () => {
      jest.useFakeTimers();
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);

      // Mô phỏng job dài hơn một chu kỳ heartbeat (video lớn: tải Drive + transcode + upload)
      let finishPublish!: () => void;
      publishService.executeScheduled.mockReturnValue(
        new Promise<any>((resolve) => { finishPublish = () => resolve({ postId: 'fb_1' }); }),
      );

      const running = (service as any).executePost(basePost());

      await jest.advanceTimersByTimeAsync(3 * 60 * 1000);

      const renewals = prisma.socialPost.updateMany.mock.calls.filter(
        (c: any[]) => c[0].data.claimed_until instanceof Date,
      );
      // Không có heartbeat, lease hết hạn giữa chừng → worker khác nhận lại bài
      // trong khi lượt đầu vẫn đang upload → bài lên mạng xã hội 2 lần.
      expect(renewals.length).toBeGreaterThanOrEqual(3);
      expect(renewals[0][0].where).toMatchObject({ id: 'p1', status: SocialPostStatus.PENDING });
      expect(renewals[0][0].data.claimed_until.getTime()).toBeGreaterThan(Date.now());

      finishPublish();
      await running;

      const countAfterFinish = prisma.socialPost.updateMany.mock.calls.length;
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(prisma.socialPost.updateMany.mock.calls.length).toBe(countAfterFinish);
    });

    it('dừng heartbeat cả khi đăng lỗi', async () => {
      jest.useFakeTimers();
      const prisma = createPrismaMock();
      const { service, publishService } = createService(prisma);
      publishService.executeScheduled.mockRejectedValue(new Error('Meta 400'));

      await (service as any).executePost(basePost());
      const countAfterFinish = prisma.socialPost.updateMany.mock.calls.length;

      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(prisma.socialPost.updateMany.mock.calls.length).toBe(countAfterFinish);
    });

    it('hạn giữ chỗ đủ dài so với nhịp gia hạn để chịu được một lần lỗi mạng', () => {
      expect(CLAIM_LEASE_MS).toBeGreaterThanOrEqual(3 * 60 * 1000);
    });
  });

  describe('update / cancel khi bài đang chờ chạy lại', () => {
    it('update chỉ chặn theo claimed_until, không chặn theo next_retry_at', async () => {
      const prisma = createPrismaMock();
      prisma.socialPost.findFirst.mockResolvedValue(basePost());
      const { service } = createService(prisma);

      await service.update('p1', 'u1', { message: 'sua caption' });

      // Người dùng cần sửa nội dung ngay sau khi đăng lỗi — đúng lúc bài đang backoff.
      const where = prisma.socialPost.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { claimed_until: null },
        { claimed_until: expect.objectContaining({ lte: expect.any(Date) }) },
      ]);
      expect(where).not.toHaveProperty('next_retry_at');
    });

    it('cancel cũng chỉ chặn theo claimed_until', async () => {
      const prisma = createPrismaMock();
      prisma.socialPost.findFirst.mockResolvedValue(basePost());
      const { service } = createService(prisma);

      await service.cancel('p1', 'u1');

      const where = prisma.socialPost.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { claimed_until: null },
        { claimed_until: expect.objectContaining({ lte: expect.any(Date) }) },
      ]);
    });

    it('vẫn chặn khi worker đang thực sự xử lý', async () => {
      const prisma = createPrismaMock();
      prisma.socialPost.findFirst.mockResolvedValue(null); // không khớp điều kiện = đang chạy
      const { service } = createService(prisma);

      await expect(service.cancel('p1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('retry thủ công', () => {
    it('xếp chạy ngay và đánh thức worker, không hoãn 5 phút', async () => {
      const prisma = createPrismaMock();
      prisma.socialPost.findFirst.mockResolvedValue(basePost({ status: SocialPostStatus.FAILED }));
      const { service } = createService(prisma);
      const triggerNow = jest.spyOn(service, 'triggerNow').mockImplementation(() => {});

      await service.retry('p1', 'u1');

      const data = prisma.socialPost.update.mock.calls[0][0].data;
      expect(data.scheduled_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect(data).toMatchObject({
        status: SocialPostStatus.PENDING,
        retry_count: 0,
        next_retry_at: null,
        claimed_until: null,
      });
      expect(triggerNow).toHaveBeenCalled();
    });

    it('từ chối bài chưa ở trạng thái FAILED', async () => {
      const prisma = createPrismaMock();
      prisma.socialPost.findFirst.mockResolvedValue(null);
      const { service } = createService(prisma);

      await expect(service.retry('p1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cleanupOrphanFiles — chỉ đụng file tạm', () => {
    let uploadDir: string;
    const previousUploadDir = process.env.SOCIAL_UPLOAD_DIR;
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

    const writeAged = (name: string) => {
      const filePath = path.join(uploadDir, name);
      fs.writeFileSync(filePath, 'x');
      fs.utimesSync(filePath, new Date(threeHoursAgo), new Date(threeHoursAgo));
      return filePath;
    };

    beforeEach(() => {
      uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-upload-'));
      process.env.SOCIAL_UPLOAD_DIR = uploadDir;
    });

    afterEach(() => {
      fs.rmSync(uploadDir, { recursive: true, force: true });
      if (previousUploadDir === undefined) delete process.env.SOCIAL_UPLOAD_DIR;
      else process.env.SOCIAL_UPLOAD_DIR = previousUploadDir;
    });

    it('xoá file tạm quá hạn do luồng đăng bài sinh ra', async () => {
      const files = ['gd_1_abc_FILEID.mp4', 'tc_1_video.mp4', 'tmp_1_x_anh.jpg'].map(writeAged);
      const { service } = createService(createPrismaMock());

      await service.cleanupOrphanFiles();

      for (const filePath of files) expect(fs.existsSync(filePath)).toBe(false);
    });

    it('KHÔNG xoá media gốc của người dùng', async () => {
      // Khi Google Drive chưa cấu hình, UploadService lưu file gốc vào chính thư mục
      // này với tên thật và media_urls trỏ vào đó. Quét sạch theo tuổi sẽ làm bài lên
      // lịch đăng sau hơn 2 giờ mất file → đăng lỗi 3 lần rồi FAILED.
      const userMedia = ['video khach hang.mp4', 'anh bia.jpg', 'Ky vang 2026.png'].map(writeAged);
      const { service } = createService(createPrismaMock());

      await service.cleanupOrphanFiles();

      for (const filePath of userMedia) expect(fs.existsSync(filePath)).toBe(true);
    });

    it('giữ lại file tạm còn mới', async () => {
      const fresh = path.join(uploadDir, 'gd_moi_tai.mp4');
      fs.writeFileSync(fresh, 'x');
      const { service } = createService(createPrismaMock());

      await service.cleanupOrphanFiles();

      expect(fs.existsSync(fresh)).toBe(true);
    });

    it('không vỡ khi thư mục upload chưa tồn tại', async () => {
      process.env.SOCIAL_UPLOAD_DIR = path.join(uploadDir, 'chua-co');
      const { service } = createService(createPrismaMock());

      await expect(service.cleanupOrphanFiles()).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('từ chối mốc thời gian trong quá khứ', async () => {
      const prisma = createPrismaMock();
      prisma.socialAccount.findFirst.mockResolvedValue({ id: 'acc1', platform: 'FACEBOOK' });
      const { service } = createService(prisma);

      await expect(
        service.create('u1', {
          accountId: 'acc1',
          message: 'hi',
          scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).rejects.toThrow(/tương lai/);
    });

    it('tạo bài ở trạng thái PENDING với nguồn SCHEDULED', async () => {
      const prisma = createPrismaMock();
      prisma.socialAccount.findFirst.mockResolvedValue({ id: 'acc1', platform: 'FACEBOOK' });
      prisma.socialPost.create.mockResolvedValue({ id: 'new' });
      const { service } = createService(prisma);

      await service.create('u1', {
        accountId: 'acc1',
        message: 'hi',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      });

      expect(prisma.socialPost.create.mock.calls[0][0].data).toMatchObject({
        status: SocialPostStatus.PENDING,
        source: SocialPostSource.SCHEDULED,
      });
    });
  });
});

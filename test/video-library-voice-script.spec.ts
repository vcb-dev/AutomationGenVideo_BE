import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { VideoLibraryService } from '../src/modules/video-library/video-library.service';
import { AiIntegrationService } from '../src/modules/ai-integration/ai-integration.service';

/**
 * Bộ Sưu Tập — kịch bản từ lời thoại + hình ảnh của video (Gemini), chạy nền sau khi duyệt:
 *  - duyệt xong có ngay dòng Content PROCESSING, kịch bản điền sau;
 *  - AI trả DONE → lưu kịch bản Gemini + lời thoại gốc;
 *  - Gemini chưa bật / AI lỗi → quay về cách cũ (tiêu đề + mô tả);
 *  - hỏng hết → FAILED kèm lý do, bấm "Thử lại" sinh lại được.
 */
const video = {
  video_id: '7676122785118164474',
  platform: 'douyin',
  title: 'Cách làm sạch trang sức vàng',
  description: 'Mẹo tại nhà',
  video_url: 'https://www.douyin.com/video/7676122785118164474',
  author_username: 'a',
  author_name: 'A',
};

function build() {
  const contentRows: any[] = [];
  const prisma: any = {
    notification: { create: jest.fn(async () => ({})) },
    team: { findMany: jest.fn(async () => [{ id: 't1' }]) },
    videoLibraryTeam: { createMany: jest.fn(async () => ({ count: 1 })) },
    videoLibrary: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'lib1', ...data })),
    },
    approvedContent: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `c${contentRows.length + 1}`, updated_at: new Date(), ...data };
        contentRows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = contentRows.find((r) => r.id === where.id);
        Object.assign(row, data, { updated_at: new Date() });
        return { ...row }; // như Prisma: trả bản chụp lúc ghi, không phải tham chiếu sống
      }),
      updateMany: jest.fn(async () => ({ count: 2 })),
      findUnique: jest.fn(async ({ where }: any) => contentRows.find((r) => r.id === where.id) ?? null),
    },
  };
  const aiIntegration: any = {
    fetchVideoDetail: jest.fn(async () => null),
    generateScriptFromVideo: jest.fn(async () => ({ status: 'ENGINE_DISABLED', download: { ok: true, source: 'free' } })),
    analyzeScrapedVideo: jest.fn(async () => ({ vietnamese_content: 'Kịch bản cách cũ', script_outline: 'Dàn ý', hashtags: [] })),
  };
  const service = new VideoLibraryService(prisma, { sendToUser: jest.fn(async () => {}) } as any, aiIntegration);
  return { service, prisma, aiIntegration, contentRows };
}

async function approveDirect(service: VideoLibraryService) {
  const res = await service.addVideoDirectly('leader1', 'Leader', ['LEADER'], { ...video } as any);
  await service.waitForPendingScripts();
  return res;
}

describe('Kịch bản từ video — chạy nền sau khi duyệt', () => {
  it('gửi đúng link/nền tảng/mã video/tiêu đề sang AI, ký theo người duyệt', async () => {
    const { service, aiIntegration } = build();
    await approveDirect(service);
    expect(aiIntegration.generateScriptFromVideo).toHaveBeenCalledWith(
      {
        videoUrl: video.video_url,
        platform: 'douyin',
        videoId: video.video_id,
        title: video.title,
        description: video.description,
      },
      { id: 'leader1' },
    );
  });

  it('AI trả DONE (Gemini xem video) → lưu kịch bản + lời thoại gốc, không gọi cách cũ', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockResolvedValue({
      status: 'DONE',
      source: 'gemini_video',
      script_text: '【HOOK】\nVàng xỉn màu? Làm thế này!',
      transcript: '家里的金首饰时间久了氧化发黑',
      language: 'zh',
      has_voice: true,
      download: { ok: true, source: 'tikhub' },
    });

    const res = await approveDirect(service);

    expect(res.approvedContentId).toBe('c1');
    expect(contentRows[0]).toMatchObject({
      script_status: 'DONE',
      script_source: 'GEMINI_VIDEO',
      script: '【HOOK】\nVàng xỉn màu? Làm thế này!',
      transcript: '家里的金首饰时间久了氧化发黑',
      transcript_language: 'zh',
      has_voice: true,
      download_source: 'tikhub',
      script_error: null,
    });
    expect(aiIntegration.analyzeScrapedVideo).not.toHaveBeenCalled();
  });

  it('tải video hỏng, Gemini viết từ tiêu đề → nguồn GEMINI_TEXT, không có voice', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockResolvedValue({
      status: 'DONE', source: 'gemini_text', script_text: 'Kịch bản', transcript: '', has_voice: false,
      download: { ok: false, error: 'tải miễn phí: chặn; TikHub: hết tiền' },
    });
    await approveDirect(service);
    expect(contentRows[0]).toMatchObject({ script_source: 'GEMINI_TEXT', has_voice: false, download_source: null, transcript: null });
  });

  it('Gemini chưa bật (ENGINE_DISABLED) → cách cũ, vẫn ghi lại video tải bằng đường nào', async () => {
    const { service, contentRows } = build();
    await approveDirect(service);
    expect(contentRows[0]).toMatchObject({
      script_status: 'DONE',
      script_source: 'LEGACY_TEXT',
      download_source: 'free',
      script_error: null,
    });
    expect(contentRows[0].script).toContain('Kịch bản cách cũ');
  });

  it('Gemini tắt vì thiếu khoá video→text + cách cũ hỏng → FAILED nêu đúng khoá thiếu', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockResolvedValue({
      status: 'ENGINE_DISABLED',
      reason: 'Chưa cấu hình GEMINI_API_KEY trên AI Service nên chưa viết được kịch bản từ voice.',
      download: { ok: true, source: 'free' },
    });
    aiIntegration.analyzeScrapedVideo.mockRejectedValue(new Error('DEEPSEEK_API_KEY chưa được cấu hình'));
    await approveDirect(service);
    expect(contentRows[0].script_status).toBe('FAILED');
    expect(contentRows[0].script_error).toBe(
      'Chưa cấu hình GEMINI_API_KEY trên AI Service nên chưa viết được kịch bản từ voice. | DEEPSEEK_API_KEY chưa được cấu hình',
    );
  });

  it('Gemini tắt vì thiếu khoá nhưng cách cũ chạy → DONE, vẫn ghi lý do để tra cứu', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockResolvedValue({
      status: 'ENGINE_DISABLED', reason: 'Chưa cấu hình GEMINI_API_KEY', download: { ok: true, source: 'free' },
    });
    await approveDirect(service);
    expect(contentRows[0]).toMatchObject({
      script_status: 'DONE', script_source: 'LEGACY_TEXT', script_error: 'Chưa cấu hình GEMINI_API_KEY',
    });
  });

  it('AI lỗi → cách cũ vẫn chạy, giữ lại lý do lỗi AI để tra cứu', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockResolvedValue({ status: 'FAILED', error: 'Gemini: quota' });
    await approveDirect(service);
    expect(contentRows[0]).toMatchObject({ script_status: 'DONE', script_source: 'LEGACY_TEXT', script_error: 'Gemini: quota' });
  });

  it('AI lẫn cách cũ đều hỏng → FAILED kèm cả hai lý do, không ném ra ngoài', async () => {
    const { service, aiIntegration, contentRows } = build();
    aiIntegration.generateScriptFromVideo.mockRejectedValue(new Error('AI sập'));
    aiIntegration.analyzeScrapedVideo.mockRejectedValue(new Error('DEEPSEEK_API_KEY chưa được cấu hình'));
    await expect(approveDirect(service)).resolves.toBeDefined();
    expect(contentRows[0].script_status).toBe('FAILED');
    expect(contentRows[0].script_error).toBe('AI sập | DEEPSEEK_API_KEY chưa được cấu hình');
  });

  it('ghi FAILED cũng lỗi → chỉ log, không làm sập tiến trình', async () => {
    const { service, prisma, aiIntegration } = build();
    aiIntegration.generateScriptFromVideo.mockRejectedValue(new Error('x'));
    aiIntegration.analyzeScrapedVideo.mockRejectedValue(new Error('y'));
    prisma.approvedContent.update.mockImplementation(() => { throw new Error('DB mất kết nối'); });
    await expect(approveDirect(service)).resolves.toBeDefined();
  });
});

describe('Thử lại kịch bản (regenerateScript)', () => {
  async function withFailedContent() {
    const ctx = build();
    ctx.aiIntegration.generateScriptFromVideo.mockResolvedValueOnce({ status: 'FAILED', error: 'a' });
    ctx.aiIntegration.analyzeScrapedVideo.mockRejectedValueOnce(new Error('b'));
    await approveDirect(ctx.service);
    expect(ctx.contentRows[0].script_status).toBe('FAILED');
    return ctx;
  }

  it('MEMBER không được thử lại', async () => {
    const { service } = await withFailedContent();
    await expect(service.regenerateScript('c1', { id: 'm1' }, ['MEMBER'])).rejects.toThrow(ForbiddenException);
  });

  it('không tìm thấy content → 404', async () => {
    const { service } = build();
    await expect(service.regenerateScript('nope', { id: 'l1' }, ['LEADER'])).rejects.toThrow(NotFoundException);
  });

  it('thử lại → PROCESSING rồi sinh lại bằng thông tin video đã lưu', async () => {
    const { service, aiIntegration, contentRows } = await withFailedContent();
    aiIntegration.generateScriptFromVideo.mockResolvedValueOnce({
      status: 'DONE', source: 'gemini_video', script_text: 'Mới', transcript: 't', has_voice: true, download: { ok: true, source: 'free' },
    });

    const updated = await service.regenerateScript('c1', { id: 'manager1', email: 'm@x' }, ['MANAGER']);
    expect(updated.script_status).toBe('PROCESSING');
    await service.waitForPendingScripts();

    expect(contentRows[0]).toMatchObject({ script_status: 'DONE', script: 'Mới', script_error: null });
    expect(aiIntegration.generateScriptFromVideo).toHaveBeenLastCalledWith(
      expect.objectContaining({ videoUrl: video.video_url, platform: 'douyin', videoId: video.video_id }),
      { id: 'manager1', email: 'm@x' },
    );
  });

  it('đang xử lý (chưa quá hạn) → 409, không chạy trùng', async () => {
    const { service, contentRows } = await withFailedContent();
    contentRows[0].script_status = 'PROCESSING';
    contentRows[0].updated_at = new Date();
    await expect(service.regenerateScript('c1', { id: 'l1' }, ['LEADER'])).rejects.toThrow(ConflictException);
  });

  it('kẹt PROCESSING quá hạn (server khởi động lại) → cho thử lại', async () => {
    const { service, contentRows } = await withFailedContent();
    contentRows[0].script_status = 'PROCESSING';
    contentRows[0].updated_at = new Date(Date.now() - VideoLibraryService.STALE_PROCESSING_MS - 1000);
    await expect(service.regenerateScript('c1', { id: 'l1' }, ['LEADER'])).resolves.toMatchObject({ script_status: 'PROCESSING' });
    await service.waitForPendingScripts();
  });

  it('lúc khởi động chuyển content kẹt quá hạn sang FAILED', async () => {
    const { service, prisma } = build();
    await service.onModuleInit();
    const arg = prisma.approvedContent.updateMany.mock.calls[0][0];
    expect(arg.where.script_status).toBe('PROCESSING');
    expect(Date.now() - arg.where.updated_at.lt.getTime()).toBeGreaterThanOrEqual(VideoLibraryService.STALE_PROCESSING_MS - 1000);
    expect(arg.data.script_status).toBe('FAILED');
  });
});

describe('AiIntegrationService.generateScriptFromVideo', () => {
  function buildAi(post: jest.Mock) {
    const ai: any = Object.create(AiIntegrationService.prototype);
    ai.aiServiceUrl = 'http://ai.local';
    ai.httpService = { post };
    ai.jwtService = { sign: jest.fn(() => 'signed-token') };
    ai.logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    return ai as AiIntegrationService;
  }

  it('gọi đúng endpoint, gửi token nội bộ theo người duyệt, timeout dài', async () => {
    const post = jest.fn(() => of({ data: { status: 'ENGINE_DISABLED', download: { ok: true } } }));
    const res = await buildAi(post).generateScriptFromVideo({ videoUrl: 'https://v', platform: 'douyin', videoId: '1' }, { id: 'l1' });
    expect(res.status).toBe('ENGINE_DISABLED');
    const [url, body, opts] = post.mock.calls[0] as any[];
    expect(url).toBe('http://ai.local/api/scraped-video/script-from-video/');
    expect(body).toMatchObject({ video_url: 'https://v', platform: 'douyin', video_id: '1' });
    expect(opts.headers.Authorization).toBe('Bearer signed-token');
    expect(opts.timeout).toBeGreaterThanOrEqual(600_000);
  });

  it('AI trả lỗi HTTP → trả FAILED kèm lý do, không ném', async () => {
    const post = jest.fn(() => throwError(() => ({ message: 'Request failed with status code 502', response: { data: { error: 'Gemini: quota', download: { ok: true } } } })));
    const res = await buildAi(post).generateScriptFromVideo({ videoUrl: 'https://v' });
    expect(res).toEqual({ status: 'FAILED', error: 'Gemini: quota', download: { ok: true } });
  });
});

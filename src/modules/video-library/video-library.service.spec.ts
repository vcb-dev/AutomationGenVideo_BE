import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VideoLibraryService } from './video-library.service';

/**
 * Hoàn thiện tính năng "Bộ Sưu Tập" — hàng đợi đề xuất (ScraperVideoProposal,
 * mirror TeamPushRequest) → duyệt → VideoLibrary + tự sinh ApprovedContent qua AI.
 * Business rule quan trọng nhất: LEADER duyệt → tab Team, ADMIN duyệt → tab
 * Chung (khớp quyền xoá đã code sẵn ở FE video-library/page.tsx); lỗi AI KHÔNG
 * rollback VideoLibrary vì ApprovedContent.script bắt buộc non-null.
 */
function buildVideo(overrides: Partial<any> = {}) {
  return {
    video_id: 'v1',
    platform: 'tiktok',
    title: 'Video gốc',
    description: 'Mô tả gốc',
    video_url: 'https://tiktok.com/@a/video/1',
    author_username: 'author_a',
    author_name: 'Author A',
    thumbnail_url: null,
    views_count: 1000n,
    likes_count: 100n,
    comments_count: 10n,
    shares_count: 5n,
    ...overrides,
  };
}

describe('VideoLibraryService.reviewProposal / addVideoDirectly — approveIntoLibrary', () => {
  function build() {
    const videoLibraryRows: any[] = [];
    const approvedContentRows: any[] = [];
    const prisma: any = {
      notification: { create: jest.fn(async () => ({})) },
      scraperVideoProposal: {
        findUnique: jest.fn(),
        update: jest.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
      },
      videoLibrary: {
        findUnique: jest.fn(async () => null), // mặc định: chưa tồn tại, luôn tạo mới
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `lib-${videoLibraryRows.length + 1}`, ...data };
          videoLibraryRows.push(row);
          return row;
        }),
        delete: jest.fn(async () => ({})),
      },
      approvedContent: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `content-${approvedContentRows.length + 1}`, ...data };
          approvedContentRows.push(row);
          return row;
        }),
        delete: jest.fn(async () => ({})),
      },
    };
    const push: any = { sendToUser: jest.fn(async () => {}) };
    const aiIntegration: any = {
      analyzeScrapedVideo: jest.fn(async () => ({
        vietnamese_content: 'Nội dung tiếng Việt',
        script_outline: 'Hook - thân - CTA',
        hashtags: ['#a'],
      })),
      // Mặc định: không lấy được chi tiết → giữ nguyên dữ liệu caller gửi lên.
      // Test nào cần kiểm tra bước làm giàu thì tự mockResolvedValueOnce.
      fetchVideoDetail: jest.fn(async () => null),
    };
    const service = new VideoLibraryService(prisma, push, aiIntegration);
    return { service, prisma, aiIntegration, videoLibraryRows, approvedContentRows };
  }

  afterEach(() => jest.clearAllMocks());

  it('LEADER duyệt → video vào collection_type TEAM', async () => {
    const { service, videoLibraryRows } = build();
    await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);

    expect(videoLibraryRows).toHaveLength(1);
    expect(videoLibraryRows[0].collection_type).toBe('TEAM');
    expect(videoLibraryRows[0].added_by_role).toBe('LEADER');
  });

  it('ADMIN duyệt → video vào collection_type SHARED', async () => {
    const { service, videoLibraryRows } = build();
    await service.addVideoDirectly('admin1', 'Admin One', ['ADMIN'], buildVideo() as any);

    expect(videoLibraryRows).toHaveLength(1);
    expect(videoLibraryRows[0].collection_type).toBe('SHARED');
  });

  it('duyệt thành công → tạo VideoLibrary ngay, ApprovedContent sinh sau ở chạy nền', async () => {
    const { service, approvedContentRows } = build();
    const result = await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);

    expect(result.videoLibraryId).toBeDefined();
    // Script sinh ở chạy nền nên lời gọi này không còn trả về id của content nữa.
    expect(result.approvedContentId).toBeNull();

    await service.waitForPendingScripts();
    expect(approvedContentRows).toHaveLength(1);
    expect(approvedContentRows[0].script).toContain('Nội dung tiếng Việt');
    expect(approvedContentRows[0].source_video_id).toBe('v1');
  });

  it('dedup: video_id + collection_type đã tồn tại → không tạo VideoLibrary trùng', async () => {
    const { service, prisma, videoLibraryRows } = build();
    prisma.videoLibrary.findUnique.mockResolvedValueOnce({ id: 'existing-lib', collection_type: 'TEAM' });

    const result = await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);

    expect(prisma.videoLibrary.create).not.toHaveBeenCalled();
    expect(videoLibraryRows).toHaveLength(0);
    expect(result.videoLibraryId).toBe('existing-lib');
  });

  it('AI lỗi → VideoLibrary vẫn được tạo, ApprovedContent không có (không rollback)', async () => {
    const { service, aiIntegration, videoLibraryRows, approvedContentRows } = build();
    aiIntegration.analyzeScrapedVideo.mockRejectedValueOnce(new Error('DeepSeek timeout'));

    const result = await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);
    // Lỗi ở chạy nền KHÔNG được ném ra ngoài (không ai await promise đó, ném là sập tiến trình).
    await expect(service.waitForPendingScripts()).resolves.toBeUndefined();

    expect(videoLibraryRows).toHaveLength(1);
    expect(approvedContentRows).toHaveLength(0);
    expect(result.approvedContentId).toBeNull();
  });

  it('KHÔNG bắt người bấm đợi AI sinh script xong mới trả lời', async () => {
    const { service, approvedContentRows } = build();
    // AI cố tình chậm 3 giây — trước đây lời gọi bị chặn đúng bằng chừng đó.
    let releaseAi: () => void = () => {};
    (service as any).aiIntegration.analyzeScrapedVideo = jest.fn(
      () => new Promise((resolve) => {
        releaseAi = () => resolve({ vietnamese_content: 'x', script_outline: 'y', hashtags: [] });
      }),
    );

    const started = Date.now();
    const result = await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);
    const waited = Date.now() - started;

    expect(result.videoLibraryId).toBeDefined();
    expect(waited).toBeLessThan(1000);        // trả lời ngay, không đợi AI
    expect(approvedContentRows).toHaveLength(0); // script chưa xong là đúng

    releaseAi();
    await service.waitForPendingScripts();
    expect(approvedContentRows).toHaveLength(1); // xong sau, ở chạy nền
  });
});

describe('VideoLibraryService.reviewProposal — PENDING-guard + role-guard', () => {
  function build(proposal: any) {
    const prisma: any = {
      notification: { create: jest.fn(async () => ({})) },
      scraperVideoProposal: {
        findUnique: jest.fn(async () => proposal),
        update: jest.fn(async ({ data }: any) => ({ ...proposal, ...data })),
      },
      videoLibrary: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'lib1', ...data })),
      },
      approvedContent: {
        create: jest.fn(async ({ data }: any) => ({ id: 'content1', ...data })),
      },
    };
    const push: any = { sendToUser: jest.fn(async () => {}) };
    const aiIntegration: any = {
      analyzeScrapedVideo: jest.fn(async () => ({ vietnamese_content: 'x', script_outline: 'y', hashtags: [] })),
      fetchVideoDetail: jest.fn(async () => null),
    };
    const service = new VideoLibraryService(prisma, push, aiIntegration);
    return { service, prisma };
  }

  const pendingProposal = { id: 'p1', status: 'PENDING', requested_by_id: 'member1', title: 'V', video_url: 'u', ...buildVideo() };

  afterEach(() => jest.clearAllMocks());

  it('từ chối duyệt nếu đề xuất không còn ở trạng thái PENDING', async () => {
    const { service } = build({ ...pendingProposal, status: 'APPROVED' });

    await expect(
      service.reviewProposal('p1', 'APPROVED', undefined, 'leader1', 'Leader', ['LEADER']),
    ).rejects.toThrow(ConflictException);
  });

  it('từ chối nếu người duyệt không phải LEADER/ADMIN', async () => {
    const { service } = build(pendingProposal);

    await expect(
      service.reviewProposal('p1', 'APPROVED', undefined, 'member2', 'Member Two', ['MEMBER']),
    ).rejects.toThrow(ForbiddenException);
  });

  it('không tìm thấy đề xuất → NotFoundException', async () => {
    const { service, prisma } = build(null);
    prisma.scraperVideoProposal.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.reviewProposal('missing', 'APPROVED', undefined, 'leader1', 'Leader', ['LEADER']),
    ).rejects.toThrow(NotFoundException);
  });

  it('LEADER duyệt hợp lệ → cập nhật status APPROVED + reviewed_by_id', async () => {
    const { service, prisma } = build(pendingProposal);

    const result = await service.reviewProposal('p1', 'APPROVED', 'ok', 'leader1', 'Leader One', ['LEADER']);

    expect(result.status).toBe('APPROVED');
    expect(prisma.scraperVideoProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', reviewed_by_id: 'leader1' }) }),
    );
  });

  it('REJECTED → không tạo VideoLibrary, chỉ cập nhật status', async () => {
    const { service, prisma } = build(pendingProposal);

    await service.reviewProposal('p1', 'REJECTED', 'không phù hợp', 'leader1', 'Leader One', ['LEADER']);

    expect(prisma.videoLibrary.create).not.toHaveBeenCalled();
  });
});

describe('VideoLibraryService.deleteVideoLibrary — quyền xoá khớp FE canDeleteCurrent', () => {
  function build(row: any) {
    const prisma: any = {
      videoLibrary: {
        findUnique: jest.fn(async () => row),
        delete: jest.fn(async () => ({})),
      },
    };
    const service = new VideoLibraryService(prisma, {} as any, {} as any);
    return { service, prisma };
  }

  it('LEADER xoá được video tab Team', async () => {
    const { service, prisma } = build({ id: '1', collection_type: 'TEAM' });
    await service.deleteVideoLibrary('1', ['LEADER']);
    expect(prisma.videoLibrary.delete).toHaveBeenCalled();
  });

  it('LEADER KHÔNG xoá được video tab Chung (SHARED)', async () => {
    const { service } = build({ id: '1', collection_type: 'SHARED' });
    await expect(service.deleteVideoLibrary('1', ['LEADER'])).rejects.toThrow(ForbiddenException);
  });

  it('ADMIN xoá được cả 2 tab', async () => {
    const { service, prisma } = build({ id: '1', collection_type: 'SHARED' });
    await service.deleteVideoLibrary('1', ['ADMIN']);
    expect(prisma.videoLibrary.delete).toHaveBeenCalled();
  });

  it('MEMBER không xoá được gì', async () => {
    const { service } = build({ id: '1', collection_type: 'TEAM' });
    await expect(service.deleteVideoLibrary('1', ['MEMBER'])).rejects.toThrow(ForbiddenException);
  });
});

describe('VideoLibraryService.deleteApprovedContent — chỉ ADMIN/MANAGER', () => {
  function build() {
    const prisma: any = {
      approvedContent: {
        findUnique: jest.fn(async () => ({ id: '1' })),
        delete: jest.fn(async () => ({})),
      },
    };
    const service = new VideoLibraryService(prisma, {} as any, {} as any);
    return { service, prisma };
  }

  it('LEADER không được xoá content đã duyệt', async () => {
    const { service } = build();
    await expect(service.deleteApprovedContent('1', ['LEADER'])).rejects.toThrow(ForbiddenException);
  });

  it('MANAGER xoá được content đã duyệt', async () => {
    const { service, prisma } = build();
    await service.deleteApprovedContent('1', ['MANAGER']);
    expect(prisma.approvedContent.delete).toHaveBeenCalled();
  });
});

/**
 * Làm giàu dữ liệu khi đề xuất video từ ngoài (extension).
 *
 * Bối cảnh: extension chỉ chắc chắn moi được platform + video_id từ URL. Số liệu đọc trên
 * trang KHÔNG đáng tin — bảng tin nhúng JSON của nhiều video khác nhau, trang SPA thì state
 * nhúng đã cũ. Nên server phải hỏi lại nền tảng (TikHub) rồi mới ghi vào DB.
 *
 * Hai quy tắc dễ vỡ nhất, test bám đúng vào đó:
 *   1. Số liệu thật LUÔN ghi đè số extension đọc được.
 *   2. Nhưng KHÔNG được xoá dữ liệu đang có bằng một giá trị rỗng (nền tảng giấu chỉ số nào
 *      thì trả 0/'' — vd Douyin không công khai lượt xem, YouTube không trả tim/bình luận).
 */
describe('VideoLibraryService — làm giàu dữ liệu video khi đề xuất', () => {
  function build() {
    const proposals: any[] = [];
    const libraryRows: any[] = [];
    const prisma: any = {
      notification: { create: jest.fn(async () => ({})) },
      scraperVideoProposal: {
        // assertNotDuplicate hỏi trước khi tạo — mặc định chưa có gì trùng.
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `p-${proposals.length + 1}`, ...data };
          proposals.push(row);
          return row;
        }),
      },
      videoLibrary: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `lib-${libraryRows.length + 1}`, ...data };
          libraryRows.push(row);
          return row;
        }),
      },
      approvedContent: { create: jest.fn(async ({ data }: any) => ({ id: 'c1', ...data })) },
    };
    const push: any = { sendToUser: jest.fn(async () => {}) };
    const aiIntegration: any = {
      analyzeScrapedVideo: jest.fn(async () => ({
        vietnamese_content: 'x', script_outline: 'y', hashtags: [],
      })),
      fetchVideoDetail: jest.fn(async () => null),
    };
    const service = new VideoLibraryService(prisma, push, aiIntegration);
    return { service, prisma, aiIntegration, proposals, libraryRows };
  }

  /** Số liệu extension đọc được trên trang — cố tình bịa nhỏ để phân biệt với số thật. */
  function extensionDto(overrides: Partial<any> = {}) {
    return {
      video_id: '7659675415467902374',
      platform: 'douyin',
      video_url: 'https://www.douyin.com/video/7659675415467902374',
      title: '',
      views_count: 0,
      likes_count: 7,
      comments_count: 3,
      shares_count: 1,
      source: 'MANUAL',
      ...overrides,
    };
  }

  const realDetail = {
    platform: 'douyin',
    title: 'Tiêu đề thật',
    description: 'Mô tả thật',
    author_name: 'MaodVlog',
    author_username: '67011077815',
    thumbnail_url: 'https://p3.douyinpic.com/that.jpeg',
    views_count: 0,          // Douyin không công khai lượt xem
    likes_count: 329712,
    comments_count: 4496,
    shares_count: 118059,
  };

  afterEach(() => jest.clearAllMocks());

  it('member đề xuất → gọi lấy chi tiết đúng platform + video_id + link', async () => {
    const { service, aiIntegration } = build();
    await service.proposeVideo('member1', extensionDto() as any);
    expect(aiIntegration.fetchVideoDetail).toHaveBeenCalledWith({
      platform: 'douyin',
      videoId: '7659675415467902374',
      videoUrl: 'https://www.douyin.com/video/7659675415467902374',
    });
  });

  it('số liệu thật ghi đè số extension đọc được trên trang', async () => {
    const { service, aiIntegration, proposals } = build();
    aiIntegration.fetchVideoDetail.mockResolvedValueOnce(realDetail);

    await service.proposeVideo('member1', extensionDto() as any);

    expect(proposals[0].likes_count).toBe(329712n);
    expect(proposals[0].comments_count).toBe(4496n);
    expect(proposals[0].shares_count).toBe(118059n);
    expect(proposals[0].title).toBe('Tiêu đề thật');
    expect(proposals[0].author_name).toBe('MaodVlog');
    expect(proposals[0].thumbnail_url).toBe('https://p3.douyinpic.com/that.jpeg');
  });

  it('nền tảng giấu chỉ số (trả 0) → giữ lại con số extension đọc được, không ghi đè bằng 0', async () => {
    const { service, aiIntegration, proposals } = build();
    // Douyin trả play_count = 0; extension đọc trên trang được 12345.
    aiIntegration.fetchVideoDetail.mockResolvedValueOnce({ ...realDetail, views_count: 0 });

    await service.proposeVideo('member1', extensionDto({ views_count: 12345 }) as any);

    expect(proposals[0].views_count).toBe(12345n);
  });

  it('chi tiết trả về chuỗi rỗng → không xoá mất chữ extension đã đọc được', async () => {
    const { service, aiIntegration, proposals } = build();
    aiIntegration.fetchVideoDetail.mockResolvedValueOnce({
      ...realDetail, title: '', author_name: '   ', thumbnail_url: '',
    });

    await service.proposeVideo('member1', extensionDto({
      title: 'Tiêu đề extension đọc được',
      author_name: 'Kênh extension đọc được',
      thumbnail_url: 'https://anh-extension.jpg',
    }) as any);

    expect(proposals[0].title).toBe('Tiêu đề extension đọc được');
    expect(proposals[0].author_name).toBe('Kênh extension đọc được');
    expect(proposals[0].thumbnail_url).toBe('https://anh-extension.jpg');
  });

  it('lấy chi tiết hỏng (Facebook / TikHub lỗi) → vẫn tạo đề xuất, không ném lỗi', async () => {
    const { service, aiIntegration, proposals } = build();
    aiIntegration.fetchVideoDetail.mockResolvedValueOnce(null);

    await expect(
      service.proposeVideo('member1', extensionDto({ platform: 'facebook' }) as any),
    ).resolves.toBeDefined();

    expect(proposals).toHaveLength(1);
    expect(proposals[0].likes_count).toBe(7n); // giữ nguyên số extension gửi lên
  });

  it('leader thêm thẳng vào Bộ Sưu Tập cũng được làm giàu dữ liệu', async () => {
    const { service, aiIntegration, libraryRows } = build();
    aiIntegration.fetchVideoDetail.mockResolvedValueOnce(realDetail);

    await service.addVideoDirectly('leader1', 'Leader', ['LEADER'], extensionDto() as any);

    expect(aiIntegration.fetchVideoDetail).toHaveBeenCalled();
    expect(libraryRows[0].likes_count).toBe(329712n);
    expect(libraryRows[0].title).toBe('Tiêu đề thật');
  });
});

/**
 * Chặn đề xuất trùng. Lỗi thật: bấm nút "Đề xuất" 3 lần trên cùng một video sinh ra 3 dòng
 * chờ duyệt, nhồi hàng đợi của leader — và vì mỗi lượt đề xuất đều gọi TikHub có tính phí,
 * chặn muộn là đã mất tiền. Nên phải chặn TRƯỚC khi gọi lấy chi tiết.
 */
describe('VideoLibraryService — chặn đề xuất trùng', () => {
  function build(opts: { pending?: any; inLibrary?: any; existingDirect?: any } = {}) {
    const proposals: any[] = [];
    const libraryRows: any[] = [];
    const prisma: any = {
      notification: { create: jest.fn(async () => ({})) },
      scraperVideoProposal: {
        findFirst: jest.fn(async () => opts.pending ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `p-${proposals.length + 1}`, ...data };
          proposals.push(row);
          return row;
        }),
      },
      videoLibrary: {
        findFirst: jest.fn(async () => opts.inLibrary ?? null),
        findUnique: jest.fn(async () => opts.existingDirect ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `lib-${libraryRows.length + 1}`, ...data };
          libraryRows.push(row);
          return row;
        }),
      },
      approvedContent: { create: jest.fn(async ({ data }: any) => ({ id: 'c1', ...data })) },
    };
    const push: any = { sendToUser: jest.fn(async () => {}) };
    const aiIntegration: any = {
      analyzeScrapedVideo: jest.fn(async () => ({ vietnamese_content: 'x', script_outline: 'y', hashtags: [] })),
      fetchVideoDetail: jest.fn(async () => ({
        platform: 'douyin', title: 'T', description: '', author_name: 'A', author_username: 'a',
        thumbnail_url: '', views_count: 1, likes_count: 2, comments_count: 3, shares_count: 4,
      })),
    };
    const service = new VideoLibraryService(prisma, push, aiIntegration);
    return { service, prisma, aiIntegration, proposals, libraryRows };
  }

  const dto = () => ({
    video_id: 'v-trung', platform: 'douyin',
    video_url: 'https://www.douyin.com/video/1', source: 'MANUAL' as const,
  });

  afterEach(() => jest.clearAllMocks());

  it('đã có đề xuất PENDING cùng video → từ chối, KHÔNG tạo dòng thứ hai', async () => {
    const { service, proposals } = build({ pending: { id: 'p-cu' } });

    await expect(service.proposeVideo('member1', dto() as any)).rejects.toThrow(ConflictException);
    expect(proposals).toHaveLength(0);
  });

  it('chặn trùng TRƯỚC khi gọi TikHub — không đốt lượt gọi tính phí', async () => {
    const { service, aiIntegration } = build({ pending: { id: 'p-cu' } });

    await expect(service.proposeVideo('member1', dto() as any)).rejects.toThrow();
    expect(aiIntegration.fetchVideoDetail).not.toHaveBeenCalled();
  });

  it('video đã nằm trong Bộ Sưu Tập → từ chối, báo rõ đang ở tab nào', async () => {
    const { service } = build({ inLibrary: { collection_type: 'SHARED' } });

    await expect(service.proposeVideo('member1', dto() as any)).rejects.toThrow(/Chung/);
  });

  it('chưa có gì trùng → vẫn tạo đề xuất bình thường', async () => {
    const { service, proposals } = build();

    await service.proposeVideo('member1', dto() as any);
    expect(proposals).toHaveLength(1);
  });

  it('leader thêm thẳng video đã có → trả về dòng cũ, KHÔNG gọi TikHub lẫn AI lần nữa', async () => {
    const { service, aiIntegration, libraryRows } = build({ existingDirect: { id: 'lib-co-san' } });

    const res = await service.addVideoDirectly('leader1', 'Leader', ['LEADER'], dto() as any);

    expect(res.videoLibraryId).toBe('lib-co-san');
    expect(libraryRows).toHaveLength(0);
    expect(aiIntegration.fetchVideoDetail).not.toHaveBeenCalled();
    expect(aiIntegration.analyzeScrapedVideo).not.toHaveBeenCalled();
  });
});

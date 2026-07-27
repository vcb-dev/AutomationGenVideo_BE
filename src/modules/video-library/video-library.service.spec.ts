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

  it('duyệt thành công → tạo cả VideoLibrary lẫn ApprovedContent (script tiếng Việt)', async () => {
    const { service, approvedContentRows } = build();
    const result = await service.addVideoDirectly('leader1', 'Leader One', ['LEADER'], buildVideo() as any);

    expect(result.videoLibraryId).toBeDefined();
    expect(result.approvedContentId).toBeDefined();
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

    expect(videoLibraryRows).toHaveLength(1);
    expect(approvedContentRows).toHaveLength(0);
    expect(result.approvedContentId).toBeNull();
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

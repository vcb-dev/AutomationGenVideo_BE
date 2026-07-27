import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushService } from '../../common/push/push.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { ProposeVideoDto } from './video-library.dto';

function isAdminOrManager(roles: string[]): boolean {
  return roles.includes('ADMIN') || roles.includes('MANAGER');
}

function canReview(roles: string[]): boolean {
  return roles.includes('ADMIN') || roles.includes('LEADER');
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Hoàn thiện tính năng "Bộ Sưu Tập" đã có schema (VideoLibrary/ApprovedContent,
// từ migration init) + FE (dashboard/video-library/page.tsx) nhưng chưa từng có
// route BE nào. Thêm mới ScraperVideoProposal (mirror TeamPushRequest) làm hàng
// đợi duyệt trước khi video vào VideoLibrary — member đề xuất, leader/admin duyệt
// (hoặc tự thêm thẳng, coi như tự duyệt).
@Injectable()
export class VideoLibraryService {
  private readonly logger = new Logger(VideoLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  private async notifyUser(userId: string, type: string, title: string, body: string): Promise<void> {
    await this.prisma.notification.create({ data: { user_id: userId, type, title, body } }).catch(() => null);
    this.push.sendToUser(userId, { title, body }).catch(() => {});
  }

  // ─── Video Library (Bộ Sưu Tập) ────────────────────────────────────────────

  async listVideoLibrary(type: 'TEAM' | 'SHARED') {
    return this.prisma.videoLibrary.findMany({
      where: { collection_type: type },
      orderBy: { created_at: 'desc' },
    });
  }

  async deleteVideoLibrary(id: string, roles: string[]): Promise<void> {
    const row = await this.prisma.videoLibrary.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy video trong bộ sưu tập');

    // Khớp đúng canDeleteCurrent đã code sẵn ở FE (video-library/page.tsx):
    // ADMIN/MANAGER xoá được cả 2 tab; LEADER chỉ xoá được tab Team.
    const allowed = isAdminOrManager(roles) || (row.collection_type === 'TEAM' && roles.includes('LEADER'));
    if (!allowed) throw new ForbiddenException('Không có quyền xoá video này');

    await this.prisma.videoLibrary.delete({ where: { id } });
  }

  // ─── Approved Content ───────────────────────────────────────────────────────

  async listApprovedContent() {
    return this.prisma.approvedContent.findMany({ orderBy: { created_at: 'desc' } });
  }

  async deleteApprovedContent(id: string, roles: string[]): Promise<void> {
    if (!isAdminOrManager(roles)) throw new ForbiddenException('Chỉ admin/manager được xoá content đã duyệt');
    const row = await this.prisma.approvedContent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy content');
    await this.prisma.approvedContent.delete({ where: { id } });
  }

  // ─── Proposals (member đề xuất) ─────────────────────────────────────────────

  async proposeVideo(memberId: string, dto: ProposeVideoDto) {
    const proposal = await this.prisma.scraperVideoProposal.create({
      data: {
        video_id: dto.video_id,
        platform: dto.platform,
        title: dto.title || '',
        description: dto.description || '',
        video_url: dto.video_url,
        author_username: dto.author_username || '',
        author_name: dto.author_name || '',
        thumbnail_url: dto.thumbnail_url,
        views_count: BigInt(dto.views_count || 0),
        likes_count: BigInt(dto.likes_count || 0),
        comments_count: BigInt(dto.comments_count || 0),
        shares_count: BigInt(dto.shares_count || 0),
        source: dto.source || 'SCRAPED',
        notes: dto.notes,
        requested_by_id: memberId,
      },
    });
    return proposal;
  }

  async listMyProposals(memberId: string, status?: string) {
    return this.prisma.scraperVideoProposal.findMany({
      where: { requested_by_id: memberId, ...(status ? { status: status as any } : {}) },
      orderBy: { created_at: 'desc' },
    });
  }

  async listPendingProposals(status?: string) {
    return this.prisma.scraperVideoProposal.findMany({
      where: { ...(status ? { status: status as any } : { status: 'PENDING' }) },
      include: { requested_by: { select: { id: true, full_name: true, email: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async reviewProposal(
    id: string,
    action: 'APPROVED' | 'REJECTED',
    note: string | undefined,
    reviewerId: string,
    reviewerName: string,
    roles: string[],
  ) {
    const proposal = await this.prisma.scraperVideoProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất');
    if (proposal.status !== 'PENDING') throw new ConflictException('Đề xuất đã được xử lý');
    if (!canReview(roles)) throw new ForbiddenException('Chỉ leader/admin được duyệt đề xuất');

    if (action === 'APPROVED') {
      await this.approveIntoLibrary(
        {
          video_id: proposal.video_id,
          platform: proposal.platform,
          title: proposal.title,
          description: proposal.description,
          video_url: proposal.video_url,
          author_username: proposal.author_username,
          author_name: proposal.author_name,
          thumbnail_url: proposal.thumbnail_url,
          views_count: proposal.views_count,
          likes_count: proposal.likes_count,
          comments_count: proposal.comments_count,
          shares_count: proposal.shares_count,
        },
        reviewerId,
        reviewerName,
        roles,
      );
    }

    const updated = await this.prisma.scraperVideoProposal.update({
      where: { id },
      data: { status: action, reviewed_by_id: reviewerId, reviewed_at: new Date(), note },
    });

    this.notifyUser(
      proposal.requested_by_id,
      'VIDEO_PROPOSAL_REVIEWED',
      action === 'APPROVED' ? 'Video đề xuất đã được duyệt' : 'Video đề xuất đã bị từ chối',
      action === 'APPROVED'
        ? `Video "${proposal.title || proposal.video_url}" đã được duyệt vào bộ sưu tập.`
        : `Video "${proposal.title || proposal.video_url}" đã bị từ chối.${note ? ` Lý do: ${note}` : ''}`,
    ).catch(() => {});

    return updated;
  }

  // ─── Leader/Admin tự thêm thẳng (không qua hàng đợi, coi như tự duyệt) ──────

  async addVideoDirectly(reviewerId: string, reviewerName: string, roles: string[], dto: ProposeVideoDto) {
    return this.approveIntoLibrary(
      {
        video_id: dto.video_id,
        platform: dto.platform,
        title: dto.title || '',
        description: dto.description || '',
        video_url: dto.video_url,
        author_username: dto.author_username || '',
        author_name: dto.author_name || '',
        thumbnail_url: dto.thumbnail_url,
        views_count: BigInt(dto.views_count || 0),
        likes_count: BigInt(dto.likes_count || 0),
        comments_count: BigInt(dto.comments_count || 0),
        shares_count: BigInt(dto.shares_count || 0),
      },
      reviewerId,
      reviewerName,
      roles,
    );
  }

  // ─── Dùng chung bởi reviewProposal (APPROVED) và addVideoDirectly ───────────
  // Lỗi gọi AI KHÔNG rollback bước tạo VideoLibrary — ApprovedContent.script là
  // bắt buộc non-null nên không tạo được row rỗng chờ AI xong sau; chỉ log cảnh
  // báo, để leader/admin biết approve vẫn thành công dù chưa có script.
  private async approveIntoLibrary(
    video: {
      video_id: string;
      platform: string;
      title: string;
      description: string;
      video_url: string;
      author_username: string;
      author_name: string;
      thumbnail_url: string | null;
      views_count: bigint;
      likes_count: bigint;
      comments_count: bigint;
      shares_count: bigint;
    },
    approverId: string,
    approverName: string,
    approverRoles: string[],
  ): Promise<{ videoLibraryId: string; approvedContentId: string | null }> {
    // LEADER duyệt → tab Team, ADMIN duyệt → tab Chung (khớp quyền xoá đã có ở FE)
    const collectionType = approverRoles.includes('ADMIN') ? 'SHARED' : 'TEAM';
    const approverRole = (approverRoles.includes('ADMIN') ? 'ADMIN' : approverRoles.includes('LEADER') ? 'LEADER' : approverRoles[0] || 'MEMBER') as any;

    const existing = await this.prisma.videoLibrary.findUnique({
      where: { video_id_collection_type: { video_id: video.video_id, collection_type: collectionType } },
    });
    const libraryRow =
      existing ||
      (await this.prisma.videoLibrary.create({
        data: {
          video_id: video.video_id,
          platform: video.platform,
          title: video.title,
          description: video.description,
          video_url: video.video_url,
          author_username: video.author_username,
          author_name: video.author_name,
          thumbnail_url: video.thumbnail_url,
          views_count: video.views_count,
          likes_count: video.likes_count,
          comments_count: video.comments_count,
          shares_count: video.shares_count,
          collection_type: collectionType,
          added_by_id: approverId,
          added_by_name: approverName,
          added_by_role: approverRole,
        },
      }));

    let approvedContentId: string | null = null;
    try {
      const result = await this.aiIntegration.analyzeScrapedVideo({
        platform: video.platform,
        title: video.title,
        description: video.description,
        viewsCount: Number(video.views_count),
        likesCount: Number(video.likes_count),
        commentsCount: Number(video.comments_count),
      });

      const script = `${result.vietnamese_content}\n\n--- Phân tích ---\n${result.script_outline}`;
      const approvedContent = await this.prisma.approvedContent.create({
        data: {
          script,
          content_type: 'SCRAPED_VIDEO',
          content_type_display: 'Video sưu tầm',
          word_count: wordCount(script),
          source_video_id: video.video_id,
          source_video_title: video.title,
          source_video_desc: video.description,
          source_video_url: video.video_url,
          approved_by_id: approverId,
          approved_by_name: approverName,
          approved_by_role: approverRole,
        },
      });
      approvedContentId = approvedContent.id;
    } catch (err: any) {
      this.logger.error(`[VIDEO-LIBRARY] Duyệt "${video.title}" xong nhưng AI phân tích lỗi: ${err.message}`);
    }

    return { videoLibraryId: libraryRow.id, approvedContentId };
  }
}

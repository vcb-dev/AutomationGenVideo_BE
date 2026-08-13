import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushService } from '../../common/push/push.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { ProposeVideoDto } from './video-library.dto';
import { isShortLink, resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { extractVideoId, detectPlatformFromUrl } from '../../common/utils/video-url.util';

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

  /**
   * Lấy số liệu thật (view/tim/bình luận/chia sẻ/tiêu đề/ảnh bìa) cho video được đề xuất.
   *
   * Vì sao cần: video đề xuất từ ngoài (extension) chỉ chắc chắn có platform + video_id.
   * Số liệu đọc trên trang không đáng tin — bảng tin nhúng JSON của nhiều video khác nhau,
   * trang SPA thì state nhúng đã cũ — nên để server hỏi TikHub, đúng nguồn mà hệ thống vẫn
   * cào lâu nay.
   *
   * Quy tắc trộn: số liệu từ TikHub luôn thắng; chữ (tiêu đề, tên kênh, ảnh bìa) chỉ ghi đè
   * khi TikHub thực sự có — không xoá mất thứ extension đã đọc được bằng một giá trị rỗng.
   *
   * Fail-open: TikHub hỏng / nền tảng không hỗ trợ (Facebook) → giữ nguyên dto, đề xuất vẫn đi
   * tiếp. Thà thiếu số liệu còn hơn chặn người dùng.
   */
  private async enrichFromPlatform(dto: ProposeVideoDto): Promise<ProposeVideoDto> {
    const detail = await this.aiIntegration.fetchVideoDetail({
      platform: dto.platform,
      videoId: dto.video_id,
      videoUrl: dto.video_url,
    });
    if (!detail) {
      this.logger.log(
        `[propose] Khong lay duoc chi tiet ${dto.platform}/${dto.video_id} — giu du lieu extension gui len`,
      );
      return dto;
    }

    // Chữ do CON NGƯỜI gõ thì giữ nguyên — leader đặt tiêu đề riêng cho team mà bị thay
    // bằng tiêu đề gốc tiếng Trung của nền tảng thì coi như mất công gõ.
    // Chữ do MÁY đọc (extension/thẻ video) thì để dữ liệu nền tảng thắng, vì chuẩn hơn.
    const keep = (fresh: string, current?: string) => {
      const mine = (current || '').trim();
      if (dto.user_edited && mine) return mine;
      return fresh && fresh.trim() ? fresh : mine;
    };
    return {
      ...dto,
      title: keep(detail.title, dto.title),
      description: keep(detail.description, dto.description),
      author_name: keep(detail.author_name, dto.author_name),
      author_username: keep(detail.author_username, dto.author_username),
      thumbnail_url: keep(detail.thumbnail_url, dto.thumbnail_url) || undefined,
      // Nền tảng giấu chỉ số nào thì trả 0 (Douyin không công khai lượt xem, YouTube không
      // trả tim/bình luận ở endpoint này) — lúc đó dùng lại con số extension đọc được.
      views_count: detail.views_count || dto.views_count || 0,
      likes_count: detail.likes_count || dto.likes_count || 0,
      comments_count: detail.comments_count || dto.comments_count || 0,
      shares_count: detail.shares_count || dto.shares_count || 0,
    };
  }

  /**
   * Giải link rút gọn rồi bóc lại mã video khi cần.
   *
   * App điện thoại bấm "Chia sẻ → Sao chép liên kết" là ra link rút gọn (vt.tiktok.com,
   * v.douyin.com, xhslink.com, b23.tv, fb.watch...). Những link đó không chứa mã video nên
   * FE không bóc được, và người dùng bị chặn ngay ở bước dán link — trong khi đó lại là
   * cách chia sẻ phổ biến nhất. Ở đây follow redirect (allowlist, không SSRF) để lấy link
   * đầy đủ rồi bóc mã.
   */
  private async resolveVideoRef(dto: ProposeVideoDto): Promise<ProposeVideoDto> {
    if (!isShortLink(dto.video_url)) return dto;

    const full = await resolveShortLink(dto.video_url);
    if (!full || full === dto.video_url) return dto;

    const videoId = extractVideoId(full);
    this.logger.log(`[propose] Giai link rut gon: ${dto.video_url} -> ${full} (ma: ${videoId || 'khong ro'})`);
    return {
      ...dto,
      video_url: full,
      // Chỉ thay mã khi bóc được — không xoá mất mã FE đã gửi lên.
      video_id: videoId || dto.video_id,
      platform: detectPlatformFromUrl(full) || dto.platform,
    };
  }

  /**
   * Chặn đề xuất trùng TRƯỚC khi gọi lấy chi tiết video.
   *
   * Hai lý do phải chặn, và phải chặn sớm:
   *  - bấm nút 2-3 lần (hoặc gặp lại video đó ở trang khác) sẽ nhồi hàng chờ duyệt của
   *    leader bằng cùng một video;
   *  - mỗi lượt đề xuất là một lượt gọi TikHub có tính phí, chặn sau khi gọi là đã mất tiền.
   */
  private async assertNotDuplicate(dto: ProposeVideoDto): Promise<void> {
    const pending = await this.prisma.scraperVideoProposal.findFirst({
      where: { video_id: dto.video_id, platform: dto.platform, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) throw new ConflictException('Video này đã được đề xuất và đang chờ duyệt.');

    const inLibrary = await this.prisma.videoLibrary.findFirst({
      where: { video_id: dto.video_id },
      select: { collection_type: true },
    });
    if (inLibrary) {
      throw new ConflictException(
        `Video này đã có trong Bộ Sưu Tập (${inLibrary.collection_type === 'SHARED' ? 'Chung' : 'Team'}).`,
      );
    }
  }

  async proposeVideo(memberId: string, inputDto: ProposeVideoDto) {
    const rawDto = await this.resolveVideoRef(inputDto);
    await this.assertNotDuplicate(rawDto);
    const dto = await this.enrichFromPlatform(rawDto);
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
          notes: proposal.notes,
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

  async addVideoDirectly(reviewerId: string, reviewerName: string, roles: string[], inputDto: ProposeVideoDto) {
    const rawDto = await this.resolveVideoRef(inputDto);
    // Đã có sẵn trong bộ sưu tập thì dừng ngay, ĐỪNG gọi lấy chi tiết: mỗi lượt gọi TikHub
    // đều tính phí, mà kết quả cuối cùng vẫn là trả về đúng dòng cũ (approveIntoLibrary tự
    // dedup). Giữ nguyên shape trả về để không đổi hành vi phía gọi.
    const collectionType = roles.includes('ADMIN') ? 'SHARED' : 'TEAM';
    const existing = await this.prisma.videoLibrary.findUnique({
      where: { video_id_collection_type: { video_id: rawDto.video_id, collection_type: collectionType } },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`[direct-add] ${rawDto.platform}/${rawDto.video_id} da co trong ${collectionType}, bo qua`);
      return { videoLibraryId: existing.id, approvedContentId: null };
    }

    // Leader/admin vào thẳng Bộ Sưu Tập nên càng phải có số liệu thật — không thì bộ sưu tập
    // đầy những dòng 0 lượt xem, 0 tim, không lọc/sắp xếp được.
    const dto = await this.enrichFromPlatform(rawDto);
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
        notes: dto.notes ?? null,
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
      /** Ghi chú người đề xuất/người thêm nhập tay — trước đây bị rơi mất khi vào bộ sưu tập. */
      notes?: string | null;
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
          notes: video.notes ?? null,
        },
      }));

    // Sinh script CHẠY NỀN, không bắt người bấm ngồi đợi.
    //
    // Trước đây bước này được await ngay tại đây: gọi AI mất ~10-15 giây (timeout tới 120s),
    // cộng với bước lấy số liệu nền tảng thì leader bấm "Thêm vào BST" phải chờ ~15-19 giây
    // mới thấy phản hồi. Mà kết quả của nó vốn đã là "best effort" — lỗi AI không hề rollback
    // VideoLibrary (xem chú thích ở đầu hàm) — nên chẳng có lý do gì phải chặn.
    this.trackScriptJob(this.generateScriptFor(video, approverId, approverName, approverRole));

    // approvedContentId luôn null từ đây: content được tạo sau, ở chạy nền.
    // Đã kiểm tra không nơi nào (FE lẫn BE) đọc giá trị này ngoài khai báo kiểu.
    return { videoLibraryId: libraryRow.id, approvedContentId: null };
  }

  /**
   * Các việc sinh script đang chạy nền.
   *
   * Giữ tham chiếu để (a) test await được thay vì phải sleep đoán mò, (b) nếu sau này cần
   * chờ hết việc trước khi tắt tiến trình thì có sẵn chỗ móc vào.
   */
  private readonly pendingScriptJobs = new Set<Promise<void>>();

  private trackScriptJob(job: Promise<void>): void {
    this.pendingScriptJobs.add(job);
    void job.finally(() => this.pendingScriptJobs.delete(job));
  }

  /** Dùng trong test: đợi mọi việc sinh script chạy nền xong. */
  async waitForPendingScripts(): Promise<void> {
    await Promise.all([...this.pendingScriptJobs]);
  }

  private async generateScriptFor(
    video: { video_id: string; platform: string; title: string; description: string; video_url: string;
             views_count: bigint; likes_count: bigint; comments_count: bigint },
    approverId: string,
    approverName: string,
    approverRole: any,
  ): Promise<void> {
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
      await this.prisma.approvedContent.create({
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
      this.logger.log(`[VIDEO-LIBRARY] Da sinh xong script nen cho "${video.title.slice(0, 40)}"`);
    } catch (err: any) {
      // Không ném ra ngoài: video đã vào bộ sưu tập rồi, thiếu script không được phép làm
      // sập tiến trình vì đây là promise không ai await.
      this.logger.error(
        `[VIDEO-LIBRARY] Video "${video.title.slice(0, 40)}" da vao bo suu tap nhung sinh script loi: ${err.message}`,
      );
    }
  }
}

import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushService } from '../../common/push/push.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { COST_FEATURE_LABEL, COST_PAGE_LABEL } from '../../common/api-usage/api-usage-tracking';
import { runWithUsageTag } from '../../common/api-usage/request-context';
import { buildVoiceUsageDateRange } from '../ai-integration/voice-usage-range';
import { ProposeVideoDto } from './video-library.dto';
import { isShortLink, resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { extractVideoId, detectPlatformFromUrl } from '../../common/utils/video-url.util';

function isAdminOrManager(roles: string[]): boolean {
  return roles.includes('ADMIN') || roles.includes('MANAGER');
}

function canReview(roles: string[]): boolean {
  return roles.includes('ADMIN') || roles.includes('LEADER');
}

type TeamRef = { id: string; name: string };

/** Một dòng Bộ Sưu Tập kèm danh sách team sở hữu (phẳng, FE không phải bóc relation). */
function withTeams<T extends { teams?: Array<{ team: TeamRef }> }>(row: T): Omit<T, 'teams'> & { teams: TeamRef[] } {
  const { teams, ...rest } = row;
  return { ...rest, teams: (teams ?? []).map((t) => ({ id: t.team.id, name: t.team.name })) };
}

const TEAMS_INCLUDE = { teams: { include: { team: { select: { id: true, name: true } } } } } as const;

export const USD_VND_RATE_ENV = 'USD_VND_RATE';

/** Tỷ giá quy đổi chi phí USD → VNĐ cho tab Chi phí — env USD_VND_RATE, BẮT BUỘC (không có giá trị
 *  mặc định trong code). Thiếu / sai thì báo lỗi nêu tên biến, trang Chi phí hiện nguyên thông báo này. */
function usdVndRate(): number {
  const rate = Number(process.env[USD_VND_RATE_ENV]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new InternalServerErrorException(
      `Thiếu ${USD_VND_RATE_ENV} trong .env (tỷ giá quy đổi chi phí USD → VNĐ, số dương) — xem .env.example.`,
    );
  }
  return rate;
}

/** Ngày theo lịch Việt Nam (YYYY-MM-DD) của một mốc thời gian. */
function vnDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
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
export class VideoLibraryService implements OnModuleInit {
  private readonly logger = new Logger(VideoLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  private async notifyUser(userId: string, type: string, title: string, body: string, url?: string): Promise<void> {
    await this.prisma.notification.create({ data: { user_id: userId, type, title, body } }).catch(() => null);
    this.push.sendToUser(userId, { title, body, url }).catch(() => {});
  }

  /** Cửa sổ gộp thông báo đề xuất mới của cùng một người (dán 20 link → 1 thông báo, không phải 20). */
  static readonly PROPOSAL_NOTIFY_WINDOW_MS = 10 * 60 * 1000;

  /**
   * Báo người duyệt khi member đề xuất: leader các team của member; member chưa có team nào
   * (hoặc team chưa có leader) thì báo admin. Không bao giờ ném — đề xuất đã lưu xong rồi.
   */
  private async notifyReviewersOfProposal(memberId: string, videoTitle: string): Promise<void> {
    try {
      const teams = await this.prisma.team.findMany({
        where: { is_active: true, members: { some: { user_id: memberId } } },
        select: { leader_id: true },
      });
      let reviewerIds = [...new Set(teams.map((t) => t.leader_id).filter((id): id is string => !!id && id !== memberId))];
      if (reviewerIds.length === 0) {
        const admins = await this.prisma.user.findMany({
          where: { is_active: true, roles: { has: 'ADMIN' as any } },
          select: { id: true },
        });
        reviewerIds = admins.map((a) => a.id).filter((id) => id !== memberId);
      }
      if (reviewerIds.length === 0) return;

      const member = await this.prisma.user.findUnique({ where: { id: memberId }, select: { full_name: true, email: true } });
      const who = member?.full_name || member?.email || 'Thành viên';
      const since = new Date(Date.now() - VideoLibraryService.PROPOSAL_NOTIFY_WINDOW_MS);
      const url = '/dashboard/video-library?tab=pending';
      for (const reviewerId of reviewerIds) {
        const recent = await this.prisma.notification.findFirst({
          where: {
            user_id: reviewerId, type: 'VIDEO_PROPOSAL_NEW', is_read: false, created_at: { gte: since },
            meta: { path: ['proposer_id'], equals: memberId },
          },
          orderBy: { created_at: 'desc' },
        });
        if (recent) {
          // Gộp vào thông báo chưa đọc gần đây, KHÔNG đẩy push lần nữa (tránh rung máy 20 lần)
          const count = Number((recent.meta as any)?.count ?? 1) + 1;
          await this.prisma.notification.update({
            where: { id: recent.id },
            data: { title: `${who} đề xuất ${count} video mới`, body: `Mới nhất: "${videoTitle}" — vào tab Chờ duyệt để xem.`, meta: { proposer_id: memberId, count } },
          });
          continue;
        }
        const title = `${who} đề xuất video mới`;
        const body = `"${videoTitle}" đang chờ duyệt.`;
        await this.prisma.notification.create({
          data: { user_id: reviewerId, type: 'VIDEO_PROPOSAL_NEW', title, body, meta: { proposer_id: memberId, count: 1 } },
        });
        this.push.sendToUser(reviewerId, { title, body, url }).catch(() => {});
      }
    } catch (err: any) {
      this.logger.warn(`[VIDEO-LIBRARY] Khong bao duoc nguoi duyet: ${err?.message}`);
    }
  }

  // ─── Video Library (Bộ Sưu Tập) ────────────────────────────────────────────

  /** Các team người dùng đang thuộc — là leader hoặc là thành viên (team còn hoạt động). */
  async getUserTeamIds(userId: string): Promise<string[]> {
    if (!userId) return [];
    const teams = await this.prisma.team.findMany({
      where: {
        is_active: true,
        OR: [{ leader_id: userId }, { members: { some: { user_id: userId } } }],
      },
      select: { id: true },
    });
    return teams.map((t) => t.id);
  }

  /**
   * Tab Chung: ai cũng thấy TOÀN BỘ — video admin chọn lẫn video của mọi team, để cả công ty
   *   cùng tham khảo.
   * Tab Team:  ADMIN/MANAGER thấy video của mọi team (FE có bộ lọc theo team); còn lại chỉ
   *   thấy video gắn với team mình thuộc.
   */
  async listVideoLibrary(type: 'TEAM' | 'SHARED', userId = '', roles: string[] = []) {
    if (type === 'SHARED') {
      const rows = await this.prisma.videoLibrary.findMany({
        include: TEAMS_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      // Cùng một video có thể nằm cả ở Team lẫn Chung (admin thêm lại video team đã có) —
      // tab Chung chỉ hiện 1 thẻ: ưu tiên dòng Chung, gộp team của các dòng còn lại.
      const byVideo = new Map<string, ReturnType<typeof withTeams<(typeof rows)[number]>>>();
      for (const row of rows.map(withTeams)) {
        const prev = byVideo.get(row.video_id);
        if (!prev) {
          byVideo.set(row.video_id, row);
          continue;
        }
        const keep = prev.collection_type === 'SHARED' ? prev : row.collection_type === 'SHARED' ? row : prev;
        const teams = [...prev.teams, ...row.teams].filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
        byVideo.set(row.video_id, { ...keep, teams });
      }
      return [...byVideo.values()];
    }

    if (isAdminOrManager(roles)) {
      const rows = await this.prisma.videoLibrary.findMany({
        where: { collection_type: 'TEAM' },
        include: TEAMS_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return rows.map(withTeams);
    }

    const teamIds = await this.getUserTeamIds(userId);
    if (teamIds.length === 0) return [];
    const rows = await this.prisma.videoLibrary.findMany({
      where: { collection_type: 'TEAM', teams: { some: { team_id: { in: teamIds } } } },
      include: TEAMS_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return rows.map(withTeams);
  }

  /** Gắn video vào các team (bỏ qua cặp đã có). */
  private async linkTeams(videoLibraryId: string, teamIds: string[]): Promise<void> {
    if (teamIds.length === 0) return;
    await this.prisma.videoLibraryTeam.createMany({
      data: teamIds.map((team_id) => ({ video_library_id: videoLibraryId, team_id })),
      skipDuplicates: true,
    });
  }

  async getSavedVideoIds(): Promise<string[]> {
    const rows = await this.prisma.videoLibrary.findMany({ select: { video_id: true } });
    return rows.map((r) => r.video_id);
  }

  async deleteVideoLibrary(id: string, roles: string[], userId = ''): Promise<void> {
    const row = await this.prisma.videoLibrary.findUnique({ where: { id }, include: { teams: { select: { team_id: true } } } });
    if (!row) throw new NotFoundException('Không tìm thấy video trong bộ sưu tập');

    // ADMIN/MANAGER xoá được mọi video; LEADER chỉ xoá được video tab Team của team mình.
    let allowed = isAdminOrManager(roles);
    if (!allowed && row.collection_type === 'TEAM' && roles.includes('LEADER')) {
      const mine = new Set(await this.getUserTeamIds(userId));
      allowed = row.teams.some((t) => mine.has(t.team_id));
    }
    if (!allowed) throw new ForbiddenException('Không có quyền xoá video này');

    await this.prisma.videoLibrary.delete({ where: { id } });
  }

  // ─── Approved Content ───────────────────────────────────────────────────────

  /** Content kẹt PROCESSING lâu hơn ngần này coi như việc nền đã chết (server khởi động lại giữa chừng). */
  static readonly STALE_PROCESSING_MS = 30 * 60 * 1000;

  /**
   * Việc sinh kịch bản chạy nền trong tiến trình — server khởi động lại giữa chừng thì việc đó
   * mất, dòng Content kẹt mãi ở "Đang xử lý". Lúc khởi động chuyển các dòng kẹt quá lâu sang
   * FAILED để người dùng thấy nút "Thử lại".
   */
  async onModuleInit(): Promise<void> {
    const cutoff = new Date(Date.now() - VideoLibraryService.STALE_PROCESSING_MS);
    const res = await this.prisma.approvedContent
      .updateMany({
        where: { script_status: 'PROCESSING', updated_at: { lt: cutoff } },
        data: { script_status: 'FAILED', script_error: 'Bị gián đoạn khi server khởi động lại — bấm Thử lại.' },
      })
      .catch(() => ({ count: 0 }));
    if (res.count) this.logger.warn(`[VIDEO-LIBRARY] ${res.count} content kẹt "đang xử lý" → FAILED`);
  }

  // ─── Chi phí TikHub / Gemini ────────────────────────────────────────────────

  /**
   * Thống kê chi phí TikHub + Gemini của menu Khám phá Video trong khoảng ngày (giờ VN).
   * Lượt gọi từ trang ngoài menu (page = OTHER) không cộng vào tổng — chỉ báo riêng ở `outside`.
   */
  async getCostStats(dateFrom?: string, dateTo?: string) {
    const range = buildVoiceUsageDateRange(dateFrom, dateTo);
    const allRows = await this.prisma.apiUsageLog.findMany({
      where: range ? { created_at: range } : {},
      orderBy: { created_at: 'desc' },
    });
    const rows = allRows.filter((r) => r.page !== 'OTHER');
    const outsideRows = allRows.filter((r) => r.page === 'OTHER');
    const rate = usdVndRate();
    const money = (usd: number) => ({ cost_usd: Math.round(usd * 1e6) / 1e6, cost_vnd: Math.round(usd * rate) });

    let tikhubUsd = 0, geminiUsd = 0, tikhubPaid = 0, tikhubCached = 0, geminiCalls = 0, geminiIn = 0, geminiOut = 0;
    const byPage = new Map<string, { calls: number; usd: number }>();
    const byFeature = new Map<string, { calls: number; usd: number }>();
    const byPlatform = new Map<string, { calls: number; usd: number }>();
    const byDay = new Map<string, { tikhub_usd: number; gemini_usd: number }>();
    const byUser = new Map<string, { calls: number; usd: number }>();
    const byContent = new Map<string, number>();
    const contentWithGemini = new Set<string>();

    for (const r of rows) {
      const usd = Number(r.cost_usd) || 0;
      const billed = !r.cached;
      const calls = r.calls ?? 1; // AI gộp các lượt giống nhau của một request thành một dòng
      if (r.provider === 'GEMINI') {
        geminiUsd += usd; geminiCalls += calls; geminiIn += r.input_tokens; geminiOut += r.output_tokens;
        if (r.approved_content_id) contentWithGemini.add(r.approved_content_id);
      } else {
        tikhubUsd += usd;
        if (billed && r.http_status === 200) tikhubPaid += calls;
        if (r.cached) tikhubCached += calls;
      }
      const bump = (map: Map<string, { calls: number; usd: number }>, key: string) => {
        const cur = map.get(key) ?? { calls: 0, usd: 0 };
        if (billed) cur.calls += calls;
        cur.usd += usd;
        map.set(key, cur);
      };
      bump(byPage, r.page);
      bump(byFeature, r.feature);
      bump(byPlatform, r.platform || 'khác');
      if (r.user_id) bump(byUser, r.user_id);
      const day = byDay.get(vnDate(r.created_at)) ?? { tikhub_usd: 0, gemini_usd: 0 };
      if (r.provider === 'GEMINI') day.gemini_usd += usd; else day.tikhub_usd += usd;
      byDay.set(vnDate(r.created_at), day);
      if (r.approved_content_id && r.feature !== 'PROPOSAL_DETAIL') {
        byContent.set(r.approved_content_id, (byContent.get(r.approved_content_id) ?? 0) + usd);
      }
    }

    const userIds = [...byUser.keys()];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true, email: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.full_name || u.email]));
    const scriptCosts = [...contentWithGemini].map((id) => byContent.get(id) ?? 0);
    const avgScript = scriptCosts.length ? scriptCosts.reduce((a, b) => a + b, 0) / scriptCosts.length : 0;

    return {
      range: { date_from: dateFrom ?? null, date_to: dateTo ?? null },
      pricing: {
        usd_vnd_rate: rate,
        tikhub_note: 'Giá niêm yết theo từng endpoint của TikHub (chưa trừ chiết khấu bậc thang).',
        gemini_note: 'Ước tính theo số token thật × giá gói trả phí. Khoá đang ở gói miễn phí thì Google chưa thu tiền.',
      },
      totals: {
        ...money(tikhubUsd + geminiUsd),
        tikhub: { ...money(tikhubUsd), paid_calls: tikhubPaid, cached_calls: tikhubCached },
        gemini: { ...money(geminiUsd), calls: geminiCalls, input_tokens: geminiIn, output_tokens: geminiOut },
        scripts: contentWithGemini.size,
        avg_script: money(avgScript),
      },
      by_page: [...byPage.entries()]
        .map(([page, v]) => ({ page, label: COST_PAGE_LABEL[page] ?? page, calls: v.calls, ...money(v.usd) }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      /** Lượt gọi từ trang ngoài Khám phá Video — không cộng vào tổng ở trên */
      outside: {
        ...money(outsideRows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0)),
        calls: outsideRows.reduce((sum, r) => sum + (r.cached ? 0 : r.calls ?? 1), 0),
      },
      by_feature: [...byFeature.entries()]
        .map(([feature, v]) => ({ feature, label: COST_FEATURE_LABEL[feature] ?? feature, calls: v.calls, ...money(v.usd) }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      by_platform: [...byPlatform.entries()]
        .map(([platform, v]) => ({ platform, calls: v.calls, ...money(v.usd) }))
        .sort((a, b) => b.cost_usd - a.cost_usd),
      by_day: [...byDay.entries()]
        .map(([date, v]) => ({ date, tikhub_vnd: Math.round(v.tikhub_usd * rate), gemini_vnd: Math.round(v.gemini_usd * rate) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      by_user: [...byUser.entries()]
        .map(([user_id, v]) => ({ user_id, name: nameOf.get(user_id) ?? user_id, calls: v.calls, ...money(v.usd) }))
        .sort((a, b) => b.cost_usd - a.cost_usd)
        .slice(0, 10),
      recent: rows.slice(0, 30).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        provider: r.provider,
        page: r.page,
        page_label: COST_PAGE_LABEL[r.page] ?? r.page,
        feature: r.feature,
        feature_label: COST_FEATURE_LABEL[r.feature] ?? r.feature,
        calls: r.calls ?? 1,
        endpoint: r.endpoint,
        platform: r.platform,
        cached: r.cached,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        user_name: r.user_id ? nameOf.get(r.user_id) ?? null : null,
        video_id: r.video_id,
        ...money(Number(r.cost_usd) || 0),
      })),
    };
  }

  /** Số dư + chi tiêu hôm nay của tài khoản TikHub (toàn tài khoản). */
  async getTikhubAccount(user: { id: string; email?: string }) {
    const data = await this.aiIntegration.getTikhubAccount(user);
    if (data?.error) return data;
    const rate = usdVndRate();
    return {
      ...data,
      usd_vnd_rate: rate,
      balance_vnd: typeof data?.balance_usd === 'number' ? Math.round(data.balance_usd * rate) : null,
      today_usage_vnd: typeof data?.today?.usage_usd === 'number' ? Math.round(data.today.usage_usd * rate) : null,
    };
  }

  async listApprovedContent() {
    return this.prisma.approvedContent.findMany({ orderBy: { created_at: 'desc' } });
  }

  /** Sinh lại kịch bản cho một content (nút "Thử lại" ở tab Content). */
  async regenerateScript(id: string, user: { id: string; email?: string }, roles: string[]) {
    if (!canReview(roles) && !isAdminOrManager(roles)) {
      throw new ForbiddenException('Chỉ leader/manager/admin được sinh lại kịch bản');
    }
    const row = await this.prisma.approvedContent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy content');
    if (!row.source_video_url) throw new ConflictException('Content này không gắn với video nào để sinh lại.');
    const stale = Date.now() - row.updated_at.getTime() > VideoLibraryService.STALE_PROCESSING_MS;
    if (row.script_status === 'PROCESSING' && !stale) {
      throw new ConflictException('Kịch bản đang được tạo, chờ xong rồi thử lại.');
    }
    const updated = await this.prisma.approvedContent.update({
      where: { id },
      data: { script_status: 'PROCESSING', script_error: null },
    });
    this.trackScriptJob(
      this.generateScriptFor(
        id,
        {
          video_id: row.source_video_id || '',
          platform: row.source_platform || detectPlatformFromUrl(row.source_video_url) || '',
          title: row.source_video_title,
          description: row.source_video_desc,
          video_url: row.source_video_url,
          views_count: 0n,
          likes_count: 0n,
          comments_count: 0n,
        },
        user,
      ),
    );
    return updated;
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
  private async enrichFromPlatform(dto: ProposeVideoDto, userId?: string): Promise<ProposeVideoDto> {
    // Chi phí TikHub của lượt này do chốt chung (common/api-usage) ghi — nhãn cho biết bước nào, của ai
    const detail = await runWithUsageTag(
      { page: 'COLLECTION', feature: 'PROPOSAL_DETAIL', userId, videoId: dto.video_id, platform: dto.platform },
      () => this.aiIntegration.fetchVideoDetail({
        platform: dto.platform,
        videoId: dto.video_id,
        videoUrl: dto.video_url,
      }),
    );
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
        inLibrary.collection_type === 'SHARED'
          ? 'Video này đã có trong Bộ Sưu Tập (Chung).'
          : 'Video này đã có trong Bộ Sưu Tập của một team — xem ở tab Chung.',
      );
    }
  }

  async proposeVideo(memberId: string, inputDto: ProposeVideoDto) {
    const rawDto = await this.resolveVideoRef(inputDto);
    await this.assertNotDuplicate(rawDto);
    const dto = await this.enrichFromPlatform(rawDto, memberId);
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
    await this.notifyReviewersOfProposal(memberId, proposal.title || proposal.video_url);
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
      // Video gắn vào mọi team của NGƯỜI ĐỀ XUẤT; họ không thuộc team nào thì lấy team của
      // leader duyệt, để video không bị "mồ côi" chỉ hiện ở tab Chung.
      const proposerTeams = await this.getUserTeamIds(proposal.requested_by_id);
      const teamIds = proposerTeams.length > 0 ? proposerTeams : await this.getUserTeamIds(reviewerId);
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
        teamIds,
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
      '/dashboard/video-library?tab=mine',
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
    // Leader thêm → gắn vào mọi team của leader đó.
    const teamIds = collectionType === 'TEAM' ? await this.getUserTeamIds(reviewerId) : [];
    if (existing) {
      // Team khác đã có video này: chỉ gắn thêm team của leader này, vẫn không gọi TikHub.
      await this.linkTeams(existing.id, teamIds);
      this.logger.log(`[direct-add] ${rawDto.platform}/${rawDto.video_id} da co trong ${collectionType}, chi gan them team`);
      return { videoLibraryId: existing.id, approvedContentId: null };
    }

    // Leader/admin vào thẳng Bộ Sưu Tập nên càng phải có số liệu thật — không thì bộ sưu tập
    // đầy những dòng 0 lượt xem, 0 tim, không lọc/sắp xếp được.
    const dto = await this.enrichFromPlatform(rawDto, reviewerId);
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
      teamIds,
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
    /** Team sở hữu video ở tab Team (bỏ qua khi video vào tab Chung). */
    teamIds: string[] = [],
  ): Promise<{ videoLibraryId: string; approvedContentId: string | null }> {
    // Có team sở hữu → kho Team của team đó (tab Chung vẫn hiện mọi video), kể cả khi ADMIN duyệt
    // đề xuất của member. Không có team nào (admin tự thêm thẳng) → kho Chung.
    const collectionType = teamIds.length > 0 || !approverRoles.includes('ADMIN') ? 'TEAM' : 'SHARED';
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
    if (collectionType === 'TEAM') await this.linkTeams(libraryRow.id, teamIds);

    // Sinh script CHẠY NỀN, không bắt người bấm ngồi đợi.
    //
    // Trước đây bước này được await ngay tại đây: gọi AI mất ~10-15 giây (timeout tới 120s),
    // cộng với bước lấy số liệu nền tảng thì leader bấm "Thêm vào BST" phải chờ ~15-19 giây
    // mới thấy phản hồi. Mà kết quả của nó vốn đã là "best effort" — lỗi AI không hề rollback
    // VideoLibrary (xem chú thích ở đầu hàm) — nên chẳng có lý do gì phải chặn.
    //
    // Tạo NGAY dòng Content ở trạng thái PROCESSING rồi mới chạy nền: tab Content hiện "Đang tạo
    // kịch bản…" thay vì trống trơn, và lỗi thì dòng thành FAILED kèm lý do + nút "Thử lại"
    // thay vì biến mất không dấu vết như trước.
    const content = await this.prisma.approvedContent.create({
      data: {
        script: '',
        script_status: 'PROCESSING',
        content_type: 'SCRAPED_VIDEO',
        content_type_display: 'Video sưu tầm',
        word_count: 0,
        source_video_id: video.video_id,
        source_video_title: video.title,
        source_video_desc: video.description,
        source_video_url: video.video_url,
        source_platform: video.platform,
        approved_by_id: approverId,
        approved_by_name: approverName,
        approved_by_role: approverRole,
      },
    });
    this.trackScriptJob(this.generateScriptFor(content.id, video, { id: approverId }));

    return { videoLibraryId: libraryRow.id, approvedContentId: content.id };
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

  /**
   * Sinh kịch bản cho một dòng Content (đã tạo sẵn ở PROCESSING).
   *
   * 1. AI tải video + Gemini viết từ lời thoại và hình ảnh (script-from-video).
   * 2. AI trả ENGINE_DISABLED (chưa bật Gemini) hoặc lỗi → quay về cách cũ: viết từ tiêu đề/mô tả.
   * 3. Cả hai hỏng → FAILED kèm lý do để người dùng bấm "Thử lại".
   *
   * Không bao giờ ném ra ngoài: đây là promise chạy nền không ai await.
   */
  private async generateScriptFor(
    contentId: string,
    video: { video_id: string; platform: string; title: string; description: string; video_url: string;
             views_count: bigint; likes_count: bigint; comments_count: bigint },
    approver: { id: string; email?: string },
  ): Promise<void> {
    let voiceError = '';
    let downloadSource: string | null = null;
    try {
      // Chi phí TikHub (tải dự phòng) + Gemini (viết) do chốt chung ghi, gắn content + người duyệt
      const res = await runWithUsageTag(
        { page: 'COLLECTION', feature: 'SCRIPT', userId: approver.id, videoId: video.video_id, platform: video.platform, contentId },
        () => this.aiIntegration.generateScriptFromVideo(
          {
            videoUrl: video.video_url,
            platform: video.platform,
            videoId: video.video_id,
            title: video.title,
            description: video.description,
          },
          approver,
        ),
      );
      downloadSource = res?.download?.ok ? res.download.source ?? null : null;
      if (res?.status === 'DONE' && res.script_text) {
        await this.prisma.approvedContent.update({
          where: { id: contentId },
          data: {
            script: res.script_text,
            word_count: wordCount(res.script_text),
            script_status: 'DONE',
            script_source: res.source === 'gemini_video' ? 'GEMINI_VIDEO' : 'GEMINI_TEXT',
            transcript: res.transcript || null,
            transcript_language: res.language || null,
            has_voice: res.has_voice ?? null,
            script_error: null,
            download_source: downloadSource,
          },
        });
        this.logger.log(`[VIDEO-LIBRARY] Kich ban tu video xong (${res.source}) cho "${video.title.slice(0, 40)}"`);
        return;
      }
      // Cố ý tắt engine không phải lỗi; tắt vì thiếu khoá thì AI gửi `reason` — giữ lại để nếu cách
      // cũ cũng hỏng, người dùng thấy đúng nguyên nhân thay vì chỉ thấy lỗi của cách cũ.
      voiceError = res?.status === 'ENGINE_DISABLED' ? res?.reason || '' : res?.error || 'AI không trả kịch bản';
    } catch (err: any) {
      voiceError = err?.message || String(err);
    }

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
      await this.prisma.approvedContent.update({
        where: { id: contentId },
        data: {
          script,
          word_count: wordCount(script),
          script_status: 'DONE',
          script_source: 'LEGACY_TEXT',
          script_error: voiceError || null,
          download_source: downloadSource,
        },
      });
      this.logger.log(`[VIDEO-LIBRARY] Kich ban cach cu xong cho "${video.title.slice(0, 40)}"`);
    } catch (err: any) {
      const message = [voiceError, err?.message || String(err)].filter(Boolean).join(' | ');
      this.logger.error(`[VIDEO-LIBRARY] Video "${video.title.slice(0, 40)}" sinh kich ban loi: ${message}`);
      try {
        await this.prisma.approvedContent.update({
          where: { id: contentId },
          data: { script_status: 'FAILED', script_error: message.slice(0, 2000), download_source: downloadSource },
        });
      } catch (updateErr: any) {
        // Chặn tuyệt đối: lỗi thoát khỏi promise chạy nền là sập cả tiến trình.
        this.logger.error(`[VIDEO-LIBRARY] Khong ghi duoc trang thai FAILED cho content ${contentId}: ${updateErr?.message}`);
      }
    }
  }
}

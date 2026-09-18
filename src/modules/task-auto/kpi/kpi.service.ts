import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  UpsertTeamKpiDto,
  UpsertEditorKpiDto,
  UpsertEditorDailyKpiDto,
  UpsertContentCreatorKpiDto,
  UpsertContentCreatorDailyKpiDto,
} from "./dto/kpi.dto";
import { runOrNotFound } from "../../../common/utils/prisma-not-found.util";
import { dailyKpiDate } from "../../../utils/date.utils";
import { Semaphore } from "../../../common/utils/semaphore";
import {
  classifyPublishedLinksWinFail,
  summarizeWinFailCounts,
  PublishedLinkWinFailStatus,
} from "../tasks/published-link-win-fail.util";
import { TaskAutoContentWinPushService } from "../tasks/content-win-auto-push.service";
import {
  TaskPublishedLinkStatsService,
  isSupportedLinkStatsPlatform,
  isLinkStatsFresh,
} from "../tasks/task-published-link-stats.service";
import { deadlineWindow } from "../tasks/deadline-window.util";
import {
  productLineCategoryLabel,
  resolveTaskProductLineId,
} from "../tasks/product-line-category.util";
import {
  KPI_PAYROLL_SYNC_CONTRACT_VERSION,
  METRICS_WITHOUT_ACTUAL_SOURCE,
  PRODUCT_CATEGORY_TO_METRIC,
  contentRouteCodeOf,
  mapContentCreator,
  mapEditorContentRoutes,
  mapEditorKpi,
  mergeContributions,
  missingEmployeeIdWarnings,
  type ContentRouteCode,
  type KpiPayrollSyncResponse,
  type KpiPayrollSyncWarning,
  type MetricContribution,
} from "./kpi-payroll-sync.mapper";

@Injectable()
export class TaskAutoKpiService {
  // Giới hạn số task cào traffic ĐỒNG THỜI trong refreshContentWinFailStats() — tránh dội request
  // FB/YouTube (mức 4, đồng bộ với publish.service.ts/warehouse.service.ts).
  private readonly linkRefreshSemaphore = new Semaphore(4);

  constructor(
    private prisma: PrismaService,
    private linkStats: TaskPublishedLinkStatsService,
    private contentWinPush: TaskAutoContentWinPushService,
  ) {}

  // ─── Team KPI ─────────────────────────────────────────────────────────────

  async getTeamKpis(month?: string) {
    return this.prisma.teamKpi.findMany({
      where: month ? { month } : undefined,
      include: {
        team: { select: { id: true, name: true } },
        created_by: { select: { id: true, full_name: true } },
        allocations: {
          include: {
            content_line: { select: { id: true, name: true } },
            product_line: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ month: "desc" }, { team: { name: "asc" } }],
    });
  }

  async upsertTeamKpi(
    dto: UpsertTeamKpiDto,
    userId: string,
    roles: string[] = [],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (isLeaderOnly) {
      const team = await this.prisma.team.findUnique({
        where: { id: dto.team_id },
      });
      if (team?.leader_id !== userId)
        throw new ForbiddenException(
          "LEADER chỉ được đặt KPI cho team của mình",
        );
    }

    const existing = await this.prisma.teamKpi.findUnique({
      where: { team_id_month: { team_id: dto.team_id, month: dto.month } },
    });

    if (existing) {
      await this.prisma.teamKpiAllocation.deleteMany({
        where: { team_kpi_id: existing.id },
      });
      return this.prisma.teamKpi.update({
        where: { id: existing.id },
        data: {
          note: dto.note,
          allocations: { create: dto.allocations.map((a) => ({ ...a })) },
        },
        include: this.kpiInclude,
      });
    }

    return this.prisma.teamKpi.create({
      data: {
        team_id: dto.team_id,
        month: dto.month,
        note: dto.note,
        created_by_id: userId,
        allocations: { create: dto.allocations.map((a) => ({ ...a })) },
      },
      include: this.kpiInclude,
    });
  }

  async deleteTeamKpi(id: string) {
    await runOrNotFound(
      () => this.prisma.teamKpi.delete({ where: { id } }),
      "TeamKpi not found",
    );
    return { success: true };
  }

  // ─── Editor KPI ───────────────────────────────────────────────────────────

  async getEditorKpis(
    month?: string,
    userId?: string,
    currentUser?: { id: string; roles: string[] },
    teamId?: string,
  ) {
    const roles = currentUser?.roles ?? [];
    const isAdminOrManager =
      roles.includes("ADMIN") || roles.includes("MANAGER");
    const isLeader = roles.includes("LEADER") && !isAdminOrManager;
    const isEditorOrMember =
      !isAdminOrManager && !isLeader && !!currentUser?.id;

    let teamFilter: any = undefined;
    let effectiveUserId = userId;
    if (teamId) {
      teamFilter = teamId;
    }

    if (isLeader && currentUser) {
      const myTeams = await this.prisma.team.findMany({
        where: { leader_id: currentUser.id },
        select: { id: true },
      });
      const myTeamIds = myTeams.map((t) => t.id);
      if (teamId && !myTeamIds.includes(teamId)) {
        return [];
      }
      teamFilter = teamId ? teamId : { in: myTeamIds };
    } else if (isEditorOrMember && currentUser) {
      // Editor/Member chỉ được xem KPI của chính mình, không phải cả team.
      effectiveUserId = currentUser.id;
    }

    return this.prisma.editorKpi.findMany({
      where: {
        ...(month ? { month } : {}),
        ...(effectiveUserId ? { user_id: effectiveUserId } : {}),
        ...(teamFilter !== undefined ? { team_id: teamFilter } : {}),
      },
      include: this.editorKpiInclude,
      orderBy: [{ month: "desc" }, { user: { full_name: "asc" } }],
    });
  }

  async upsertEditorKpi(
    dto: UpsertEditorKpiDto,
    setById: string,
    roles: string[] = [],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (isLeaderOnly) {
      // Leader chỉ được đặt KPI cho editor thuộc đúng team được chỉ định
      const myTeam = await this.prisma.team.findFirst({
        where: { id: dto.team_id, leader_id: setById },
      });
      if (!myTeam)
        throw new ForbiddenException(
          "Bạn không phải leader của team này",
        );
      const isMember = await this.prisma.teamMember.findFirst({
        where: { team_id: dto.team_id, user_id: dto.user_id },
      });
      if (!isMember)
        throw new ForbiddenException("Người dùng không thuộc team của bạn");
    }

    const contentQty = dto.allocations
      .filter((a) => a.type === "CONTENT_LINE")
      .reduce((s, a) => s + a.quantity, 0);
    const productQty = dto.allocations
      .filter((a) => a.type === "PRODUCT_LINE")
      .reduce((s, a) => s + a.quantity, 0);
    if (contentQty > 0 && contentQty !== dto.total_target)
      throw new BadRequestException(
        `Tổng số video theo tuyến nội dung phải bằng tổng video sản xuất (${dto.total_target}), hiện là ${contentQty}`,
      );
    if (productQty > 0 && productQty !== dto.product_planned)
      throw new BadRequestException(
        `Tổng số video theo dòng sản phẩm phải bằng SP đẩy video theo kế hoạch (${dto.product_planned}), hiện là ${productQty}`,
      );

    const kpiData = {
      total_target: dto.total_target,
      video_win: dto.video_win ?? 0,
      video_fail: dto.video_fail ?? 0,
      kpi_extra: dto.kpi_extra ?? 0,
      content_new: dto.content_new ?? 0,
      content_collected: dto.content_collected ?? 0,
      content_win_cover: dto.content_win_cover ?? 0,
      product_planned: dto.product_planned ?? 0,
      product_win_collect: dto.product_win_collect ?? 0,
      product_profit: dto.product_profit ?? 0,
      set_by_id: setById,
    };

    const existing = await this.prisma.editorKpi.findUnique({
      where: {
        user_id_team_id_month: {
          user_id: dto.user_id,
          team_id: dto.team_id,
          month: dto.month,
        },
      },
    });

    if (existing) {
      await this.prisma.editorKpiAllocation.deleteMany({
        where: { editor_kpi_id: existing.id },
      });
      return this.prisma.editorKpi.update({
        where: { id: existing.id },
        data: {
          ...kpiData,
          allocations: { create: dto.allocations.map((a) => ({ ...a })) },
        },
        include: this.editorKpiInclude,
      });
    }

    return this.prisma.editorKpi.create({
      data: {
        user_id: dto.user_id,
        team_id: dto.team_id,
        month: dto.month,
        ...kpiData,
        allocations: { create: dto.allocations.map((a) => ({ ...a })) },
      },
      include: this.editorKpiInclude,
    });
  }

  async deleteEditorKpi(id: string) {
    await runOrNotFound(
      () => this.prisma.editorKpi.delete({ where: { id } }),
      "EditorKpi not found",
    );
    return { success: true };
  }

  // ─── Editor Daily KPI ─────────────────────────────────────────────────────

  async getEditorDailyKpis(params: {
    date?: string;
    from?: string;
    to?: string;
    team_id?: string;
    user_id?: string;
  }) {
    const { date, from, to, team_id, user_id } = params;
    return this.prisma.editorDailyKpi.findMany({
      where: {
        ...(date
          ? { date: dailyKpiDate(date) }
          : from || to
            ? {
                date: {
                  ...(from ? { gte: dailyKpiDate(from) } : {}),
                  ...(to ? { lte: dailyKpiDate(to) } : {}),
                },
              }
            : {}),
        ...(team_id ? { team_id } : {}),
        ...(user_id ? { user_id } : {}),
      },
      include: this.editorDailyKpiInclude,
      orderBy: [{ date: "desc" as const }, { user: { full_name: "asc" as const } }],
    });
  }

  // Upsert theo lô (cả team cho 1 ngày) — UI lưu nguyên bảng một lần.
  async upsertEditorDailyKpis(
    dto: UpsertEditorDailyKpiDto,
    setById: string,
    roles: string[] = [],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (isLeaderOnly) {
      const myTeam = await this.prisma.team.findFirst({
        where: { id: dto.team_id, leader_id: setById },
      });
      if (!myTeam)
        throw new ForbiddenException("Bạn không phải leader của team này");
    }

    const members = await this.prisma.teamMember.findMany({
      where: {
        team_id: dto.team_id,
        user_id: { in: dto.entries.map((e) => e.user_id) },
      },
      select: { user_id: true },
    });
    const memberSet = new Set(members.map((m) => m.user_id));
    if (dto.entries.some((e) => !memberSet.has(e.user_id)))
      throw new BadRequestException(
        "Có người dùng không thuộc team được chọn",
      );

    const day = dailyKpiDate(dto.date);
    return this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.editorDailyKpi.upsert({
          where: {
            user_id_team_id_date: {
              user_id: e.user_id,
              team_id: dto.team_id,
              date: day,
            },
          },
          update: { target: e.target, note: e.note ?? null, set_by_id: setById },
          create: {
            user_id: e.user_id,
            team_id: dto.team_id,
            date: day,
            target: e.target,
            note: e.note,
            set_by_id: setById,
          },
          include: this.editorDailyKpiInclude,
        }),
      ),
    );
  }

  async deleteEditorDailyKpi(id: string) {
    await runOrNotFound(
      () => this.prisma.editorDailyKpi.delete({ where: { id } }),
      "EditorDailyKpi not found",
    );
    return { success: true };
  }

  // ─── Content Creator KPI (target tháng thủ công) ─────────────────────────

  async getContentCreatorKpis(month?: string, userId?: string) {
    return this.prisma.contentCreatorKpi.findMany({
      where: {
        ...(month ? { month } : {}),
        ...(userId ? { user_id: userId } : {}),
      },
      include: this.contentCreatorKpiInclude,
      orderBy: [{ month: "desc" }, { user: { full_name: "asc" } }],
    });
  }

  private async assertLeaderOwnsTeamMember(
    teamId: string,
    userId: string,
    setById: string,
    roles: string[],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (!isLeaderOnly) return;
    const myTeam = await this.prisma.team.findFirst({
      where: { id: teamId, leader_id: setById },
    });
    if (!myTeam)
      throw new ForbiddenException("Bạn không phải leader của team này");
    const isMember = await this.prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: userId },
    });
    if (!isMember)
      throw new ForbiddenException("Người dùng không thuộc team của bạn");
  }

  async upsertContentCreatorKpi(
    dto: UpsertContentCreatorKpiDto,
    setById: string,
    roles: string[] = [],
  ) {
    await this.assertLeaderOwnsTeamMember(dto.team_id, dto.user_id, setById, roles);

    const kpiData = {
      content_target: dto.content_target ?? 0,
      translation_target: dto.translation_target ?? 0,
      note: dto.note,
      set_by_id: setById,
    };

    const existing = await this.prisma.contentCreatorKpi.findUnique({
      where: {
        user_id_team_id_month: {
          user_id: dto.user_id,
          team_id: dto.team_id,
          month: dto.month,
        },
      },
    });

    if (existing) {
      return this.prisma.contentCreatorKpi.update({
        where: { id: existing.id },
        data: kpiData,
        include: this.contentCreatorKpiInclude,
      });
    }

    return this.prisma.contentCreatorKpi.create({
      data: {
        user_id: dto.user_id,
        team_id: dto.team_id,
        month: dto.month,
        ...kpiData,
      },
      include: this.contentCreatorKpiInclude,
    });
  }

  async deleteContentCreatorKpi(id: string) {
    await runOrNotFound(
      () => this.prisma.contentCreatorKpi.delete({ where: { id } }),
      "ContentCreatorKpi not found",
    );
    return { success: true };
  }

  // ─── Content Creator Daily KPI ────────────────────────────────────────────

  async getContentCreatorDailyKpis(params: {
    date?: string;
    from?: string;
    to?: string;
    team_id?: string;
    user_id?: string;
  }) {
    const { date, from, to, team_id, user_id } = params;
    return this.prisma.contentCreatorDailyKpi.findMany({
      where: {
        ...(date
          ? { date: dailyKpiDate(date) }
          : from || to
            ? {
                date: {
                  ...(from ? { gte: dailyKpiDate(from) } : {}),
                  ...(to ? { lte: dailyKpiDate(to) } : {}),
                },
              }
            : {}),
        ...(team_id ? { team_id } : {}),
        ...(user_id ? { user_id } : {}),
      },
      include: this.contentCreatorDailyKpiInclude,
      orderBy: [{ date: "desc" as const }, { user: { full_name: "asc" as const } }],
    });
  }

  async upsertContentCreatorDailyKpis(
    dto: UpsertContentCreatorDailyKpiDto,
    setById: string,
    roles: string[] = [],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (isLeaderOnly) {
      const myTeam = await this.prisma.team.findFirst({
        where: { id: dto.team_id, leader_id: setById },
      });
      if (!myTeam)
        throw new ForbiddenException("Bạn không phải leader của team này");
    }

    const members = await this.prisma.teamMember.findMany({
      where: {
        team_id: dto.team_id,
        user_id: { in: dto.entries.map((e) => e.user_id) },
      },
      select: { user_id: true },
    });
    const memberSet = new Set(members.map((m) => m.user_id));
    if (dto.entries.some((e) => !memberSet.has(e.user_id)))
      throw new BadRequestException(
        "Có người dùng không thuộc team được chọn",
      );

    const day = dailyKpiDate(dto.date);
    return this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.contentCreatorDailyKpi.upsert({
          where: {
            user_id_team_id_date: {
              user_id: e.user_id,
              team_id: dto.team_id,
              date: day,
            },
          },
          update: { target: e.target, note: e.note ?? null, set_by_id: setById },
          create: {
            user_id: e.user_id,
            team_id: dto.team_id,
            date: day,
            target: e.target,
            note: e.note,
            set_by_id: setById,
          },
          include: this.contentCreatorDailyKpiInclude,
        }),
      ),
    );
  }

  async deleteContentCreatorDailyKpi(id: string) {
    await runOrNotFound(
      () => this.prisma.contentCreatorDailyKpi.delete({ where: { id } }),
      "ContentCreatorDailyKpi not found",
    );
    return { success: true };
  }

  // ─── Content Creator KPI Report (tự tính từ dữ liệu thật) ─────────────────

  private parseFromTo(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
    if (!from && !to) return null;
    const range: { gte?: Date; lt?: Date } = {};
    if (from) {
      const [y, m, d] = from.split("-").map(Number);
      if (y && m && d) range.gte = new Date(y, m - 1, d);
    }
    if (to) {
      const [y, m, d] = to.split("-").map(Number);
      if (y && m && d) range.lt = new Date(y, m - 1, d + 1);
    }
    return range;
  }

  async getContentCreatorKpiReport(params: {
    user_id?: string;
    team_id?: string;
    /** Ghi đè việc resolve userIds từ user_id/team_id — khi caller đã biết chính xác tập user
     * (vd getTopContentWinFailMembers() báo cáo toàn hệ thống). user_id/team_id vẫn như cũ khi
     * bỏ trống user_ids. */
    user_ids?: string[];
    from?: string;
    to?: string;
    range?: { gte?: Date; lt?: Date } | null;
  }) {
    const { user_id, team_id, user_ids, from, to } = params;
    if (!user_id && !team_id && !user_ids?.length)
      throw new BadRequestException("Cần truyền user_id, team_id hoặc user_ids");

    const userIds = user_ids?.length
      ? user_ids
      : user_id
      ? [user_id]
      : (
          await this.prisma.teamMember.findMany({
            where: { team_id },
            select: { user_id: true },
          })
        ).map((m) => m.user_id);

    if (userIds.length === 0) return [];

    const range = params.range !== undefined ? params.range : this.parseFromTo(from, to);

    const [users, collectedGroups, translationGroups, tasks] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, full_name: true },
      }),
      this.prisma.teamContent.groupBy({
        by: ["added_by_id"],
        where: {
          added_by_id: { in: userIds },
          ...(team_id ? { team_id } : {}),
          ...(range ? { added_at: range } : {}),
        },
        _count: { id: true },
      }),
      this.prisma.contentTranslation.groupBy({
        by: ["translated_by_id"],
        where: {
          translated_by_id: { in: userIds },
          ...(range ? { created_at: range } : {}),
        },
        _count: { id: true },
      }),
      this.prisma.task.findMany({
        where: {
          status: { not: "CANCELLED" },
          ...(range ? { created_at: range } : {}),
          OR: [
            { team_content: { added_by_id: { in: userIds } } },
            { content: { source_team_content: { added_by_id: { in: userIds } } } },
          ],
        },
        select: {
          id: true,
          status: true,
          published_links: true,
          assignee: { select: { id: true, full_name: true } },
          team_content: { select: { added_by_id: true, code: true, title: true } },
          content: {
            select: {
              id: true,
              code: true,
              title: true,
              source_team_content: { select: { added_by_id: true } },
            },
          },
        },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const collectedMap = new Map(collectedGroups.map((g) => [g.added_by_id, g._count.id]));
    const translationMap = new Map(translationGroups.map((g) => [g.translated_by_id, g._count.id]));

    const videosByUser = new Map<string, any[]>();
    for (const task of tasks) {
      const ownerId = task.team_content?.added_by_id ?? task.content?.source_team_content?.added_by_id;
      if (!ownerId || !userIds.includes(ownerId)) continue;
      const list = videosByUser.get(ownerId) ?? [];
      list.push({
        task_id: task.id,
        status: task.status,
        content_id: task.content?.id ?? null,
        content_code: task.content?.code ?? task.team_content?.code ?? null,
        content_title: task.content?.title ?? task.team_content?.title ?? null,
        editor: task.assignee,
        published_links: task.published_links,
      });
      videosByUser.set(ownerId, list);
    }

    return userIds.map((uid) => {
      const videos = videosByUser.get(uid) ?? [];
      return {
        user_id: uid,
        user: userMap.get(uid) ?? null,
        content_collected: collectedMap.get(uid) ?? 0,
        translations_count: translationMap.get(uid) ?? 0,
        videos_made: videos.length,
        videos,
      };
    });
  }

  // ── Content Win/Fail Stats (tự tính: 1 link bài đăng FB/YouTube/IG > VIEW_WIN_THRESHOLD view) ──
  // Tách biệt hoàn toàn EditorKpi.video_win/fail và content-report/ContentVideo.status (đều nhập tay).
  //
  // MỘT cơ chế cho MỌI thành viên, không phân biệt content creator/editor: "content được gắn
  // task trong kỳ" — creator: content họ thêm (added_by_id) dùng ở bất kỳ task nào; editor:
  // content gắn vào task họ được giao (assignee_id). Gộp theo user_id, dedupe theo task_id nên
  // 1 người vừa là creator vừa là editor của cùng 1 task chỉ tính 1 lần.
  async getContentWinFailStats(params: {
    user_id?: string;
    team_id?: string;
    from?: string;
    to?: string;
  }) {
    const { user_id, team_id, from, to } = params;
    if (!user_id && !team_id)
      throw new BadRequestException("Cần truyền user_id hoặc team_id");

    const userIds = user_id
      ? [user_id]
      : (
          await this.prisma.teamMember.findMany({
            where: { team_id },
            select: { user_id: true },
          })
        ).map((m) => m.user_id);

    if (userIds.length === 0) return { by_member: [], totals: { win: 0, fail: 0, pending: 0 } };

    // Nguồn 1 — content creator: tái dùng nguyên getContentCreatorKpiReport() đã có sẵn logic
    // resolve đúng người ghi công + published_links, chỉ hậu xử lý thêm win/fail.
    const creatorReport = await this.getContentCreatorKpiReport({ user_id, team_id, from, to });
    const range = this.parseFromTo(from, to);
    const by_member = await this.mergeWinFailByMember(userIds, creatorReport, range);

    const totals = by_member.reduce(
      (s, m) => ({ win: s.win + m.win, fail: s.fail + m.fail, pending: s.pending + m.pending }),
      { win: 0, fail: 0, pending: 0 },
    );

    return { by_member, totals };
  }

  // Top N người nhiều content WIN nhất TOÀN HỆ THỐNG — mặc định cho ADMIN/MANAGER ở trang Tổng
  // quan, khỏi bắt chọn team trước. `totals` phản ánh toàn hệ thống (trước khi cắt top N);
  // `by_member` chỉ top N đã lọc bỏ người toàn 0.
  async getTopContentWinFailMembers(params: { from?: string; to?: string; limit?: number }) {
    const { from, to, limit = 5 } = params;

    const allUserIds = (
      await this.prisma.teamMember.findMany({
        select: { user_id: true },
        distinct: ["user_id"],
      })
    ).map((m) => m.user_id);

    if (allUserIds.length === 0) return { by_member: [], totals: { win: 0, fail: 0, pending: 0 } };

    const creatorReport = await this.getContentCreatorKpiReport({ user_ids: allUserIds, from, to });
    const range = this.parseFromTo(from, to);
    const allMembers = await this.mergeWinFailByMember(allUserIds, creatorReport, range);

    const totals = allMembers.reduce(
      (s, m) => ({ win: s.win + m.win, fail: s.fail + m.fail, pending: s.pending + m.pending }),
      { win: 0, fail: 0, pending: 0 },
    );

    const by_member = allMembers
      .filter((m) => m.win + m.fail + m.pending > 0)
      .sort((a, b) => b.win - a.win || a.fail - b.fail || b.pending - a.pending)
      .slice(0, limit);

    return { by_member, totals };
  }

  // Gộp video theo user_id từ 2 nguồn (creator qua added_by_id + editor qua assignee_id), dedupe
  // theo task_id. Dùng chung cho getContentWinFailStats (1 team/người) và
  // getTopContentWinFailMembers (toàn hệ thống) — chỉ khác tập userIds/creatorReport.
  private async mergeWinFailByMember(
    userIds: string[],
    creatorReport: Array<{ user_id: string; user: any; videos: any[] }>,
    range: { gte?: Date; lt?: Date } | null,
  ) {
    const [users, editorTasks] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, full_name: true },
      }),
      this.prisma.task.findMany({
        where: {
          assignee_id: { in: userIds },
          status: "APPROVED",
          ...(range ? { reviewed_at: range } : {}),
        },
        select: {
          id: true,
          assignee_id: true,
          published_links: true,
          content: { select: { code: true, title: true } },
          team_content: { select: { code: true, title: true } },
          editor_content: { select: { code: true, title: true } },
        },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const videosByUser = new Map<string, Map<string, any>>();
    const addVideo = (uid: string, taskId: string, video: any) => {
      const existing = videosByUser.get(uid) ?? new Map<string, any>();
      if (!existing.has(taskId)) existing.set(taskId, video);
      videosByUser.set(uid, existing);
    };

    for (const row of creatorReport) {
      for (const v of row.videos as any[]) {
        const wf = classifyPublishedLinksWinFail(v.published_links);
        addVideo(row.user_id, v.task_id, {
          task_id: v.task_id,
          content_title: v.content_title,
          content_code: v.content_code,
          published_links: v.published_links,
          win_status_auto: wf.status,
          views_auto: wf.views,
        });
      }
    }
    for (const t of editorTasks) {
      if (!t.assignee_id) continue;
      const wf = classifyPublishedLinksWinFail(t.published_links as any);
      addVideo(t.assignee_id, t.id, {
        task_id: t.id,
        content_title: t.content?.title ?? t.team_content?.title ?? t.editor_content?.title ?? null,
        content_code: t.content?.code ?? t.team_content?.code ?? t.editor_content?.code ?? null,
        published_links: t.published_links,
        win_status_auto: wf.status,
        views_auto: wf.views,
      });
    }

    return userIds.map((uid) => {
      const videos = Array.from(videosByUser.get(uid)?.values() ?? []);
      const counts = summarizeWinFailCounts(videos.map((v: any) => v.win_status_auto as PublishedLinkWinFailStatus));
      return { user_id: uid, user: userMap.get(uid) ?? null, ...counts, videos };
    });
  }

  // Cào lại traffic (SUPPORTED_LINK_STATS_PLATFORMS) cho content trong `byMember` rồi ghi lại
  // published_links. Dùng chung cho cả 2 route "Cập nhật" (team/người cụ thể + Top N).
  //
  // Chỉ chạy khi người dùng CHỦ ĐỘNG bấm "Cập nhật" — không tự động khi xem chi tiết (từng gây
  // dội request FB/YouTube khi admin duyệt qua nhiều người). Số mặc định lấy từ cron 8:15
  // (refreshMonthlyPublishedLinkStats). 2 lớp chống dội dù bấm nhiều lần:
  //  1. Bỏ qua link đã cào trong LINK_STATS_FRESH_MS gần nhất (isLinkStatsFresh).
  //  2. Giới hạn số task cào đồng thời qua linkRefreshSemaphore.
  private async refreshPublishedLinksForMembers(
    byMember: Array<{ videos: Array<{ task_id: string; published_links: any }> }>,
  ) {
    const linksByTask = new Map<string, any[]>();
    for (const member of byMember) {
      for (const v of member.videos) {
        if (!linksByTask.has(v.task_id)) linksByTask.set(v.task_id, v.published_links ?? []);
      }
    }

    const now = new Date();
    await Promise.all(
      Array.from(linksByTask.entries()).map(([taskId, links]) =>
        this.linkRefreshSemaphore.run(async () => {
          let changed = false;
          const nextLinks = await Promise.all(
            (links as any[]).map(async (l) => {
              if (!isSupportedLinkStatsPlatform(l.platform)) return l;
              if (isLinkStatsFresh(l.stats, now)) return l; // vừa cào gần đây — khỏi gọi lại.
              changed = true;
              try {
                const stats = await this.linkStats.fetchStatsForLink(l.platform, l.url);
                return { ...l, stats };
              } catch {
                return l; // 1 link lỗi không chặn các link/task còn lại — giữ nguyên số cũ cho link đó.
              }
            }),
          );
          if (!changed) return;
          try {
            await this.prisma.task.update({ where: { id: taskId }, data: { published_links: nextLinks } });
          } catch {
            // Task có thể đã bị xoá/đổi trạng thái giữa lúc đọc và lúc ghi — bỏ qua, không chặn task khác.
          }
        }),
      ),
    );
  }

  // Nút "Cập nhật" (scope 1 người/1 team) — gọi getContentWinFailStats() 2 lần (trước để biết
  // link cần cào, sau để trả số mới); rẻ vì chi phí thật nằm ở gọi API ngoài, không phải JS.
  async refreshContentWinFailStats(params: {
    user_id?: string;
    team_id?: string;
    from?: string;
    to?: string;
  }) {
    const before = await this.getContentWinFailStats(params);
    await this.refreshPublishedLinksForMembers(before.by_member);
    await this.autoPushWinningContent(before.by_member);
    return this.getContentWinFailStats(params);
  }

  // Sau khi cào traffic, task nào vừa thành content-win thì TỰ đẩy content lên kho tổng. Bước
  // đẩy lỗi không chặn luồng trả thống kê.
  private async autoPushWinningContent(
    byMember: Array<{ videos: Array<{ task_id: string }> }>,
  ) {
    const taskIds = byMember.flatMap((m) => m.videos.map((v) => v.task_id));
    if (taskIds.length === 0) return;
    await this.contentWinPush
      .pushWinningTasks(taskIds)
      .catch(() => undefined);
  }

  // Nút "Cập nhật" khi xem bảng xếp hạng Top N toàn hệ thống — chỉ cào lại traffic cho content
  // thuộc top N ĐANG HIỂN THỊ (không phải toàn hệ thống) để giữ chi phí mỗi lần bấm chấp nhận được.
  async refreshTopContentWinFailMembers(params: { from?: string; to?: string; limit?: number }) {
    const before = await this.getTopContentWinFailMembers(params);
    await this.refreshPublishedLinksForMembers(before.by_member);
    await this.autoPushWinningContent(before.by_member);
    return this.getTopContentWinFailMembers(params);
  }

  private kpiInclude = {
    team: { select: { id: true, name: true } },
    created_by: { select: { id: true, full_name: true } },
    allocations: {
      include: {
        content_line: { select: { id: true, name: true } },
        product_line: { select: { id: true, name: true } },
      },
    },
  };

  private editorKpiInclude = {
    user: { select: { id: true, full_name: true, email: true } },
    set_by: { select: { id: true, full_name: true } },
    team: { select: { id: true, name: true } },
    allocations: {
      include: {
        content_line: { select: { id: true, name: true } },
        product_line: { select: { id: true, name: true } },
      },
    },
  };

  private editorDailyKpiInclude = {
    user: { select: { id: true, full_name: true, email: true } },
    set_by: { select: { id: true, full_name: true } },
    team: { select: { id: true, name: true } },
  };

  private contentCreatorKpiInclude = {
    user: { select: { id: true, full_name: true, email: true } },
    set_by: { select: { id: true, full_name: true } },
    team: { select: { id: true, name: true } },
  };

  private contentCreatorDailyKpiInclude = {
    user: { select: { id: true, full_name: true, email: true } },
    set_by: { select: { id: true, full_name: true } },
    team: { select: { id: true, name: true } },
  };

  private monthRangeVN(month: string): { gte: Date; lt: Date } {
    const start = DateTime.fromFormat(month, "yyyy-MM", {
      zone: "Asia/Ho_Chi_Minh",
    }).startOf("month");
    return { gte: start.toJSDate(), lt: start.plus({ months: 1 }).toJSDate() };
  }

  private async buildEditorReportActuals(
    tasks: Array<{
      assignee_id: string | null;
      content_line_id: string | null;
      product_line_id: string | null;
      product_id: string | null;
      editor_product_id: string | null;
      team_product_id: string | null;
    }>,
  ): Promise<{
    byUser: Map<
      string,
      {
        videos_approved: number;
        routes: Partial<Record<ContentRouteCode, number>>;
        products: Record<string, number>;
      }
    >;
    unmappedProductCategories: string[];
  }> {
    const byUser = new Map<
      string,
      {
        videos_approved: number;
        routes: Partial<Record<ContentRouteCode, number>>;
        products: Record<string, number>;
      }
    >();
    const unmapped = new Set<string>();
    if (tasks.length === 0) return { byUser, unmappedProductCategories: [] };

    const idsOf = (pick: (t: (typeof tasks)[number]) => string | null) => [
      ...new Set(tasks.map(pick).filter((id): id is string => !!id)),
    ];
    const productIds = idsOf((t) => t.product_id);
    const editorProductIds = idsOf((t) => t.editor_product_id);
    const teamProductIds = idsOf((t) => t.team_product_id);

    const [contentLines, productLines, products, editorProducts, teamProducts] = await Promise.all([
      this.prisma.contentLine.findMany({ select: { id: true, name: true, a_type: true } }),
      this.prisma.productLine.findMany({
        select: { id: true, name: true, video_category: true },
      }),
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, product_line_id: true },
          })
        : Promise.resolve([]),
      editorProductIds.length
        ? this.prisma.editorProduct.findMany({
            where: { id: { in: editorProductIds } },
            select: { id: true, product_line_id: true },
          })
        : Promise.resolve([]),
      teamProductIds.length
        ? this.prisma.teamProduct.findMany({
            where: { id: { in: teamProductIds } },
            select: { id: true, product_line_id: true },
          })
        : Promise.resolve([]),
    ]);

    const routeByLineId = new Map(
      contentLines.map((cl) => [cl.id, contentRouteCodeOf(cl)] as const),
    );
    const categoryByLineId = new Map(
      productLines.map((pl) => [pl.id, productLineCategoryLabel(pl)] as const),
    );
    const lookup = {
      byProductId: new Map(products.map((p) => [p.id, p.product_line_id])),
      byEditorProductId: new Map(editorProducts.map((p) => [p.id, p.product_line_id])),
      byTeamProductId: new Map(teamProducts.map((p) => [p.id, p.product_line_id])),
    };

    for (const task of tasks) {
      const uid = task.assignee_id;
      if (!uid) continue;
      const acc =
        byUser.get(uid) ?? { videos_approved: 0, routes: {}, products: {} };
      acc.videos_approved += 1;

      const route = task.content_line_id ? routeByLineId.get(task.content_line_id) : null;
      if (route) acc.routes[route] = (acc.routes[route] ?? 0) + 1;

      const lineId = resolveTaskProductLineId(task, lookup);
      const category = lineId ? categoryByLineId.get(lineId) : undefined;
      if (category) {
        const metric = PRODUCT_CATEGORY_TO_METRIC[category];
        if (metric) acc.products[metric] = (acc.products[metric] ?? 0) + 1;
        else unmapped.add(category);
      }

      byUser.set(uid, acc);
    }

    return { byUser, unmappedProductCategories: [...unmapped].sort() };
  }

  async getTeamKpiPayrollSync(
    teamId: string,
    month: string,
  ): Promise<KpiPayrollSyncResponse> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    if (!team) throw new NotFoundException("Team not found");

    const range = this.monthRangeVN(month);

    const [editorKpis, creatorKpis, creatorMembers] = await Promise.all([
      this.prisma.editorKpi.findMany({
        where: { team_id: teamId, month },
        select: {
          user_id: true,
          total_target: true,
          video_win: true,
          video_fail: true,
          content_new: true,
          content_collected: true,
          content_win_cover: true,
          product_planned: true,
          product_win_collect: true,
          product_profit: true,
          user: { select: { id: true, employee_id: true } },
          allocations: {
            select: {
              type: true,
              quantity: true,
              content_line: { select: { id: true, a_type: true, name: true } },
            },
          },
        },
        orderBy: { user_id: "asc" },
      }),
      this.prisma.contentCreatorKpi.findMany({
        where: { team_id: teamId, month },
        select: {
          user_id: true,
          content_target: true,
          translation_target: true,
          user: { select: { id: true, employee_id: true } },
        },
        orderBy: { user_id: "asc" },
      }),
      this.prisma.teamMember.findMany({
        where: { team_id: teamId, is_content_creator: true },
        select: { user_id: true, user: { select: { id: true, employee_id: true } } },
        orderBy: { user_id: "asc" },
      }),
    ]);

    const employeeIds = new Map<string, string | null>();
    for (const row of [...editorKpis, ...creatorKpis, ...creatorMembers])
      employeeIds.set(row.user_id, row.user?.employee_id ?? null);

    const creatorIds = Array.from(
      new Set([...creatorMembers.map((m) => m.user_id), ...creatorKpis.map((k) => k.user_id)]),
    ).sort();

    const editorIds = editorKpis.map((k) => k.user_id);

    const [approvedTasks, editorWinFail, memberships] = await Promise.all([
      editorIds.length
        ? this.prisma.task.findMany({
            where: {
              team_id: teamId,
              assignee_id: { in: editorIds },
              status: "APPROVED",
              ...deadlineWindow(range),
            },
            select: {
              assignee_id: true,
              content_line_id: true,
              product_line_id: true,
              product_id: true,
              editor_product_id: true,
              team_product_id: true,
            },
          })
        : Promise.resolve([]),
      editorIds.length ? this.mergeWinFailByMember(editorIds, [], range) : Promise.resolve([]),
      editorIds.length || creatorIds.length
        ? this.prisma.teamMember.findMany({
            where: { user_id: { in: [...new Set([...editorIds, ...creatorIds])] } },
            select: { user_id: true, team_id: true },
          })
        : Promise.resolve([] as Array<{ user_id: string; team_id: string }>),
    ]);

    const editorActuals = await this.buildEditorReportActuals(approvedTasks);

    const teamsPerUser = new Map<string, Set<string>>();
    for (const m of memberships) {
      const set = teamsPerUser.get(m.user_id) ?? new Set<string>();
      set.add(m.team_id);
      teamsPerUser.set(m.user_id, set);
    }
    const inMultipleTeams = (uid: string) => (teamsPerUser.get(uid)?.size ?? 0) > 1;

    const warnings: KpiPayrollSyncWarning[] = [];
    const contributions: MetricContribution[] = [];

    const editorWinFailByUser = new Map(editorWinFail.map((r) => [r.user_id, r]));

    for (const kpi of editorKpis) {
      const wf = editorWinFailByUser.get(kpi.user_id);
      const report = editorActuals.byUser.get(kpi.user_id);
      contributions.push(
        ...mapEditorKpi(kpi, {
          videos_approved: report?.videos_approved ?? 0,
          win: wf?.win ?? 0,
          fail: wf?.fail ?? 0,
          product_gmv: report?.products.PRODUCT_PLANNED ?? 0,
          product_traffic: report?.products.PRODUCT_COLLECTED ?? 0,
          product_profit: report?.products.PRODUCT_PROFIT ?? 0,
        }),
      );
      const routes = mapEditorContentRoutes(kpi, report?.routes ?? {});
      contributions.push(...routes.contributions);
      warnings.push(...routes.warnings);

      if (inMultipleTeams(kpi.user_id))
        warnings.push({
          code: "UNSCOPED_EDITOR_ACTUAL",
          user_id: kpi.user_id,
          message:
            "User thuộc nhiều team; actual VIDEO_WIN/VIDEO_FAIL chưa quy được chính xác cho một team",
        });
    }

    if (editorKpis.length > 0)
      warnings.push({
        code: "NO_ACTUAL_SOURCE",
        message: `Chưa có nguồn báo cáo cho actual của: ${METRICS_WITHOUT_ACTUAL_SOURCE.join(
          ", ",
        )} — các metric này chỉ có target, actual = null`,
      });

    if (editorActuals.unmappedProductCategories.length > 0)
      warnings.push({
        code: "UNKNOWN_PRODUCT_LINE_CATEGORY",
        message: `Dòng sản phẩm không khớp GMV/Traffic/Profit nên không tính vào metric nào: ${editorActuals.unmappedProductCategories.join(
          ", ",
        )}`,
      });

    if (creatorIds.length > 0) {
      const creatorReport = await this.getContentCreatorKpiReport({
        user_ids: creatorIds,
        team_id: teamId,
        range,
      });
      const winFail = await this.mergeWinFailByMember(creatorIds, creatorReport, range);

      const reportByUser = new Map(creatorReport.map((r) => [r.user_id, r]));
      const winFailByUser = new Map(winFail.map((r) => [r.user_id, r]));
      const targetByUser = new Map(creatorKpis.map((k) => [k.user_id, k]));

      for (const uid of creatorIds) {
        const report = reportByUser.get(uid);
        const wf = winFailByUser.get(uid);
        const target = targetByUser.get(uid);

        contributions.push(
          ...mapContentCreator({
            user_id: uid,
            target: target
              ? {
                  content_target: target.content_target,
                  translation_target: target.translation_target,
                }
              : null,
            actual: report
              ? {
                  content_collected: report.content_collected,
                  translations_count: report.translations_count,
                  videos_made: report.videos_made,
                  win: wf?.win ?? 0,
                  fail: wf?.fail ?? 0,
                }
              : null,
          }),
        );

        if (inMultipleTeams(uid))
          warnings.push({
            code: "UNSCOPED_CREATOR_ACTUAL",
            user_id: uid,
            message:
              "User thuộc nhiều team; actual bản dịch/video/win/fail chưa quy được chính xác cho một team",
          });
      }
    }

    const { records, warnings: mergeWarnings } = mergeContributions(contributions, (uid) =>
      employeeIds.get(uid) ?? null,
    );
    warnings.push(...mergeWarnings, ...missingEmployeeIdWarnings(records));

    return {
      contract_version: KPI_PAYROLL_SYNC_CONTRACT_VERSION,
      month,
      team: { id: team.id, name: team.name },
      generated_at: new Date().toISOString(),
      records,
      warnings,
    };
  }
}

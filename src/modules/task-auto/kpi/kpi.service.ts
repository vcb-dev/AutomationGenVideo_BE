import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
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

@Injectable()
export class TaskAutoKpiService {
  constructor(private prisma: PrismaService) {}

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

    if (userIds.length === 0) return [];

    const range = this.parseFromTo(from, to);

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
}

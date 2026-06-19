import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  UpsertTeamKpiDto,
  UpsertEditorKpiDto,
  UpsertEditorWeekendKpiDto,
} from "./dto/kpi.dto";

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
      // Delete old allocations and re-create
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
    const kpi = await this.prisma.teamKpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException("TeamKpi not found");
    await this.prisma.teamKpi.delete({ where: { id } });
    return { success: true };
  }

  // ─── Editor KPI ───────────────────────────────────────────────────────────

  async getEditorKpis(month?: string, userId?: string) {
    return this.prisma.editorKpi.findMany({
      where: {
        ...(month ? { month } : {}),
        ...(userId ? { user_id: userId } : {}),
      },
      include: {
        user: { select: { id: true, full_name: true, email: true } },
        set_by: { select: { id: true, full_name: true } },
      },
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
      const myTeam = await this.prisma.team.findFirst({
        where: { leader_id: setById },
      });
      if (!myTeam)
        throw new ForbiddenException(
          "Bạn chưa được gán là leader của team nào",
        );
      const isMember = await this.prisma.teamMember.findFirst({
        where: { team_id: myTeam.id, user_id: dto.user_id },
      });
      if (!isMember)
        throw new ForbiddenException("Người dùng không thuộc team của bạn");
    }

    const kpiData = {
      total_target: dto.total_target,
      video_win: dto.video_win ?? 0,
      video_fail: dto.video_fail ?? 0,
      ratio_a1: dto.ratio_a1 ?? 0,
      ratio_a2: dto.ratio_a2 ?? 0,
      ratio_a3: dto.ratio_a3 ?? 0,
      ratio_a4: dto.ratio_a4 ?? 0,
      ratio_a5: dto.ratio_a5 ?? 0,
      kpi_extra: dto.kpi_extra ?? 0,
      content_new: dto.content_new ?? 0,
      content_collected: dto.content_collected ?? 0,
      content_win_cover: dto.content_win_cover ?? 0,
      product_planned: dto.product_planned ?? 0,
      product_win_collect: dto.product_win_collect ?? 0,
      video_traffic: dto.video_traffic ?? 0,
      video_gmv: dto.video_gmv ?? 0,
      video_profit: dto.video_profit ?? 0,
      set_by_id: setById,
    };

    return this.prisma.editorKpi.upsert({
      where: { user_id_month: { user_id: dto.user_id, month: dto.month } },
      create: { user_id: dto.user_id, month: dto.month, ...kpiData },
      update: kpiData,
      include: {
        user: { select: { id: true, full_name: true, email: true } },
        set_by: { select: { id: true, full_name: true } },
      },
    });
  }

  async deleteEditorKpi(id: string) {
    const kpi = await this.prisma.editorKpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException("EditorKpi not found");
    await this.prisma.editorKpi.delete({ where: { id } });
    return { success: true };
  }

  // ─── Editor Weekend KPI (per-Sunday) ─────────────────────────────────────

  async getEditorWeekendKpis(month?: string) {
    const where = month ? { date: { startsWith: month } } : undefined;
    return this.prisma.editorWeekendKpi.findMany({
      where,
      include: {
        user: { select: { id: true, full_name: true, email: true } },
        set_by: { select: { id: true, full_name: true } },
      },
      orderBy: [{ date: "asc" }, { user_id: "asc" }],
    });
  }

  async upsertEditorWeekendKpi(
    dto: UpsertEditorWeekendKpiDto,
    setById: string,
    roles: string[] = [],
  ) {
    const isLeaderOnly =
      roles.includes("LEADER") &&
      !roles.includes("ADMIN") &&
      !roles.includes("MANAGER");
    if (isLeaderOnly) {
      const myTeam = await this.prisma.team.findFirst({
        where: { leader_id: setById },
      });
      if (!myTeam)
        throw new ForbiddenException(
          "Bạn chưa được gán là leader của team nào",
        );
      const isMember = await this.prisma.teamMember.findFirst({
        where: { team_id: myTeam.id, user_id: dto.user_id },
      });
      if (!isMember)
        throw new ForbiddenException("Người dùng không thuộc team của bạn");
    }
    return this.prisma.editorWeekendKpi.upsert({
      where: { user_id_date: { user_id: dto.user_id, date: dto.date } },
      create: {
        user_id: dto.user_id,
        date: dto.date,
        kpi: dto.kpi,
        set_by_id: setById,
      },
      update: { kpi: dto.kpi, set_by_id: setById },
      include: {
        user: { select: { id: true, full_name: true, email: true } },
        set_by: { select: { id: true, full_name: true } },
      },
    });
  }

  async deleteEditorWeekendKpi(id: string) {
    const kpi = await this.prisma.editorWeekendKpi.findUnique({
      where: { id },
    });
    if (!kpi) throw new NotFoundException("EditorWeekendKpi not found");
    await this.prisma.editorWeekendKpi.delete({ where: { id } });
    return { success: true };
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
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { UpsertTeamKpiDto, UpsertEditorKpiDto } from "../dto/kpi.dto";

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
    const kpi = await this.prisma.editorKpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException("EditorKpi not found");
    await this.prisma.editorKpi.delete({ where: { id } });
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
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  ArchivePerformanceGoalQueryDto,
  CreatePerformanceGoalDto,
  CreatePerformanceKpiGroupDto,
  PerformanceKpiGroupQueryDto,
  PerformanceGoalQueryDto,
  UpdatePerformanceKpiGroupDto,
  UpdatePerformanceGoalDto,
} from "./dto/performance-goal.dto";
import {
  calculateGoalProgress,
  calculateUnweightedOverall,
} from "./performance-goal.calculator";

const includeGoalRelations = {
  user: { select: { id: true, full_name: true, email: true, employee_id: true } },
  team: { select: { id: true, name: true, leader_id: true } },
  set_by: { select: { id: true, full_name: true } },
  kpi_group: {
    select: {
      id: true,
      team_id: true,
      code: true,
      name: true,
      description: true,
      color: true,
      icon: true,
      sort_order: true,
      is_system: true,
      is_active: true,
    },
  },
} satisfies Prisma.PerformanceGoalInclude;

const LEGACY_KPI_GROUP_ID = "10000000-0000-4000-8000-000000000004";

type GoalWithRelations = Prisma.PerformanceGoalGetPayload<{
  include: typeof includeGoalRelations;
}>;

@Injectable()
export class PerformanceGoalsService {
  constructor(private readonly prisma: PrismaService) {}

  private privileged(roles: string[]) {
    return roles.includes("ADMIN") || roles.includes("MANAGER");
  }

  private snapshot(goal: any): Prisma.InputJsonValue {
    return {
      type: goal.type,
      title: goal.title,
      description: goal.description ?? null,
      metric_type: goal.metric_type,
      unit: goal.unit ?? null,
      direction: goal.direction,
      target_value: Number(goal.target_value),
      actual_system:
        goal.actual_system === null || goal.actual_system === undefined
          ? null
          : Number(goal.actual_system),
      actual_manual:
        goal.actual_manual === null || goal.actual_manual === undefined
          ? null
          : Number(goal.actual_manual),
      pass_threshold_pct: Number(goal.pass_threshold_pct),
      status: goal.status,
      kpi_group_id: goal.kpi_group_id ?? null,
      revision: goal.revision,
    } as Prisma.InputJsonValue;
  }

  private async assertKpiGroup(groupId: string, teamId: string) {
    const group = await this.prisma.performanceKpiGroup.findUnique({
      where: { id: groupId },
    });
    if (!group || !group.is_active) {
      throw new BadRequestException("Nhóm KPI không tồn tại hoặc đã lưu trữ");
    }
    if (group.team_id && group.team_id !== teamId) {
      throw new BadRequestException("Nhóm KPI không thuộc team đang được chọn");
    }
    return group;
  }

  private serialize(goal: GoalWithRelations) {
    const calculated = calculateGoalProgress({
      target: Number(goal.target_value),
      actualSystem: goal.actual_system === null ? null : Number(goal.actual_system),
      actualManual: goal.actual_manual === null ? null : Number(goal.actual_manual),
      direction: goal.direction,
      passThresholdPct: Number(goal.pass_threshold_pct),
    });

    return {
      ...goal,
      target_value: Number(goal.target_value),
      actual_system: goal.actual_system === null ? null : Number(goal.actual_system),
      actual_manual: goal.actual_manual === null ? null : Number(goal.actual_manual),
      pass_threshold_pct: Number(goal.pass_threshold_pct),
      actual_final: calculated.actualFinal,
      progress_pct:
        calculated.progressPct === null ? null : Number(calculated.progressPct.toFixed(2)),
      progress_pct_for_overall: Number(calculated.progressPctForOverall.toFixed(2)),
      passed: calculated.passed,
    };
  }

  private async assertCanManageTeam(
    teamId: string,
    actorId: string,
    roles: string[],
    targetUserId?: string,
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        leader_id: true,
        members: targetUserId
          ? { where: { user_id: targetUserId }, select: { id: true } }
          : false,
      },
    });
    if (!team) throw new NotFoundException("Team không tồn tại");

    if (!this.privileged(roles) && team.leader_id !== actorId) {
      throw new ForbiddenException("Bạn không phải leader của team này");
    }

    if (
      targetUserId &&
      team.leader_id !== targetUserId &&
      (!team.members || team.members.length === 0)
    ) {
      throw new BadRequestException("Người được giao KPI/OKR không thuộc team này");
    }
    return team;
  }

  async list(
    query: PerformanceGoalQueryDto,
    actor: { id: string; roles?: string[] },
  ) {
    const roles = actor.roles ?? [];
    const where: Prisma.PerformanceGoalWhereInput = {
      month: query.month,
      ...(query.team_id ? { team_id: query.team_id } : {}),
      ...(query.user_id ? { user_id: query.user_id } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.kpi_group_id ? { kpi_group_id: query.kpi_group_id } : {}),
      ...(!query.include_archived ? { status: { not: "ARCHIVED" } } : {}),
    };

    if (!this.privileged(roles)) {
      if (roles.includes("LEADER")) {
        const ledTeams = await this.prisma.team.findMany({
          where: { leader_id: actor.id },
          select: { id: true },
        });
        const teamIds = ledTeams.map((team) => team.id);
        if (query.team_id && !teamIds.includes(query.team_id)) {
          throw new ForbiddenException("Bạn không có quyền xem KPI/OKR của team này");
        }
        where.team_id = query.team_id ?? { in: teamIds };
      } else {
        if (query.user_id && query.user_id !== actor.id) {
          throw new ForbiddenException("Bạn chỉ được xem KPI/OKR của chính mình");
        }
        where.user_id = actor.id;
      }
    }

    const rows = await this.prisma.performanceGoal.findMany({
      where,
      include: includeGoalRelations,
      orderBy: [
        { user: { full_name: "asc" } },
        { type: "asc" },
        { created_at: "asc" },
      ],
    });
    const records = rows.map((row) => this.serialize(row));
    const active = records.filter((record) => record.status === "PUBLISHED");
    const overall = calculateUnweightedOverall(
      active.map((record) => ({
        progressPctForOverall: record.progress_pct_for_overall,
      })),
    );
    const summarize = (items: typeof active) => {
      const value = calculateUnweightedOverall(
        items.map((item) => ({ progressPctForOverall: item.progress_pct_for_overall })),
      );
      return {
        total_items: items.length,
        passed_items: items.filter((item) => item.passed).length,
        missing_actual_items: items.filter((item) => item.actual_final === null).length,
        overall_progress_pct: value === null ? null : Number(value.toFixed(2)),
        overall_passed: value !== null && value >= 80,
      };
    };
    const kpiItems = active.filter((item) => item.type === "KPI");
    const okrItems = active.filter((item) => item.type === "OKR");
    const grouped = new Map<string, typeof active>();
    for (const item of kpiItems) {
      const key = item.kpi_group_id ?? LEGACY_KPI_GROUP_ID;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }

    return {
      month: query.month,
      records,
      summary: {
        total_items: active.length,
        passed_items: active.filter((item) => item.passed).length,
        missing_actual_items: active.filter((item) => item.actual_final === null).length,
        overall_progress_pct: overall === null ? null : Number(overall.toFixed(2)),
        overall_passed: overall !== null && overall >= 80,
      },
      summaries: {
        KPI: summarize(kpiItems),
        OKR: summarize(okrItems),
      },
      kpi_groups: [...grouped.entries()].map(([groupId, items]) => ({
        group: items[0]?.kpi_group ?? {
          id: groupId,
          code: "LEGACY_FLEXIBLE",
          name: "KPI bổ sung",
          color: "BLUE",
          icon: "TARGET",
          sort_order: 90,
          is_system: true,
          is_active: true,
        },
        ...summarize(items),
      })),
    };
  }

  async create(
    dto: CreatePerformanceGoalDto,
    actor: { id: string; roles?: string[] },
  ) {
    const roles = actor.roles ?? [];
    await this.assertCanManageTeam(dto.team_id, actor.id, roles, dto.user_id);
    if (dto.status === "ARCHIVED") {
      throw new BadRequestException("Không thể tạo KPI/OKR ở trạng thái lưu trữ");
    }
    const kpiGroupId = dto.type === "KPI"
      ? (dto.kpi_group_id ?? LEGACY_KPI_GROUP_ID)
      : null;
    if (kpiGroupId) await this.assertKpiGroup(kpiGroupId, dto.team_id);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.performanceGoal.create({
        data: {
          user_id: dto.user_id,
          team_id: dto.team_id,
          month: dto.month,
          type: dto.type,
          kpi_group_id: kpiGroupId,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          metric_type: dto.metric_type ?? "NUMBER",
          unit: dto.unit?.trim() || null,
          direction: dto.direction ?? "AT_LEAST",
          target_value: dto.target_value,
          actual_manual: dto.actual_manual ?? null,
          pass_threshold_pct: 80,
          status: dto.status ?? "PUBLISHED",
          set_by_id: actor.id,
        },
      });
      await tx.performanceGoalHistory.create({
        data: {
          goal_id: created.id,
          revision: 1,
          action: "CREATE",
          next_data: this.snapshot(created),
          changed_by_id: actor.id,
        },
      });
      return tx.performanceGoal.findUniqueOrThrow({
        where: { id: created.id },
        include: includeGoalRelations,
      });
    });
    return this.serialize(row);
  }

  async update(
    id: string,
    dto: UpdatePerformanceGoalDto,
    actor: { id: string; roles?: string[] },
  ) {
    const current = await this.prisma.performanceGoal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("KPI/OKR không tồn tại");
    if (current.status === "ARCHIVED") {
      throw new BadRequestException("KPI/OKR đã lưu trữ, không thể chỉnh sửa");
    }
    await this.assertCanManageTeam(current.team_id, actor.id, actor.roles ?? []);
    if (dto.status === "ARCHIVED") {
      throw new BadRequestException("Hãy dùng thao tác lưu trữ để xóa KPI/OKR");
    }

    const materialKeys: Array<keyof UpdatePerformanceGoalDto> = [
      "type",
      "target_value",
      "actual_manual",
      "direction",
      "kpi_group_id",
    ];
    const materialChange = materialKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(dto, key),
    );
    if (materialChange && !dto.change_reason?.trim()) {
      throw new BadRequestException(
        "Vui lòng nhập lý do khi đổi loại, nhóm, mục tiêu, số thực đạt hoặc chiều đánh giá",
      );
    }

    const { expected_revision, change_reason, ...changes } = dto;
    const nextType = changes.type ?? current.type;
    const nextGroupId = nextType === "KPI"
      ? (changes.kpi_group_id ?? current.kpi_group_id ?? LEGACY_KPI_GROUP_ID)
      : null;
    if (nextGroupId) await this.assertKpiGroup(nextGroupId, current.team_id);
    const data: Prisma.PerformanceGoalUncheckedUpdateManyInput = {
      ...changes,
      kpi_group_id: nextGroupId,
      ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description?.trim() || null }
        : {}),
      ...(changes.unit !== undefined ? { unit: changes.unit?.trim() || null } : {}),
      revision: { increment: 1 },
    };

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.performanceGoal.updateMany({
        where: { id, revision: expected_revision, status: { not: "ARCHIVED" } },
        data,
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "KPI/OKR đã được người khác cập nhật. Vui lòng tải lại dữ liệu.",
        );
      }
      const next = await tx.performanceGoal.findUniqueOrThrow({ where: { id } });
      await tx.performanceGoalHistory.create({
        data: {
          goal_id: id,
          revision: next.revision,
          action: "UPDATE",
          change_reason: change_reason?.trim() || null,
          previous_data: this.snapshot(current),
          next_data: this.snapshot(next),
          changed_by_id: actor.id,
        },
      });
      return tx.performanceGoal.findUniqueOrThrow({
        where: { id },
        include: includeGoalRelations,
      });
    });
    return this.serialize(row);
  }

  async listKpiGroups(
    query: PerformanceKpiGroupQueryDto,
    actor: { id: string; roles?: string[] },
  ) {
    const roles = actor.roles ?? [];
    if (query.team_id && !this.privileged(roles)) {
      const team = await this.prisma.team.findFirst({
        where: {
          id: query.team_id,
          OR: [
            { leader_id: actor.id },
            { members: { some: { user_id: actor.id } } },
          ],
        },
        select: { id: true },
      });
      if (!team) throw new ForbiddenException("Bạn không có quyền xem nhóm KPI của team này");
    }
    return this.prisma.performanceKpiGroup.findMany({
      where: {
        OR: [
          { is_system: true },
          ...(query.team_id
            ? [
                { team_id: query.team_id },
                {
                  code: "LEGACY_FLEXIBLE",
                  goals: { some: { team_id: query.team_id } },
                },
              ]
            : []),
        ],
        ...(!query.include_archived ? { is_active: true } : {}),
      },
      include: {
        team: { select: { id: true, name: true } },
        created_by: { select: { id: true, full_name: true } },
        _count: { select: { goals: true } },
      },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
  }

  async createKpiGroup(
    dto: CreatePerformanceKpiGroupDto,
    actor: { id: string; roles?: string[] },
  ) {
    await this.assertCanManageTeam(dto.team_id, actor.id, actor.roles ?? []);
    return this.prisma.performanceKpiGroup.create({
      data: {
        team_id: dto.team_id,
        code: `CUSTOM_${randomUUID().replace(/-/g, "").toUpperCase()}`,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        color: dto.color ?? "BLUE",
        icon: dto.icon ?? "TARGET",
        sort_order: dto.sort_order ?? 100,
        created_by_id: actor.id,
      },
    });
  }

  async updateKpiGroup(
    id: string,
    dto: UpdatePerformanceKpiGroupDto,
    actor: { id: string; roles?: string[] },
  ) {
    const current = await this.prisma.performanceKpiGroup.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Nhóm KPI không tồn tại");
    if (current.is_system) throw new BadRequestException("Không thể sửa nhóm KPI cố định");
    if (!current.team_id) throw new BadRequestException("Nhóm KPI không hợp lệ");
    await this.assertCanManageTeam(current.team_id, actor.id, actor.roles ?? []);
    return this.prisma.performanceKpiGroup.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
      },
    });
  }

  async archiveKpiGroup(
    id: string,
    actor: { id: string; roles?: string[] },
  ) {
    const current = await this.prisma.performanceKpiGroup.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Nhóm KPI không tồn tại");
    if (current.is_system) throw new BadRequestException("Không thể lưu trữ nhóm KPI cố định");
    if (!current.team_id) throw new BadRequestException("Nhóm KPI không hợp lệ");
    await this.assertCanManageTeam(current.team_id, actor.id, actor.roles ?? []);
    const activeGoals = await this.prisma.performanceGoal.count({
      where: { kpi_group_id: id, status: { not: "ARCHIVED" } },
    });
    if (activeGoals > 0) {
      throw new ConflictException(
        `Nhóm còn ${activeGoals} đầu mục đang áp dụng. Hãy chuyển hoặc lưu trữ các đầu mục trước.`,
      );
    }
    await this.prisma.performanceKpiGroup.update({
      where: { id },
      data: { is_active: false, archived_at: new Date() },
    });
    return { id, archived: true };
  }

  async archive(
    id: string,
    query: ArchivePerformanceGoalQueryDto,
    actor: { id: string; roles?: string[] },
  ) {
    const current = await this.prisma.performanceGoal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("KPI/OKR không tồn tại");
    await this.assertCanManageTeam(current.team_id, actor.id, actor.roles ?? []);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.performanceGoal.updateMany({
        where: { id, revision: query.revision, status: { not: "ARCHIVED" } },
        data: {
          status: "ARCHIVED",
          archived_at: new Date(),
          revision: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          "KPI/OKR đã được cập nhật hoặc lưu trữ. Vui lòng tải lại dữ liệu.",
        );
      }
      const next = await tx.performanceGoal.findUniqueOrThrow({ where: { id } });
      await tx.performanceGoalHistory.create({
        data: {
          goal_id: id,
          revision: next.revision,
          action: "ARCHIVE",
          change_reason: query.reason.trim(),
          previous_data: this.snapshot(current),
          next_data: this.snapshot(next),
          changed_by_id: actor.id,
        },
      });
    });
    return { id, archived: true };
  }

  async history(id: string, actor: { id: string; roles?: string[] }) {
    const goal = await this.prisma.performanceGoal.findUnique({ where: { id } });
    if (!goal) throw new NotFoundException("KPI/OKR không tồn tại");
    const roles = actor.roles ?? [];
    if (!this.privileged(roles)) {
      if (roles.includes("LEADER")) {
        await this.assertCanManageTeam(goal.team_id, actor.id, roles);
      } else if (goal.user_id !== actor.id) {
        throw new ForbiddenException("Bạn chỉ được xem lịch sử KPI/OKR của chính mình");
      }
    }
    return this.prisma.performanceGoalHistory.findMany({
      where: { goal_id: id },
      include: { changed_by: { select: { id: true, full_name: true } } },
      orderBy: { revision: "desc" },
    });
  }

  async payrollSync(teamId: string, month: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    if (!team) throw new NotFoundException("Team không tồn tại");

    const rows = await this.prisma.performanceGoal.findMany({
      where: { team_id: teamId, month, status: "PUBLISHED" },
      include: includeGoalRelations,
      orderBy: [{ user_id: "asc" }, { type: "asc" }, { created_at: "asc" }],
    });
    const records = rows.map((row) => {
      const item = this.serialize(row);
      return {
        external_item_id: item.id,
        revision: item.revision,
        employee_id: item.user.employee_id,
        user_id: item.user_id,
        team_id: item.team_id,
        month: item.month,
        item_type: item.type,
        kpi_group_id: item.type === "KPI" ? item.kpi_group?.id ?? null : null,
        kpi_group_code: item.type === "KPI" ? item.kpi_group?.code ?? null : null,
        kpi_group_name: item.type === "KPI" ? item.kpi_group?.name ?? null : null,
        title: item.title,
        description: item.description,
        metric_type: item.metric_type,
        unit: item.unit,
        direction: item.direction,
        target: item.target_value,
        actual_system: item.actual_system,
        actual_manual: item.actual_manual,
        actual_final: item.actual_final,
        progress_pct: item.progress_pct,
        progress_pct_for_overall: item.progress_pct_for_overall,
        pass_threshold_pct: item.pass_threshold_pct,
        passed: item.passed,
        actual_source:
          item.actual_manual !== null
            ? "MANUAL_IN_AGV"
            : item.actual_system !== null
              ? "SYSTEM_IN_AGV"
              : "MISSING",
        updated_at: item.updated_at,
      };
    });

    const warnings = Array.from(
      new Map(
        records
          .filter((record) => record.employee_id === null)
          .map((record) => [
            record.user_id,
            {
              code: "MISSING_EMPLOYEE_ID",
              user_id: record.user_id,
              message: "User chưa có employee_id",
            },
          ]),
      ).values(),
    );

    return {
      contract_version: "2.0",
      month,
      team,
      generated_at: new Date().toISOString(),
      records,
      warnings,
    };
  }
}

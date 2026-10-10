import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { AssignmentRunStatus, BrandType, Prisma } from "@prisma/client";

import {
  isWeekend,
  monthKey,
  addCalendarDays,
  effectiveAssignmentDate,
} from "../../../utils/date.utils";
import { loadA4Editors } from "./steps/editor-eligibility";
import {
  loadLastAssignedByEditor,
  loadTeamProductPool,
  pickProductsForEditor,
} from "./steps/product-picker";
import { createTasksFromAssignments } from "./steps/task-creator";
import {
  buildEmptyWarehouseNotice,
  EmptyWarehouseNotice,
} from "./steps/warehouse-empty-notice";
import { MAX_COOLDOWN_LOOKBACK_DAYS } from "./steps/cooldown";
import { DailyPlanBuilderService } from "../daily-plans/daily-plan-builder.service";
import { DailyPlanRunSummary } from "../daily-plans/types";
import { KpiRolloverResult, KpiRolloverService } from "../kpi/kpi-rollover.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PushService } from "@/common/push/push.service";
import { UpdateAutoAssignSettingDto } from "../settings/dto/settings.dto";
import {
  AUTO_ASSIGN_CONTENT_LINE_NAME,
  DEADLINE_CALENDAR_DAYS,
  DEFAULT_COOLDOWN_DAYS,
  DEFAULT_DAILY_PLAN_LINE_NAMES,
  DEFAULT_TZ,
  ScheduledAssignment,
  TeamResult,
} from "./types";

@Injectable()
export class TaskAutoAssignService {
  private readonly logger = new Logger(TaskAutoAssignService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushService,
    private dailyPlanBuilder: DailyPlanBuilderService,
    private kpiRollover: KpiRolloverService,
  ) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings() {
    return this.prisma.autoAssignSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  async updateSettings(dto: UpdateAutoAssignSettingDto, userId: string) {
    return this.prisma.autoAssignSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...dto, updated_by: userId },
      update: { ...dto, updated_by: userId },
    });
  }

  async getRuns(limit = 50) {
    return this.prisma.assignmentRun.findMany({
      orderBy: { run_at: "desc" },
      take: limit,
    });
  }

  // ── Cron ──────────────────────────────────────────────────────────────────

  @Cron("* * * * *", { name: "task-auto-assign" })
  async cronCheck() {
    try {
      const settings = await this.prisma.autoAssignSetting.findUnique({
        where: { id: 1 },
      });
      if (!settings) {
        this.logger.warn("cronCheck: no settings row found (id=1)");
        return;
      }
      if (!settings.is_active) return;

      const now = DateTime.now().setZone(settings.timezone || DEFAULT_TZ);
      if (isWeekend(effectiveAssignmentDate(now)) && !settings.weekend_enabled) return;

      const [hh, mm] = (settings.schedule_time || "17:00")
        .split(":")
        .map(Number);
      if (now.hour !== hh || now.minute !== mm) return;

      this.logger.log(
        `cronCheck: time matched ${settings.schedule_time} — checking dedup`,
      );

      const windowStart = now.startOf("minute").toJSDate();
      const windowEnd = new Date(windowStart.getTime() + 60_000);
      const recentRun = await this.prisma.assignmentRun.findFirst({
        where: { run_at: { gte: windowStart, lt: windowEnd } },
      });
      if (recentRun) {
        this.logger.log(
          `cronCheck: skipped — run ${recentRun.id} already exists this minute`,
        );
        return;
      }

      this.logger.log("cronCheck: launching runDailyAssignment");
      await this.runDailyAssignment(now, true);
    } catch (err) {
      this.logger.error("Cron check failed", err);
    }
  }

  async triggerManually(): Promise<{
    assigned: number;
    skipped: number;
    runId: string;
  }> {
    const now = DateTime.now().setZone(DEFAULT_TZ);
    return this.runDailyAssignment(now, true);
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  async runDailyAssignment(
    now: DateTime = DateTime.now().setZone(DEFAULT_TZ),
    forceRun = false,
  ): Promise<{ assigned: number; skipped: number; runId: string }> {
    const settings = await this.prisma.autoAssignSetting.findUnique({
      where: { id: 1 },
    });
    if (!settings?.is_active) return { assigned: 0, skipped: 0, runId: "" };
    // Lượt chạy chia việc cho NGÀY MAI — tắt cuối tuần nghĩa là không có việc cho T7/CN (lượt tối T6,
    // T7 bỏ qua; lượt tối CN vẫn chạy cho T2), không xét theo ngày chạy.
    if (isWeekend(effectiveAssignmentDate(now)) && !(settings.weekend_enabled ?? true))
      return { assigned: 0, skipped: 0, runId: "" };

    if (!forceRun) {
      const dayStart = now.startOf("day").toJSDate();
      const dayEnd = now.endOf("day").toJSDate();
      const existingDone = await this.prisma.assignmentRun.findFirst({
        where: {
          status: AssignmentRunStatus.DONE,
          run_at: { gte: dayStart, lte: dayEnd },
        },
      });
      if (existingDone) {
        this.logger.log(
          `Assignment already done today (run ${existingDone.id}), skipping`,
        );
        return { assigned: 0, skipped: 0, runId: existingDone.id };
      }
    }

    const run = await this.prisma.assignmentRun.create({
      data: { status: AssignmentRunStatus.RUNNING },
    });
    const month = monthKey(effectiveAssignmentDate(now));
    const deadline = addCalendarDays(now, DEADLINE_CALENDAR_DAYS).toJSDate();

    try {
      const kpiRollover = await this.rolloverKpis(month, run.id);
      const contentLine = await this.findAutoAssignContentLine();
      const teams = await this.prisma.team.findMany({
        where: { is_active: true },
      });
      let totalAssigned = 0;
      let totalSkipped = 0;
      const details: Record<string, any> = {};

      for (const team of teams) {
        const result = await this.assignTasksForTeam(
          team.id,
          team.brand_type,
          contentLine,
          now,
          month,
          run.id,
          deadline,
          settings.default_cooldown_days ?? DEFAULT_COOLDOWN_DAYS,
        );
        totalAssigned += result.assigned;
        totalSkipped += result.skipped;
        details[team.id] = { team_name: team.name, ...result };
      }

      const dailyPlans =
        settings.daily_plan_enabled === false
          ? null
          : await this.buildDailyPlans(teams, settings.daily_plan_line_names, now, month, deadline, run.id);

      await this.prisma.assignmentRun.update({
        where: { id: run.id },
        data: {
          status: AssignmentRunStatus.DONE,
          total_assigned: totalAssigned,
          total_skipped: totalSkipped,
          details: {
            ...details,
            _totals: {
              assigned: totalAssigned,
              skipped: totalSkipped,
              content_line: contentLine.name,
            },
            ...(dailyPlans && { _daily_plans: dailyPlans }),
            ...(kpiRollover && { _kpi_rollover: kpiRollover }),
          } as any,
          finished_at: new Date(),
        },
      });

      this.logger.log(
        `Run ${run.id} DONE: assigned=${totalAssigned} skipped=${totalSkipped}`,
      );
      return { assigned: totalAssigned, skipped: totalSkipped, runId: run.id };
    } catch (err) {
      this.logger.error(`Run ${run.id} FAILED`, err);
      await this.prisma.assignmentRun
        .update({
          where: { id: run.id },
          data: {
            status: AssignmentRunStatus.FAILED,
            error_msg: err instanceof Error ? err.message : String(err),
            finished_at: new Date(),
          },
        })
        .catch(() => null);
      throw err;
    }
  }

  /**
   * Tháng của ngày được chia chưa có KPI thì chép từ tháng trước TRƯỚC khi đọc KPI — lượt chạy ngày cuối
   * tháng đã chia việc cho ngày 1 tháng sau. Lỗi chỉ ghi vào details, không chặn lượt chia.
   */
  private async rolloverKpis(
    month: string,
    runId: string,
  ): Promise<KpiRolloverResult | { error: string } | null> {
    try {
      return await this.kpiRollover.ensureMonthRollover(month, "AUTO_ASSIGN");
    } catch (err) {
      this.logger.error(`Run ${runId}: chép KPI tháng ${month} thất bại`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Kế hoạch ngày các tuyến không tự tạo task (A1/A2/A3/A5) — cùng lượt, sau khi chia A4. Lỗi ở bước
   * này chỉ ghi vào details, không làm hỏng lượt chia A4 đã tạo xong.
   */
  private async buildDailyPlans(
    teams: { id: string; name: string; brand_type: BrandType; market: string | null }[],
    lineNames: string[] | null | undefined,
    now: DateTime,
    month: string,
    deadline: Date,
    runId: string,
  ): Promise<DailyPlanRunSummary | { error: string }> {
    try {
      return await this.dailyPlanBuilder.buildDailyPlans({
        teams,
        lineNames: lineNames ?? DEFAULT_DAILY_PLAN_LINE_NAMES,
        now,
        month,
        deadline,
        runId,
      });
    } catch (err) {
      this.logger.error(`Run ${runId}: lập kế hoạch ngày thất bại`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async findAutoAssignContentLine(): Promise<{ id: string; name: string }> {
    const line = await this.prisma.contentLine.findFirst({
      where: {
        name: { equals: AUTO_ASSIGN_CONTENT_LINE_NAME, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (!line) {
      throw new Error(
        `Không tìm thấy tuyến nội dung "${AUTO_ASSIGN_CONTENT_LINE_NAME}" để chia task tự động`,
      );
    }
    return line;
  }

  // ── Per-team orchestration ────────────────────────────────────────────────

  /**
   * Mỗi editor có KPI tuyến A4 nhận đủ số task A4 còn thiếu cho ngày hiệu lực, mỗi task gắn 1 SP
   * khác nhau từ Kho sản phẩm của team — KHÔNG gắn content, editor tự chọn content khi mở task.
   */
  private async assignTasksForTeam(
    teamId: string,
    teamBrandType: BrandType,
    contentLine: { id: string; name: string },
    now: DateTime,
    month: string,
    runId: string,
    deadline: Date,
    defaultCooldownDays: number,
  ): Promise<TeamResult> {
    const editors = await loadA4Editors(
      this.prisma,
      teamId,
      contentLine.id,
      now,
      month,
    );
    if (!editors.length) return { assigned: 0, skipped: 0 };

    const needed = editors.reduce((sum, e) => sum + e.remainingToday, 0);
    const products = await loadTeamProductPool(this.prisma, teamId, teamBrandType);
    if (!products.length) {
      await this.createEmptyWarehouseNotifications(
        editors.map((e) =>
          buildEmptyWarehouseNotice({
            editorId: e.userId,
            videosNeeded: e.remainingToday,
            contentLine,
          }),
        ),
      );
      this.logger.log(
        `Team ${teamId}: kho sản phẩm trống — ${editors.length} editor cần ${needed} task ${contentLine.name}, đã gửi thông báo`,
      );
      return { assigned: 0, skipped: needed };
    }

    const lastAssignedByEditor = await loadLastAssignedByEditor(
      this.prisma,
      editors.map((e) => e.userId),
      products,
      now.minus({ days: MAX_COOLDOWN_LOOKBACK_DAYS }).startOf("day").toJSDate(),
    );

    const pickedInRun = new Map<string, number>();
    const assignments: ScheduledAssignment[] = [];
    for (const editor of editors) {
      const picked = pickProductsForEditor({
        pool: products,
        need: editor.remainingToday,
        lastAssigned: lastAssignedByEditor.get(editor.userId) ?? new Map(),
        pickedInRun,
        defaultCooldownDays,
        today: now,
      });
      for (const product of picked) {
        pickedInRun.set(product.id, (pickedInRun.get(product.id) ?? 0) + 1);
        assignments.push({ editorId: editor.userId, product });
      }
      this.logger.log(
        `Team ${teamId} editor ${editor.userId}: ${contentLine.name} ` +
          `${picked.length}/${editor.remainingToday} task — ` +
          `tháng ${editor.assignedThisMonth}/${editor.monthlyTarget}, kho ${products.length} SP` +
          (picked.length < editor.remainingToday
            ? ` — giao thiếu ${editor.remainingToday - picked.length}: kho không đủ SP ngoài cooldown`
            : ""),
      );
    }

    const assigned = await createTasksFromAssignments(
      this.prisma,
      this.pushService,
      teamId,
      teamBrandType,
      runId,
      deadline,
      contentLine,
      assignments,
    );
    return { assigned, skipped: needed - assigned };
  }

  // ── Thông báo kho sản phẩm trống: batch insert + push, tương tự createTasksFromAssignments ────

  private async createEmptyWarehouseNotifications(
    notices: EmptyWarehouseNotice[],
  ): Promise<void> {
    await this.prisma.notification.createMany({
      data: notices.map((n) => ({
        user_id: n.editorId,
        type: "AUTO_ASSIGN_EMPTY_WAREHOUSE",
        title: n.title,
        body: n.body,
        meta: n.meta as Prisma.InputJsonValue,
      })),
    });
    for (const n of notices) {
      this.pushService
        .sendToUser(n.editorId, {
          title: n.title,
          body: n.body,
          url: "/dashboard/task-auto/tasks",
        })
        .catch(() => {});
    }
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { AssignmentRunStatus } from "@prisma/client";

import { isWeekend, monthKey, addCalendarDays } from "./helpers/date.helpers";
import { largestRemainder } from "./helpers/quota.helpers";
import { getEligibleEditors } from "./strategies/editor-eligibility.strategy";
import { batchEditorStats } from "./strategies/editor-stats.strategy";
import { persistPairings } from "./strategies/persist-pairings.strategy";
import { PrismaService } from "@/common/prisma/prisma.service";
import { UpdateAutoAssignSettingDto } from "../dto/settings.dto";
import {
  DEADLINE_CALENDAR_DAYS,
  DEFAULT_TZ,
  EditorStats,
  FILL_STRATEGY,
  Pairing,
  PoolContent,
  PoolProduct,
  ProductSource,
  QuotaItem,
  TeamResult,
} from "./types";
import {
  buildCandidates,
  selectPairsForEditor,
} from "./strategies/candidate.strategy";

@Injectable()
export class TaskAutoAssignService {
  private readonly logger = new Logger(TaskAutoAssignService.name);

  constructor(private prisma: PrismaService) {}

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
      if (isWeekend(now) && !settings.weekend_enabled) return;

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
    if (isWeekend(now) && !(settings.weekend_enabled ?? true))
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
    const month = monthKey(now);
    const monthStart = now.startOf("month").toJSDate();
    const deadline = addCalendarDays(now, DEADLINE_CALENDAR_DAYS).toJSDate();

    try {
      const teams = await this.prisma.team.findMany({
        where: { is_active: true },
      });
      let totalAssigned = 0;
      const details: Record<string, any> = {};

      for (const team of teams) {
        const result = await this.processTeam(
          team.id,
          now,
          month,
          monthStart,
          run.id,
          deadline,
        );
        totalAssigned += result.assigned;
        details[team.id] = { team_name: team.name, ...result };
      }

      await this.prisma.assignmentRun.update({
        where: { id: run.id },
        data: {
          status: AssignmentRunStatus.DONE,
          total_assigned: totalAssigned,
          total_skipped: 0,
          details: { ...details, _totals: { assigned: totalAssigned } } as any,
          finished_at: new Date(),
        },
      });

      this.logger.log(`Run ${run.id} DONE: assigned=${totalAssigned}`);
      return { assigned: totalAssigned, skipped: 0, runId: run.id };
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

  // ── Per-team orchestration ────────────────────────────────────────────────

  private async processTeam(
    teamId: string,
    now: DateTime,
    month: string,
    monthStart: Date,
    runId: string,
    deadline: Date,
  ): Promise<TeamResult> {
    const [contentLineTypes, productLineTypes] = await Promise.all([
      this.prisma.contentLine.findMany({
        where: { a_type: { not: null } },
        select: { id: true, a_type: true },
      }),
      this.prisma.productLine.findMany({
        where: { video_category: { not: null } },
        select: { id: true, video_category: true },
      }),
    ]);

    const editors = await getEligibleEditors(
      this.prisma,
      teamId,
      now,
      month,
      monthStart,
      contentLineTypes,
      productLineTypes,
    );
    if (!editors.length) {
      this.logger.log(`Team ${teamId}: no eligible editors`);
      return { assigned: 0, skipped: 0 };
    }

    const { contentItems: teamContentItems, productItems: teamProductItems } =
      await this.getQuotaAllocations(teamId, month);

    // ── Content pools ─────────────────────────────────────────────────────
    const teamContentsRaw = await this.prisma.teamContent.findMany({
      where: { team_id: teamId, status: { not: "ARCHIVED" } },
      select: { id: true, content_line_id: true, source_content_id: true, added_at: true },
      orderBy: { added_at: "asc" },
    });
    const teamContentPool: PoolContent[] = teamContentsRaw.map((tc) => ({
      id: tc.id,
      content_line_id: tc.content_line_id,
      source: "team" as const,
      source_content_id: tc.source_content_id,
    }));
    const teamSourceContentIds = new Set(
      teamContentsRaw.filter((tc) => tc.source_content_id).map((tc) => tc.source_content_id!),
    );

    const allGlobalContents = await this.prisma.content.findMany({
      where: {
        status: { not: "ARCHIVED" },
        ...(teamSourceContentIds.size > 0
          ? { NOT: { id: { in: [...teamSourceContentIds] } } }
          : {}),
      },
      select: { id: true, content_line_id: true },
      orderBy: { created_at: "asc" },
    });
    const globalContentPool: PoolContent[] = allGlobalContents.map((c) => ({
      id: c.id,
      content_line_id: c.content_line_id,
      source: "global" as const,
      source_content_id: null,
    }));

    // ── Product pools ─────────────────────────────────────────────────────
    const teamProductsRaw = await this.prisma.teamProduct.findMany({
      where: { team_id: teamId, is_active: true },
      select: { id: true, product_line_id: true, priority_score: true, source_product_id: true },
      orderBy: { priority_score: "desc" },
    });
    const teamProductPool: PoolProduct[] = teamProductsRaw.map((tp) => ({
      id: tp.id,
      product_line_id: tp.product_line_id,
      priority_score: tp.priority_score,
      source: "team" as const,
      source_product_id: tp.source_product_id,
    }));
    const teamSourceProductIds = new Set(
      teamProductsRaw.filter((tp) => tp.source_product_id).map((tp) => tp.source_product_id!),
    );

    const globalProductsRaw = await this.prisma.product.findMany({
      where: {
        is_active: true,
        ...(teamSourceProductIds.size > 0
          ? { NOT: { id: { in: [...teamSourceProductIds] } } }
          : {}),
      },
      select: { id: true, product_line_id: true, priority_score: true },
      orderBy: { priority_score: "desc" },
    });
    const globalProductPool: PoolProduct[] = globalProductsRaw.map((p) => ({
      id: p.id,
      product_line_id: p.product_line_id,
      priority_score: p.priority_score,
      source: "global" as const,
      source_product_id: null,
    }));

    // ── Personal pools (batch) ────────────────────────────────────────────
    const editorIds = editors.map((e) => e.userId);

    const personalContentsRaw = await this.prisma.editorContent.findMany({
      where: { user_id: { in: editorIds }, status: { not: "ARCHIVED" } },
      select: { id: true, content_line_id: true, source_content_id: true, user_id: true },
      orderBy: { added_at: "asc" },
    });
    const personalContentsByEditor = new Map<string, PoolContent[]>();
    for (const c of personalContentsRaw) {
      if (!personalContentsByEditor.has(c.user_id))
        personalContentsByEditor.set(c.user_id, []);
      personalContentsByEditor.get(c.user_id)!.push({
        id: c.id,
        content_line_id: c.content_line_id,
        source: "personal",
        source_content_id: c.source_content_id,
      });
    }

    const personalProductsRaw = await this.prisma.editorProduct.findMany({
      where: { user_id: { in: editorIds }, is_active: true },
      select: { id: true, product_line_id: true, priority_score: true, user_id: true, source_product_id: true },
      orderBy: { priority_score: "desc" },
    });
    const personalProductsByEditor = new Map<string, PoolProduct[]>();
    for (const p of personalProductsRaw) {
      if (!personalProductsByEditor.has(p.user_id))
        personalProductsByEditor.set(p.user_id, []);
      personalProductsByEditor.get(p.user_id)!.push({
        id: p.id,
        product_line_id: p.product_line_id,
        priority_score: p.priority_score,
        source: "personal",
        source_product_id: p.source_product_id,
      });
    }

    const editorStats = await batchEditorStats(this.prisma, editorIds, monthStart);

    // ── Per-editor selection ──────────────────────────────────────────────
    const allPairings: Pairing[] = [];

    for (const editor of editors) {
      if (editor.remainingDaily <= 0) continue;

      const stats: EditorStats = editorStats.get(editor.userId) ?? {
        existingPairs: new Set(),
        usedContentKeys: new Set(),
        teamProductTaskCount: 0,
      };

      const isPhase1 =
        editor.productPlanned > 0 &&
        stats.teamProductTaskCount < editor.productPlanned;

      // Content ordering: new personal → new team → new global → repeat team → repeat global → repeat personal
      const personalContents = personalContentsByEditor.get(editor.userId) ?? [];
      const personalSourceContentIds = new Set(
        personalContents.filter((c) => c.source_content_id).map((c) => c.source_content_id!),
      );
      const filteredTeamContents = teamContentPool.filter(
        (tc) => !tc.source_content_id || !personalSourceContentIds.has(tc.source_content_id),
      );
      const filteredGlobalContents = globalContentPool.filter(
        (c) => !personalSourceContentIds.has(c.id),
      );

      const contentKey = (c: PoolContent) => `${c.source}:${c.id}`;
      const isNew = (c: PoolContent) => !stats.usedContentKeys.has(contentKey(c));

      const orderedContents: PoolContent[] = [
        ...personalContents.filter(isNew),
        ...filteredTeamContents.filter(isNew),
        ...filteredGlobalContents.filter(isNew),
        ...filteredTeamContents.filter((c) => !isNew(c)),
        ...filteredGlobalContents.filter((c) => !isNew(c)),
        ...personalContents.filter((c) => !isNew(c)),
      ];

      // Product ordering: ưu tiên theo tier (team > personal > global) rồi mới theo priority_score cao → thấp
      const personalProducts = personalProductsByEditor.get(editor.userId) ?? [];
      const personalSourceProductIds = new Set(
        personalProducts.filter((p) => p.source_product_id).map((p) => p.source_product_id!),
      );
      const filteredTeamProducts = teamProductPool.filter(
        (tp) => !tp.source_product_id || !personalSourceProductIds.has(tp.source_product_id),
      );
      const filteredGlobalProducts = globalProductPool.filter(
        (p) => !personalSourceProductIds.has(p.id),
      );

      const PRODUCT_TIER_RANK: Record<ProductSource, number> = {
        global: 0,
        personal: 1,
        team: 2,
      };

      // TH1: chỉ dùng kho team (sort priority_score desc)
      // TH2: global → personal → team, mỗi tier sort priority_score desc
      const orderedProducts: PoolProduct[] = isPhase1
        ? [...teamProductPool].sort((a, b) => b.priority_score - a.priority_score)
        : [...filteredGlobalProducts, ...personalProducts, ...filteredTeamProducts].sort(
            (a, b) =>
              PRODUCT_TIER_RANK[a.source] - PRODUCT_TIER_RANK[b.source] ||
              b.priority_score - a.priority_score,
          );

      if (!orderedProducts.length || !orderedContents.length) {
        this.logger.log(`Team ${teamId} editor ${editor.userId}: no candidates available`);
        continue;
      }

      const candidates = buildCandidates(orderedContents, orderedProducts);
      const available = candidates.filter(
        (c) =>
          !stats.existingPairs.has(
            `${c.contentSource}:${c.contentId}:${c.productSource}:${c.productId}`,
          ),
      );

      if (!available.length) {
        this.logger.log(`Team ${teamId} editor ${editor.userId}: all pairs already assigned`);
        continue;
      }

      const contentQuota = largestRemainder(
        editor.remainingDaily,
        editor.contentTypeWeights.length > 0 ? editor.contentTypeWeights : teamContentItems,
      );
      const productQuota = largestRemainder(
        editor.remainingDaily,
        editor.productTypeWeights.length > 0 ? editor.productTypeWeights : teamProductItems,
      );

      const selected = selectPairsForEditor(
        available,
        contentQuota,
        productQuota,
        editor.remainingDaily,
        FILL_STRATEGY,
      );

      this.logger.log(
        `Team ${teamId} editor ${editor.userId}: ` +
          `phase=${isPhase1 ? "TH1" : "TH2"} ` +
          `teamProductTasks=${stats.teamProductTaskCount}/${editor.productPlanned} ` +
          `daily=${editor.remainingDaily} monthly_rem=${editor.remainingMonthly} ` +
          `selected=${selected.length}`,
      );

      for (const candidate of selected) {
        allPairings.push({ editorId: editor.userId, candidate });
      }
    }

    const assigned = await persistPairings(
      this.prisma,
      teamId,
      runId,
      deadline,
      allPairings,
    );
    return { assigned, skipped: 0 };
  }

  // ── Team quota allocations ────────────────────────────────────────────────

  private async getQuotaAllocations(
    teamId: string,
    month: string,
  ): Promise<{ contentItems: QuotaItem[]; productItems: QuotaItem[] }> {
    const teamKpi = await this.prisma.teamKpi.findUnique({
      where: { team_id_month: { team_id: teamId, month } },
      include: { allocations: true },
    });
    if (!teamKpi) return { contentItems: [], productItems: [] };

    return {
      contentItems: teamKpi.allocations
        .filter((a) => a.type === "CONTENT_LINE" && a.content_line_id != null)
        .map((a) => ({ key: a.content_line_id!, weight: a.percent })),
      productItems: teamKpi.allocations
        .filter((a) => a.type === "PRODUCT_LINE" && a.product_line_id != null)
        .map((a) => ({ key: a.product_line_id!, weight: a.percent })),
    };
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

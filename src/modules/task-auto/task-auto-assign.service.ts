import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { AssignmentRunStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpdateAutoAssignSettingDto } from "./dto/settings.dto";

// ── Constants ────────────────────────────────────────────────────────────────

const DEADLINE_CALENDAR_DAYS = 1;
const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const FILL_STRATEGY: "CAPACITY" | "RATIO" = "CAPACITY";

// ── Data structures ──────────────────────────────────────────────────────────

type EditorSlot = {
  userId: string;
  remainingDaily: number;
  remainingMonthly: number;
  productPlanned: number;
  contentTypeWeights: QuotaItem[];
  productTypeWeights: QuotaItem[];
};

type EditorStats = {
  existingPairs: Set<string>;     // "contentId:productId" — all-time dedup
  usedContentIds: Set<string>;    // content IDs with any task for this editor (all-time)
  teamProductTaskCount: number;   // tasks using team products this month → TH1/TH2
};

type Candidate = {
  contentId: string;
  productId: string;
  contentLineId: string | null;
  productLineId: string | null;
  priorityScore: number;
};

type QuotaItem = { key: string; weight: number };

type Pairing = { editorId: string; candidate: Candidate };

type TeamResult = { assigned: number; skipped: number };

// ── Pure helpers ─────────────────────────────────────────────────────────────

function isWeekend(d: DateTime): boolean {
  return d.weekday >= 6;
}

function monthKey(d: DateTime): string {
  return d.toFormat("yyyy-MM");
}

function addCalendarDays(d: DateTime, n: number): DateTime {
  return d.plus({ days: n });
}

function remainingCalendarDays(today: DateTime): number {
  const last = today.endOf("month").startOf("day");
  const todayStart = today.startOf("day");
  const diff = Math.floor(last.diff(todayStart, "days").days) + 1;
  return Math.max(1, diff);
}

function deriveDailyTarget(
  monthlyTarget: number,
  doneThisMonth: number,
  today: DateTime,
): number {
  const remaining = Math.max(0, monthlyTarget - doneThisMonth);
  if (remaining === 0) return 0;
  const days = remainingCalendarDays(today);
  return Math.min(remaining, Math.ceil(remaining / days));
}

function largestRemainder(
  total: number,
  items: QuotaItem[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || !items.length) return out;
  const sumW = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (sumW <= 0) return out;
  const rows = items.map((i) => {
    const exact = (total * Math.max(0, i.weight)) / sumW;
    return { key: i.key, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = total - rows.reduce((s, r) => s + r.floor, 0);
  rows.sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : 1));
  for (let i = 0; i < left; i++) rows[i].floor++;
  for (const r of rows) out.set(r.key, r.floor);
  return out;
}

/**
 * Content-outer cross-product: candidate order mirrors content freshness ordering.
 * For each content (in new→repeated, personal→team→global order), all products
 * are listed in their priority order. This ensures selectPairsForEditor picks
 * new content first within each content-line quota bucket.
 */
function buildCandidates(
  contents: { id: string; content_line_id: string | null }[],
  products: { id: string; product_line_id: string | null; priority_score: number }[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const content of contents) {
    for (const product of products) {
      candidates.push({
        contentId: content.id,
        productId: product.id,
        contentLineId: content.content_line_id,
        productLineId: product.product_line_id,
        priorityScore: product.priority_score,
      });
    }
  }
  return candidates;
}

// ── Per-editor pair selection ─────────────────────────────────────────────────
//
// PASS 1 — Content-line quota: pick slots per content line,
//   prefer products matching product-line quota first.
// PASS 2 — Product-only quota when no content quota.
// RELAXED (CAPACITY): fill remaining slots with any unused candidate.

function selectPairsForEditor(
  candidates: Candidate[],
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  need: number,
  fillStrategy: "CAPACITY" | "RATIO",
): Candidate[] {
  const selected: Candidate[] = [];
  const chosen = new Set<string>();
  const remP = new Map(productQuota);
  const contentConstrained = contentQuota.size > 0;
  const productConstrained = productQuota.size > 0;

  const pairKey = (c: Candidate) => `${c.contentId}:${c.productId}`;

  const take = (c: Candidate) => {
    selected.push(c);
    chosen.add(pairKey(c));
    need--;
    if (productConstrained && c.productLineId) {
      remP.set(c.productLineId, (remP.get(c.productLineId) ?? 0) - 1);
    }
  };

  if (contentConstrained) {
    for (const [lineId, slots] of contentQuota) {
      const lineCandidates = candidates.filter((c) => c.contentLineId === lineId);
      let taken = 0;

      if (productConstrained) {
        for (const c of lineCandidates) {
          if (taken >= slots || need === 0) break;
          if (chosen.has(pairKey(c))) continue;
          if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0) {
            take(c);
            taken++;
          }
        }
      }

      for (const c of lineCandidates) {
        if (taken >= slots || need === 0) break;
        if (chosen.has(pairKey(c))) continue;
        take(c);
        taken++;
      }
    }
  } else if (productConstrained) {
    for (const c of candidates) {
      if (need === 0) break;
      if (chosen.has(pairKey(c))) continue;
      if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0) take(c);
    }
  }

  if (fillStrategy === "CAPACITY" && need > 0) {
    for (const c of candidates) {
      if (need === 0) break;
      if (chosen.has(pairKey(c))) continue;
      take(c);
    }
  }

  return selected;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TaskAutoAssignService {
  private readonly logger = new Logger(TaskAutoAssignService.name);

  constructor(private prisma: PrismaService) {}

  // ── Settings ─────────────────────────────────────────────────────────────

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

  // ── Cron ─────────────────────────────────────────────────────────────────

  @Cron("* * * * *", { name: "task-auto-assign" })
  async cronCheck() {
    // TẠM THỜI TẮT — bỏ dòng này khi muốn bật lại
    //return;
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

      const [hh, mm] = (settings.schedule_time || "17:00").split(":").map(Number);
      if (now.hour !== hh || now.minute !== mm) return;

      this.logger.log(`cronCheck: time matched ${settings.schedule_time} — checking dedup`);

      const windowStart = now.startOf("minute").toJSDate();
      const windowEnd = new Date(windowStart.getTime() + 60_000);
      const recentRun = await this.prisma.assignmentRun.findFirst({
        where: { run_at: { gte: windowStart, lt: windowEnd } },
      });
      if (recentRun) {
        this.logger.log(`cronCheck: skipped — run ${recentRun.id} already exists this minute`);
        return;
      }

      this.logger.log("cronCheck: launching runDailyAssignment");
      await this.runDailyAssignment(now, true);
    } catch (err) {
      this.logger.error("Cron check failed", err);
    }
  }

  async triggerManually(): Promise<{ assigned: number; skipped: number; runId: string }> {
    const now = DateTime.now().setZone(DEFAULT_TZ);
    return this.runDailyAssignment(now, true);
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  async runDailyAssignment(
    now: DateTime = DateTime.now().setZone(DEFAULT_TZ),
    forceRun = false,
  ): Promise<{ assigned: number; skipped: number; runId: string }> {
    const settings = await this.prisma.autoAssignSetting.findUnique({ where: { id: 1 } });
    if (!settings?.is_active) return { assigned: 0, skipped: 0, runId: "" };
    if (isWeekend(now) && !(settings.weekend_enabled ?? true))
      return { assigned: 0, skipped: 0, runId: "" };

    if (!forceRun) {
      const dayStart = now.startOf("day").toJSDate();
      const dayEnd = now.endOf("day").toJSDate();
      const existingDone = await this.prisma.assignmentRun.findFirst({
        where: { status: AssignmentRunStatus.DONE, run_at: { gte: dayStart, lte: dayEnd } },
      });
      if (existingDone) {
        this.logger.log(`Assignment already done today (run ${existingDone.id}), skipping`);
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
      const teams = await this.prisma.team.findMany({ where: { is_active: true } });
      let totalAssigned = 0;
      const details: Record<string, any> = {};

      for (const team of teams) {
        const result = await this.processTeam(team.id, now, month, monthStart, run.id, deadline);
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
    // 0. ContentLine a_type and ProductLine video_category mappings
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

    // 1. Eligible editors with per-editor quota weights
    const editors = await this.getEligibleEditors(
      teamId, now, month, monthStart, contentLineTypes, productLineTypes,
    );
    if (!editors.length) {
      this.logger.log(`Team ${teamId}: no eligible editors`);
      return { assigned: 0, skipped: 0 };
    }

    // 2. Team-level fallback allocations
    const { contentItems: teamContentItems, productItems: teamProductItems } =
      await this.getQuotaAllocations(teamId, month);

    // 3. Team content catalog — used to classify content into 3 tiers
    const teamContentRaw = await this.prisma.teamContent.findMany({
      where: { team_id: teamId },
      select: { content_id: true },
    });
    const teamContentIdSet = new Set(teamContentRaw.map((tc) => tc.content_id));

    // 4. All available contents (not ARCHIVED)
    const allContents = await this.prisma.content.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, content_line_id: true, user_id: true },
      orderBy: { created_at: "asc" },
    });

    // 5. Team product catalog + IDs for TH1/TH2 detection
    const teamProductRaw = await this.prisma.teamProduct.findMany({
      where: { team_id: teamId },
      select: {
        product: {
          select: {
            id: true,
            product_line_id: true,
            priority_score: true,
            is_active: true,
            user_id: true,
          },
        },
      },
    });
    const teamProducts = teamProductRaw.map((tp) => tp.product).filter((p) => p.is_active);
    const teamProductIdSet = new Set(teamProducts.map((p) => p.id));

    // 6. Personal products for all editors (1 query)
    const editorIds = editors.map((e) => e.userId);
    const personalProductsRaw = await this.prisma.product.findMany({
      where: { user_id: { in: editorIds }, is_active: true },
      select: { id: true, product_line_id: true, priority_score: true, is_active: true, user_id: true },
      orderBy: { priority_score: "desc" },
    });
    const personalProductsByEditor = new Map<string, typeof personalProductsRaw>();
    for (const p of personalProductsRaw) {
      if (!personalProductsByEditor.has(p.user_id!))
        personalProductsByEditor.set(p.user_id!, []);
      personalProductsByEditor.get(p.user_id!)!.push(p);
    }

    // 7. Batch editor stats (1 query: dedup pairs + content usage + team product count)
    const editorStats = await this.batchEditorStats(editorIds, teamProductIdSet, monthStart);

    // 8. Per-editor selection
    const allPairings: Pairing[] = [];

    for (const editor of editors) {
      if (editor.remainingDaily <= 0) continue;

      const stats = editorStats.get(editor.userId) ?? {
        existingPairs: new Set<string>(),
        usedContentIds: new Set<string>(),
        teamProductTaskCount: 0,
      };

      // ── TH1 / TH2 ──────────────────────────────────────────────────────────
      // TH1: chưa đủ KPI đẩy sản phẩm → pool sản phẩm = kho team, sort priority cao trước
      // TH2: đã đủ KPI → pool sản phẩm = kho cá nhân → kho team
      const isPhase1 =
        editor.productPlanned > 0 &&
        stats.teamProductTaskCount < editor.productPlanned;

      // ── Content: phân 3 tầng ────────────────────────────────────────────────
      // Tier 1 (cá nhân): user_id = editor
      // Tier 2 (team):    id in teamContentIdSet, không phải của editor
      // Tier 3 (tổng):    user_id = null, không trong team catalog
      const personalContents = allContents.filter((c) => c.user_id === editor.userId);
      const teamContents = allContents.filter(
        (c) => c.user_id !== editor.userId && teamContentIdSet.has(c.id),
      );
      const globalContents = allContents.filter(
        (c) => c.user_id === null && !teamContentIdSet.has(c.id),
      );

      // Content mới = chưa có task nào với editor này (all-time)
      const isNew = (c: { id: string }) => !stats.usedContentIds.has(c.id);

      // Thứ tự cuối:
      //   content MỚI:   cá nhân → team → tổng   (editor khám phá content mới của mình trước)
      //   content LẶP:   team → tổng → cá nhân   (ưu tiên content win đã qua kiểm chứng)
      const orderedContents = [
        ...personalContents.filter(isNew),
        ...teamContents.filter(isNew),
        ...globalContents.filter(isNew),
        ...teamContents.filter((c) => !isNew(c)),
        ...globalContents.filter((c) => !isNew(c)),
        ...personalContents.filter((c) => !isNew(c)),
      ];

      // ── Product pool ────────────────────────────────────────────────────────
      const personalProducts = personalProductsByEditor.get(editor.userId) ?? [];
      const personalProductIds = new Set(personalProducts.map((p) => p.id));
      const otherTeamProducts = teamProducts
        .filter((p) => !personalProductIds.has(p.id))
        .sort((a, b) => b.priority_score - a.priority_score);

      let orderedProducts: typeof teamProducts;
      if (isPhase1) {
        // TH1: toàn bộ kho team (kể cả sản phẩm cá nhân đã vào kho team), sort priority cao trước
        orderedProducts = [...teamProducts].sort((a, b) => b.priority_score - a.priority_score);
      } else {
        // TH2: kho cá nhân → kho team (không trùng)
        orderedProducts = [...personalProducts, ...otherTeamProducts];
      }

      if (!orderedProducts.length || !orderedContents.length) {
        this.logger.log(`Team ${teamId} editor ${editor.userId}: no candidates available`);
        continue;
      }

      // ── Build candidates (content-outer để freshness ordering được giữ nguyên) ──
      const candidates = buildCandidates(orderedContents, orderedProducts);

      const available = candidates.filter(
        (c) => !stats.existingPairs.has(`${c.contentId}:${c.productId}`),
      );

      if (!available.length) {
        this.logger.log(`Team ${teamId} editor ${editor.userId}: all pairs already assigned`);
        continue;
      }

      // ── Quota: editor-level weights, fallback về team-level ────────────────
      const useEditorContent = editor.contentTypeWeights.length > 0;
      const useEditorProduct = editor.productTypeWeights.length > 0;

      const contentQuota = largestRemainder(
        editor.remainingDaily,
        useEditorContent ? editor.contentTypeWeights : teamContentItems,
      );
      const productQuota = largestRemainder(
        editor.remainingDaily,
        useEditorProduct ? editor.productTypeWeights : teamProductItems,
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

    const assigned = await this.persistPairings(teamId, runId, deadline, allPairings);
    return { assigned, skipped: 0 };
  }

  // ── Eligible editors ──────────────────────────────────────────────────────

  private async getEligibleEditors(
    teamId: string,
    now: DateTime,
    month: string,
    monthStart: Date,
    contentLineTypes: { id: string; a_type: string | null }[],
    productLineTypes: { id: string; video_category: string | null }[],
  ): Promise<EditorSlot[]> {
    const members = await this.prisma.teamMember.findMany({
      where: { team_id: teamId },
      include: {
        user: {
          select: {
            id: true,
            is_active: true,
            editor_approvals: {
              where: { status: "APPROVED" },
              select: { id: true },
            },
            editor_kpis: {
              where: { month },
              select: {
                total_target: true,
                product_planned: true,
                ratio_a1: true,
                ratio_a2: true,
                ratio_a3: true,
                ratio_a4: true,
                ratio_a5: true,
                video_traffic: true,
                video_gmv: true,
                video_profit: true,
              },
            },
          },
        },
      },
    });

    const eligible = members
      .map((m) => m.user)
      .filter(
        (u) =>
          u.is_active &&
          u.editor_approvals.length > 0 &&
          u.editor_kpis[0]?.total_target > 0,
      );
    if (!eligible.length) return [];

    const userIds = eligible.map((u) => u.id);

    const autoRows = await this.prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        is_extra: false,
        assigned_at: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    });
    const autoCountMap = new Map(autoRows.map((r) => [r.assignee_id!, r._count.id]));

    const aTypeToField: Record<
      string,
      "ratio_a1" | "ratio_a2" | "ratio_a3" | "ratio_a4" | "ratio_a5"
    > = {
      A1: "ratio_a1",
      A2: "ratio_a2",
      A3: "ratio_a3",
      A4: "ratio_a4",
      A5: "ratio_a5",
    };

    const categoryToField: Record<string, "video_traffic" | "video_gmv" | "video_profit"> = {
      TRAFFIC: "video_traffic",
      GMV: "video_gmv",
      PROFIT: "video_profit",
    };

    const slots: EditorSlot[] = [];

    for (const u of eligible) {
      const kpi = u.editor_kpis[0];
      if (!kpi) continue;

      const assignedThisMonth = autoCountMap.get(u.id) ?? 0;
      const remainingMonthly = Math.max(0, kpi.total_target - assignedThisMonth);
      const dailyTarget = deriveDailyTarget(kpi.total_target, assignedThisMonth, now);
      const remainingDaily = Math.min(dailyTarget, remainingMonthly);

      if (remainingDaily <= 0) continue;

      const contentTypeWeights: QuotaItem[] = contentLineTypes
        .filter((cl) => cl.a_type && aTypeToField[cl.a_type])
        .map((cl) => ({ key: cl.id, weight: kpi[aTypeToField[cl.a_type!]] ?? 0 }))
        .filter((i) => i.weight > 0);

      const productTypeWeights: QuotaItem[] = productLineTypes
        .filter((pl) => pl.video_category && categoryToField[pl.video_category])
        .map((pl) => ({ key: pl.id, weight: kpi[categoryToField[pl.video_category!]] ?? 0 }))
        .filter((i) => i.weight > 0);

      slots.push({
        userId: u.id,
        remainingDaily,
        remainingMonthly,
        productPlanned: kpi.product_planned ?? 0,
        contentTypeWeights,
        productTypeWeights,
      });
    }

    return slots;
  }

  // ── Batch editor stats ────────────────────────────────────────────────────
  //
  // Single query returning per-editor:
  //   existingPairs      — all-time (content, product) dedup set
  //   usedContentIds     — all-time content IDs → "repeated" classification
  //   teamProductTaskCount — this-month tasks with team products → TH1/TH2

  private async batchEditorStats(
    editorIds: string[],
    teamProductIds: Set<string>,
    monthStart: Date,
  ): Promise<Map<string, EditorStats>> {
    const tasks = await this.prisma.task.findMany({
      where: {
        assignee_id: { in: editorIds },
        is_extra: false,
        status: { not: "CANCELLED" },
      },
      select: {
        assignee_id: true,
        content_id: true,
        product_id: true,
        assigned_at: true,
      },
    });

    const result = new Map<string, EditorStats>();

    for (const t of tasks) {
      const eid = t.assignee_id!;
      if (!result.has(eid)) {
        result.set(eid, {
          existingPairs: new Set(),
          usedContentIds: new Set(),
          teamProductTaskCount: 0,
        });
      }
      const stats = result.get(eid)!;

      if (t.content_id && t.product_id) {
        stats.existingPairs.add(`${t.content_id}:${t.product_id}`);
      }

      if (t.content_id) {
        stats.usedContentIds.add(t.content_id);
      }

      if (
        t.product_id &&
        teamProductIds.has(t.product_id) &&
        t.assigned_at != null &&
        t.assigned_at >= monthStart
      ) {
        stats.teamProductTaskCount++;
      }
    }

    return result;
  }

  // ── Team quota allocations (fallback khi editor không có per-editor weights) ──

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

  // ── Persist pairings ──────────────────────────────────────────────────────
  // Source resolution: editor-personal → team → global

  private async persistPairings(
    teamId: string,
    runId: string,
    deadline: Date,
    pairings: Pairing[],
  ): Promise<number> {
    if (!pairings.length) return 0;

    const productIds = [...new Set(pairings.map((p) => p.candidate.productId))];
    const editorIds = [...new Set(pairings.map((p) => p.editorId))];

    const outroSources = await this.prisma.source.findMany({
      where: {
        product_id: { in: productIds },
        type: "OUTRO",
        is_active: true,
        OR: [
          { user_id: { in: editorIds } },
          { team_id: teamId },
          { user_id: null, team_id: null },
        ],
      },
      select: { product_id: true, id: true, user_id: true, team_id: true },
    });

    const resolveOutro = (productId: string, editorId: string): string | null => {
      const srcs = outroSources.filter((s) => s.product_id === productId);
      return (
        srcs.find((s) => s.user_id === editorId)?.id ??
        srcs.find((s) => s.team_id === teamId)?.id ??
        srcs.find((s) => !s.user_id && !s.team_id)?.id ??
        null
      );
    };

    let created = 0;
    for (const { editorId, candidate } of pairings) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const task = await tx.task.create({
            data: {
              team_id: teamId,
              content_id: candidate.contentId,
              product_id: candidate.productId,
              content_line_id: candidate.contentLineId,
              source_outro_id: resolveOutro(candidate.productId, editorId),
              status: "ASSIGNED",
              assignee_id: editorId,
              assigned_at: new Date(),
              deadline,
              is_auto: true,
              is_extra: false,
              run_id: runId,
            },
          });

          await tx.taskAssignment.create({
            data: { task_id: task.id, user_id: editorId, deadline, run_id: runId },
          });

          await tx.notification.create({
            data: {
              user_id: editorId,
              type: "TASK_ASSIGNED",
              title: "Task mới được phân công tự động",
              body: `Bạn có task mới cần hoàn thành trước ${deadline.toLocaleDateString("vi-VN")}.`,
              task_id: task.id,
            },
          });

          created++;
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist pairing editor=${editorId} content=${candidate.contentId} product=${candidate.productId}`,
          err,
        );
      }
    }

    return created;
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

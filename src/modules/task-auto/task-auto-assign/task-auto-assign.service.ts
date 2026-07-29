import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { AssignmentRunStatus, BrandType, Prisma } from "@prisma/client";

import {
  isWeekend,
  monthKey,
  addCalendarDays,
  effectiveAssignmentDate,
  deriveDailyTarget,
} from "../../../utils/date.utils";
import { allocateByWeight, allocateWithCaps } from "../../../utils/quota.utils";
import { loadEligibleEditors } from "./steps/editor-eligibility";
import { loadEditorAssignmentHistory } from "./steps/editor-history";
import {
  loadProductQuotaState,
  snapshotTeamProductRemaining,
  consumeProductQuota,
} from "./steps/product-quota";
import { createTasksFromAssignments } from "./steps/task-creator";
import {
  buildEmptyWarehouseNotice,
  EmptyWarehouseNotice,
} from "./steps/warehouse-empty-notice";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PushService } from "@/common/push/push.service";
import { UpdateAutoAssignSettingDto } from "../settings/settings.dto";
import {
  DEADLINE_CALENDAR_DAYS,
  DEFAULT_TZ,
  EditorAssignmentHistory,
  emptyEditorAssignmentHistory,
  FILL_STRATEGY,
  ScheduledAssignment,
  AssignmentPair,
  ContentPoolItem,
  ProductPoolItem,
  WeightedAllocation,
  EditorCapacity,
  TeamResult,
} from "./types";
import {
  buildContentProductPairs,
  selectAssignmentsForEditor,
  selectPushAssignments,
} from "./steps/pair-builder";
import {
  MAX_COOLDOWN_LOOKBACK_DAYS,
  effectiveCooldownDays,
  isOnCooldown,
} from "./steps/cooldown";

@Injectable()
export class TaskAutoAssignService {
  private readonly logger = new Logger(TaskAutoAssignService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushService,
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
    const tomorrow = effectiveAssignmentDate(now);
    const month = monthKey(tomorrow);
    const monthStart = tomorrow.startOf("month").toJSDate();
    const deadline = addCalendarDays(now, DEADLINE_CALENDAR_DAYS).toJSDate();

    try {
      const teams = await this.prisma.team.findMany({
        where: { is_active: true },
      });
      let totalAssigned = 0;
      const details: Record<string, any> = {};

      for (const team of teams) {
        const result = await this.assignTasksForTeam(
          team.id,
          team.brand_type,
          now,
          month,
          monthStart,
          run.id,
          deadline,
          settings.default_cooldown_days ?? 0,
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

  private async assignTasksForTeam(
    teamId: string,
    teamBrandType: BrandType,
    now: DateTime,
    month: string,
    monthStart: Date,
    runId: string,
    deadline: Date,
    defaultCooldownDays: number,
  ): Promise<TeamResult> {
    // loadTeamQuotaWeights chỉ phụ thuộc teamId/month, không phụ thuộc danh sách editor —
    // chạy song song với loadEligibleEditors thay vì chờ tuần tự.
    const [editors, { contentWeights, productWeights }] = await Promise.all([
      loadEligibleEditors(this.prisma, teamId, now, month, monthStart),
      this.loadTeamQuotaWeights(teamId, month),
    ]);
    if (!editors.length) {
      this.logger.log(`Team ${teamId}: no eligible editors`);
      return { assigned: 0, skipped: 0 };
    }

    const editorIds = editors.map((e) => e.userId);

    // loadContentLineNames chỉ dùng để hiển thị (thông báo kho tháng rỗng) — chạy song song
    // với loadAssignmentPools thay vì chờ tuần tự.
    const [assignmentPools, contentLineNames] = await Promise.all([
      this.loadAssignmentPools(teamBrandType, teamId, editorIds, month),
      this.loadContentLineNames(editors, contentWeights),
    ]);
    const {
      teamContentPool,
      globalContentPool,
      teamProductPool,
      globalProductPool,
      personalContentsByEditor,
      personalProductsByEditor,
    } = assignmentPools;

    this.logger.log(
      `Team ${teamId} [${teamBrandType}]: ` +
        `teamContent=${teamContentPool.length} globalContent=${globalContentPool.length} ` +
        `teamProduct=${teamProductPool.length} globalProduct=${globalProductPool.length} ` +
        `personalEditors=${personalContentsByEditor.size}`,
    );

    const candidateContentIds = {
      global: globalContentPool.map((c) => c.id),
      team: teamContentPool.map((c) => c.id),
      personal: [...personalContentsByEditor.values()].flat().map((c) => c.id),
    };

    // Cửa sổ lookback cho cooldown: tính động theo cooldown lớn nhất đang cấu hình
    // (override từng sản phẩm hoặc default_cooldown_days), chặn trần để tránh quét quá xa.
    const allProductsForCooldown = [
      ...teamProductPool,
      ...globalProductPool,
      ...[...personalProductsByEditor.values()].flat(),
    ];
    const maxCooldownDays = Math.min(
      MAX_COOLDOWN_LOOKBACK_DAYS,
      Math.max(
        defaultCooldownDays,
        ...allProductsForCooldown.map((p) =>
          effectiveCooldownDays(p.cooldown_days, defaultCooldownDays),
        ),
      ),
    );
    const cooldownLookbackStart =
      maxCooldownDays > 0
        ? now.minus({ days: maxCooldownDays }).startOf("day").toJSDate()
        : null;

    const [historyMap, productQuotaState] = await Promise.all([
      loadEditorAssignmentHistory(
        this.prisma,
        editorIds,
        monthStart,
        now.startOf("day").toJSDate(),
        teamId,
        candidateContentIds,
        cooldownLookbackStart,
      ),
      loadProductQuotaState(this.prisma, teamId, editorIds, month, monthStart),
    ]);

    // ── Per-editor selection ──────────────────────────────────────────────
    const allAssignments: ScheduledAssignment[] = [];
    const emptyWarehouseNotices: EmptyWarehouseNotice[] = [];

    for (const editor of editors) {
      if (editor.remainingDaily <= 0) continue;

      const history: EditorAssignmentHistory =
        historyMap.get(editor.userId) ?? emptyEditorAssignmentHistory();

      // Push quota: rải đều product_planned (SP riêng biệt) theo các ngày còn lại
      // của tháng, giống cơ chế deriveDailyTarget của total_target.
      const pushDailyTarget = deriveDailyTarget(
        editor.productPlanned,
        history.pushedProductIdsBeforeToday.size,
        now,
      );
      const pushedNewToday =
        history.pushedProductIds.size -
        history.pushedProductIdsBeforeToday.size;
      const pushNeed = Math.min(
        Math.max(0, pushDailyTarget - pushedNewToday),
        editor.remainingDaily,
      );

      const personalContents =
        personalContentsByEditor.get(editor.userId) ?? [];
      const personalSourceContentIds = new Set(
        personalContents
          .filter((c) => c.source_content_id)
          .map((c) => c.source_content_id!),
      );
      const filteredTeamContents = teamContentPool.filter(
        (tc) =>
          !tc.source_content_id ||
          !personalSourceContentIds.has(tc.source_content_id),
      );
      const filteredGlobalContents = globalContentPool.filter(
        (c) => !personalSourceContentIds.has(c.id),
      );

      const contentKey = (c: ContentPoolItem) => `${c.source}:${c.id}`;
      const isNewContent = (c: ContentPoolItem) =>
        !history.assignedContentKeys.has(contentKey(c));

      // Lane đẩy SP: content global → cá nhân → team (content mới trước, lặp lại sau)
      const pushOrderedContents: ContentPoolItem[] = [
        ...filteredGlobalContents.filter(isNewContent),
        ...personalContents.filter(isNewContent),
        ...filteredTeamContents.filter(isNewContent),
        ...filteredGlobalContents.filter((c) => !isNewContent(c)),
        ...personalContents.filter((c) => !isNewContent(c)),
        ...filteredTeamContents.filter((c) => !isNewContent(c)),
      ];

      // Lane sáng tạo: content cá nhân → team → global (content mới trước, lặp lại sau)
      const creativeOrderedContents: ContentPoolItem[] = [
        ...personalContents.filter(isNewContent),
        ...filteredTeamContents.filter(isNewContent),
        ...filteredGlobalContents.filter(isNewContent),
        ...personalContents.filter((c) => !isNewContent(c)),
        ...filteredTeamContents.filter((c) => !isNewContent(c)),
        ...filteredGlobalContents.filter((c) => !isNewContent(c)),
      ];

      const personalProducts =
        personalProductsByEditor.get(editor.userId) ?? [];
      const personalSourceProductIds = new Set(
        personalProducts
          .filter((p) => p.source_product_id)
          .map((p) => p.source_product_id!),
      );
      const filteredTeamProducts = teamProductPool.filter(
        (tp) =>
          !tp.source_product_id ||
          !personalSourceProductIds.has(tp.source_product_id),
      );
      const filteredGlobalProducts = globalProductPool.filter(
        (p) => !personalSourceProductIds.has(p.id),
      );

      // Chỉ tiêu target_quantity còn lại theo góc nhìn editor này (team-wide,
      // trừ khi editor là "editor gốc" có override cá nhân — xem product-quota.ts).
      const teamStockForEditor = snapshotTeamProductRemaining(
        productQuotaState,
        editor.userId,
      );
      const personalStockForEditor =
        productQuotaState.personalRemaining.get(editor.userId) ?? new Map<string, number>();

      // Cooldown per (editor, product): sản phẩm đã giao cho editor này trong vòng
      // chưa đủ cooldown_days bị loại khỏi 2 lane chính; SP kho team bị loại vẫn có
      // thể "lọt" qua lane lấp đầy (extraSelected) bên dưới — SP cá nhân/global bị
      // loại thì overflow chung của cooldownTeamProducts đã đủ làm lưới an toàn.
      const onCooldown = (p: ProductPoolItem) =>
        isOnCooldown(p, history.lastAssignedByProduct, defaultCooldownDays, now);
      const availableTeamProducts = filteredTeamProducts.filter((p) => !onCooldown(p));
      const cooldownTeamProducts = filteredTeamProducts.filter(onCooldown);

      // Lane đẩy SP: luôn kho team — SP còn thiếu target_quantity lên đầu, rồi
      // priority_score, rồi cờ "đã pushed" (lịch sử) làm tie-break cuối.
      const pushProducts: ProductPoolItem[] = [...availableTeamProducts].sort(
        (a, b) => {
          const aHasStock = (teamStockForEditor.get(a.id) ?? 0) > 0;
          const bHasStock = (teamStockForEditor.get(b.id) ?? 0) > 0;
          return (
            Number(bHasStock) - Number(aHasStock) ||
            b.priority_score - a.priority_score ||
            Number(history.pushedProductIds.has(a.id)) -
              Number(history.pushedProductIds.has(b.id))
          );
        },
      );

      // Lane sáng tạo: SP cá nhân → global (kho team chỉ dành cho đẩy kế hoạch).
      // SP cá nhân đã đủ target_quantity rơi xuống tier overflow (dưới cả global).
      const creativeRank = (p: ProductPoolItem): number => {
        if (p.source !== "personal") return 1; // global — luôn "còn hàng"
        return (personalStockForEditor.get(p.id) ?? 0) > 0 ? 0 : 2;
      };
      const creativeProducts: ProductPoolItem[] = [
        ...personalProducts,
        ...filteredGlobalProducts,
      ]
        .filter((p) => !onCooldown(p))
        .sort(
          (a, b) =>
            creativeRank(a) - creativeRank(b) || b.priority_score - a.priority_score,
        );

      // Quota theo tuyến/dòng: chia cap còn lại giữa 2 lane theo thứ tự
      const contentCaps = new Map(editor.contentLineRemaining);
      const productCaps = new Map(editor.productLineRemaining);
      const quotaFor = (need: number) => ({
        contentQuota:
          editor.contentTypeWeights.length > 0
            ? allocateWithCaps(need, editor.contentTypeWeights, contentCaps)
            : allocateByWeight(need, contentWeights),
        productQuota:
          editor.productTypeWeights.length > 0
            ? allocateWithCaps(need, editor.productTypeWeights, productCaps)
            : allocateByWeight(need, productWeights),
      });
      const consumeCaps = (pairs: AssignmentPair[]) => {
        for (const p of pairs) {
          if (p.contentLineId != null)
            contentCaps.set(
              p.contentLineId,
              Math.max(0, (contentCaps.get(p.contentLineId) ?? 0) - 1),
            );
          if (p.productLineId != null)
            productCaps.set(
              p.productLineId,
              Math.max(0, (productCaps.get(p.productLineId) ?? 0) - 1),
            );
        }
      };
      const pairKeyOf = (p: AssignmentPair) =>
        `${p.contentSource}:${p.contentId}:${p.productSource}:${p.productId}`;

      // ── Lane 1: đẩy SP theo kế hoạch ────────────────────────────────────
      let pushSelected: AssignmentPair[] = [];
      if (pushNeed > 0 && pushProducts.length && pushOrderedContents.length) {
        const { contentQuota, productQuota } = quotaFor(pushNeed);
        pushSelected = selectPushAssignments(
          pushOrderedContents,
          pushProducts,
          pushNeed,
          history.assignedPairKeys,
          contentQuota,
          productQuota,
          teamStockForEditor,
        );
        consumeCaps(pushSelected);
      }

      // ── Lane 2: task sáng tạo (không đẩy SP kế hoạch) ───────────────────
      const creativeNeed = editor.remainingDaily - pushSelected.length;
      let creativeSelected: AssignmentPair[] = [];
      if (
        creativeNeed > 0 &&
        creativeProducts.length &&
        creativeOrderedContents.length
      ) {
        const pairs = buildContentProductPairs(
          creativeOrderedContents,
          creativeProducts,
        );
        const available = pairs.filter(
          (p) => !history.assignedPairKeys.has(pairKeyOf(p)),
        );
        if (available.length) {
          const { contentQuota, productQuota } = quotaFor(creativeNeed);
          creativeSelected = selectAssignmentsForEditor(
            available,
            contentQuota,
            productQuota,
            creativeNeed,
            FILL_STRATEGY,
            personalStockForEditor,
          );
          consumeCaps(creativeSelected);
        }
      }

      // ── Lấp đầy: nếu lane sáng tạo cạn nguồn, bù bằng SP kho team ───────
      let extraSelected: AssignmentPair[] = [];
      const shortfall =
        editor.remainingDaily - pushSelected.length - creativeSelected.length;
      if (shortfall > 0 && pushProducts.length && pushOrderedContents.length) {
        const usedKeys = new Set([
          ...history.assignedPairKeys,
          ...pushSelected.map(pairKeyOf),
        ]);
        // productStock cố ý bỏ trống (Map rỗng = không giới hạn): đây là lane
        // overflow, dùng để lấp đầy khi mọi SP đã đủ target_quantity. SP đang
        // cooldown (cooldownTeamProducts) chỉ được phép "lọt" qua đúng lane này.
        extraSelected = selectPushAssignments(
          pushOrderedContents,
          [...pushProducts, ...cooldownTeamProducts],
          shortfall,
          usedKeys,
          new Map(),
          new Map(),
          new Map(),
        );
      }

      const selected = [...pushSelected, ...extraSelected, ...creativeSelected];
      // Phải consume cho CẢ 3 mảng (kể cả extraSelected) vì overflow cũng tiêu
      // tốn "hàng" thật — khác với consumeCaps (line-quota) vốn không cần áp
      // dụng cho extraSelected vì các cap đó không được đọc lại sau đó.
      consumeProductQuota(productQuotaState, editor.userId, selected);
      if (!selected.length) {
        // Kho tháng rỗng cho editor này (cả 3 lane đều không bắt được cặp nào) — không tạo
        // task được, nhưng vẫn tính đúng số liệu hiện tại (remainingDaily/contentQuota/KPI đẩy SP)
        // để báo cho editor biết hôm nay cần làm gì.
        const notice = buildEmptyWarehouseNotice({
          editorId: editor.userId,
          remainingDaily: editor.remainingDaily,
          productPlanned: editor.productPlanned,
          pushedProductIds: history.pushedProductIds,
          pushProducts,
          contentQuota: quotaFor(editor.remainingDaily).contentQuota,
          contentLineNames,
        });
        if (notice) emptyWarehouseNotices.push(notice);
        this.logger.log(
          `Team ${teamId} editor ${editor.userId}: no candidates available` +
            (notice ? " — kho tháng rỗng, đã tạo thông báo" : ""),
        );
        continue;
      }

      this.logger.log(
        `Team ${teamId} editor ${editor.userId}: ` +
          `push=${pushSelected.length}/${pushNeed} extra=${extraSelected.length} creative=${creativeSelected.length} ` +
          `pushedMonth=${history.pushedProductIds.size}/${editor.productPlanned} ` +
          `daily=${editor.remainingDaily} monthly_rem=${editor.remainingMonthly}`,
      );

      for (const pair of selected) {
        allAssignments.push({ editorId: editor.userId, pair });
      }
    }

    const [assigned] = await Promise.all([
      createTasksFromAssignments(
        this.prisma,
        this.pushService,
        teamId,
        teamBrandType,
        runId,
        deadline,
        allAssignments,
      ),
      emptyWarehouseNotices.length
        ? this.createEmptyWarehouseNotifications(emptyWarehouseNotices)
        : Promise.resolve(),
    ]);
    return { assigned, skipped: 0 };
  }

  // ── Thông báo kho tháng rỗng: batch insert + push, tương tự createTasksFromAssignments ────

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

  // ── Load tên tuyến nội dung để hiển thị trong thông báo kho tháng rỗng ─────

  private async loadContentLineNames(
    editors: EditorCapacity[],
    contentWeights: WeightedAllocation[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const w of contentWeights) ids.add(w.key);
    for (const e of editors) {
      for (const w of e.contentTypeWeights) ids.add(w.key);
    }
    if (!ids.size) return new Map();

    const lines = await this.prisma.contentLine.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(lines.map((l) => [l.id, l.name]));
  }

  // ── Load content & product pools: lọc theo brand type + kho tháng ─────────

  private async loadAssignmentPools(
    brandType: BrandType,
    teamId: string,
    editorIds: string[],
    month: string,
  ): Promise<{
    teamContentPool: ContentPoolItem[];
    globalContentPool: ContentPoolItem[];
    teamProductPool: ProductPoolItem[];
    globalProductPool: ProductPoolItem[];
    personalContentsByEditor: Map<string, ContentPoolItem[]>;
    personalProductsByEditor: Map<string, ProductPoolItem[]>;
  }> {
    // Đợt 1: 4 lookup không phụ thuộc nhau (team/personal content/product) — chạy song song.
    // (global content/product phải chờ đợt 1 vì cần loại trừ id đã có trong kho team, xem dưới.)
    const [teamContentsRaw, teamProductsRaw, personalContentsRaw, personalProductsRaw] =
      await Promise.all([
        this.prisma.teamContent.findMany({
          where: {
            team_id: teamId,
            status: { not: "ARCHIVED" },
            brand_type: brandType,
            warehouses: { some: { month } },
          },
          select: {
            id: true,
            content_line_id: true,
            source_content_id: true,
            source_editor_content_id: true,
            source_editor_content: {
              select: { content_line_id: true, source_content_id: true },
            },
            added_at: true,
          },
          orderBy: { added_at: "asc" },
        }),
        this.prisma.teamProduct.findMany({
          where: {
            team_id: teamId,
            is_active: true,
            brand_type: brandType,
            warehouses: { some: { month } },
          },
          select: {
            id: true,
            name: true,
            product_line_id: true,
            priority_score: true,
            cooldown_days: true,
            source_product_id: true,
            source_editor_product_id: true,
            source_editor_product: {
              select: { name: true, product_line_id: true, source_product_id: true },
            },
          },
          orderBy: { priority_score: "desc" },
        }),
        this.prisma.editorContent.findMany({
          where: {
            user_id: { in: editorIds },
            status: { not: "ARCHIVED" },
            brand_type: brandType,
            warehouses: { some: { month } },
          },
          select: {
            id: true,
            content_line_id: true,
            source_content_id: true,
            user_id: true,
          },
          orderBy: { added_at: "asc" },
        }),
        this.prisma.editorProduct.findMany({
          where: {
            user_id: { in: editorIds },
            is_active: true,
            brand_type: brandType,
            warehouses: { some: { month } },
          },
          select: {
            id: true,
            product_line_id: true,
            priority_score: true,
            cooldown_days: true,
            user_id: true,
            source_product_id: true,
          },
          orderBy: { priority_score: "desc" },
        }),
      ]);

    const teamContentPool: ContentPoolItem[] = teamContentsRaw.map((tc) => ({
      id: tc.id,
      content_line_id:
        tc.content_line_id ?? tc.source_editor_content?.content_line_id ?? null,
      source: "team" as const,
      source_content_id:
        tc.source_content_id ??
        tc.source_editor_content?.source_content_id ??
        null,
    }));
    const teamSourceContentIds = new Set(
      teamContentPool
        .filter((tc) => tc.source_content_id)
        .map((tc) => tc.source_content_id!),
    );

    const teamProductPool: ProductPoolItem[] = teamProductsRaw.map((tp) => ({
      id: tp.id,
      name: tp.name ?? tp.source_editor_product?.name ?? null,
      product_line_id:
        tp.product_line_id ?? tp.source_editor_product?.product_line_id ?? null,
      priority_score: tp.priority_score,
      cooldown_days: tp.cooldown_days,
      source: "team" as const,
      source_product_id:
        tp.source_product_id ??
        tp.source_editor_product?.source_product_id ??
        null,
    }));
    const teamSourceProductIds = new Set(
      teamProductPool
        .filter((tp) => tp.source_product_id)
        .map((tp) => tp.source_product_id!),
    );

    // Đợt 2: global content/product — 2 lookup độc lập nhau (chỉ cùng phụ thuộc kết quả đợt 1
    // để loại trừ id đã có trong kho team).
    const [allGlobalContents, globalProductsRaw] = await Promise.all([
      this.prisma.content.findMany({
        where: {
          status: { not: "ARCHIVED" },
          brand_type: brandType,
          warehouses: { some: { month } },
          ...(teamSourceContentIds.size > 0
            ? { NOT: { id: { in: [...teamSourceContentIds] } } }
            : {}),
        },
        select: {
          id: true,
          content_line_id: true,
          source_team_content: {
            select: {
              content_line_id: true,
              source_editor_content: { select: { content_line_id: true } },
            },
          },
        },
        orderBy: { created_at: "asc" },
      }),
      this.prisma.product.findMany({
        where: {
          is_active: true,
          brand_type: brandType,
          warehouses: { some: { month } },
          ...(teamSourceProductIds.size > 0
            ? { NOT: { id: { in: [...teamSourceProductIds] } } }
            : {}),
        },
        select: {
          id: true,
          product_line_id: true,
          priority_score: true,
          cooldown_days: true,
          source_team_product: {
            select: {
              product_line_id: true,
              source_editor_product: { select: { product_line_id: true } },
            },
          },
        },
        orderBy: { priority_score: "desc" },
      }),
    ]);
    const globalContentPool: ContentPoolItem[] = allGlobalContents.map((c) => ({
      id: c.id,
      content_line_id:
        c.content_line_id ??
        c.source_team_content?.content_line_id ??
        c.source_team_content?.source_editor_content?.content_line_id ??
        null,
      source: "global" as const,
      source_content_id: null,
    }));
    const globalProductPool: ProductPoolItem[] = globalProductsRaw.map((p) => ({
      id: p.id,
      product_line_id:
        p.product_line_id ??
        p.source_team_product?.product_line_id ??
        p.source_team_product?.source_editor_product?.product_line_id ??
        null,
      priority_score: p.priority_score,
      cooldown_days: p.cooldown_days,
      source: "global" as const,
      source_product_id: null,
    }));

    const personalContentsByEditor = new Map<string, ContentPoolItem[]>();
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

    const personalProductsByEditor = new Map<string, ProductPoolItem[]>();
    for (const p of personalProductsRaw) {
      if (!personalProductsByEditor.has(p.user_id))
        personalProductsByEditor.set(p.user_id, []);
      personalProductsByEditor.get(p.user_id)!.push({
        id: p.id,
        product_line_id: p.product_line_id,
        priority_score: p.priority_score,
        cooldown_days: p.cooldown_days,
        source: "personal",
        source_product_id: p.source_product_id,
      });
    }

    return {
      teamContentPool,
      globalContentPool,
      teamProductPool,
      globalProductPool,
      personalContentsByEditor,
      personalProductsByEditor,
    };
  }

  // ── Load team KPI quota weights ───────────────────────────────────────────

  private async loadTeamQuotaWeights(
    teamId: string,
    month: string,
  ): Promise<{
    contentWeights: WeightedAllocation[];
    productWeights: WeightedAllocation[];
  }> {
    const teamKpi = await this.prisma.teamKpi.findUnique({
      where: { team_id_month: { team_id: teamId, month } },
      include: { allocations: true },
    });
    if (!teamKpi) return { contentWeights: [], productWeights: [] };

    return {
      contentWeights: teamKpi.allocations
        .filter((a) => a.type === "CONTENT_LINE" && a.content_line_id != null)
        .map((a) => ({ key: a.content_line_id!, weight: a.percent })),
      productWeights: teamKpi.allocations
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

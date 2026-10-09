import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { KpiAllocationType, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { vietnamMonthString } from "../../../utils/date.utils";

const VN_TZ = "Asia/Ho_Chi_Minh";

/** Chép vài trăm dòng KPI + phân bổ trong 1 transaction — 5s mặc định của Prisma không đủ với DB ở xa. */
const ROLLOVER_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** Mọi cột chỉ tiêu của editor_kpis — tất cả đều là MỤC TIÊU nhập tay, không có cột số thực đạt. */
const EDITOR_KPI_TARGET_FIELDS = [
  "total_target",
  "video_win",
  "video_fail",
  "kpi_extra",
  "content_new",
  "content_paast_analyzed",
  "content_win_cover",
  "product_gmv",
  "product_traffic",
  "product_profit",
  "product_collect_test_win",
] as const;

type EditorKpiTargets = Record<(typeof EDITOR_KPI_TARGET_FIELDS)[number], number>;

type Db = Prisma.TransactionClient;

export type KpiRolloverTrigger = "CRON" | "AUTO_ASSIGN";

export interface KpiRolloverResult {
  month: string;
  source_month: string;
  editor_kpis_copied: number;
  creator_kpis_copied: number;
}

interface KpiRowKey {
  id: string;
  user_id: string;
  team_id: string | null;
}

interface EditorKpiRow extends KpiRowKey, EditorKpiTargets {
  set_by_id: string;
  allocations: {
    type: KpiAllocationType;
    content_line_id: string | null;
    product_line_id: string | null;
    quantity: number;
  }[];
}

interface CreatorKpiRow extends KpiRowKey {
  set_by_id: string;
  content_target: number;
  translation_target: number;
}

const EDITOR_KPI_SELECT = {
  id: true,
  user_id: true,
  team_id: true,
  set_by_id: true,
  total_target: true,
  video_win: true,
  video_fail: true,
  kpi_extra: true,
  content_new: true,
  content_paast_analyzed: true,
  content_win_cover: true,
  product_gmv: true,
  product_traffic: true,
  product_profit: true,
  product_collect_test_win: true,
  allocations: {
    select: { type: true, content_line_id: true, product_line_id: true, quantity: true },
  },
} as const;

const CREATOR_KPI_SELECT = {
  id: true,
  user_id: true,
  team_id: true,
  set_by_id: true,
  content_target: true,
  translation_target: true,
} as const;

export function previousMonthKey(month: string): string {
  return DateTime.fromFormat(month, "yyyy-MM").minus({ months: 1 }).toFormat("yyyy-MM");
}

export const rolloverKey = (userId: string, teamId: string) => `${userId}|${teamId}`;

/** Dòng chỉ tiêu toàn 0 = chưa đặt (dòng seed lúc thêm thành viên vào team, xem seedEditorKpiForMembers). */
export function isEmptyEditorKpi(row: EditorKpiRow): boolean {
  return (
    EDITOR_KPI_TARGET_FIELDS.every((f) => !row[f]) &&
    row.allocations.every((a) => a.quantity <= 0)
  );
}

export function isEmptyCreatorKpi(row: CreatorKpiRow): boolean {
  return !row.content_target && !row.translation_target;
}

/**
 * Chọn dòng KPI tháng trước cần chép sang tháng mới: chỉ dòng có chỉ tiêu, người đó vẫn còn ở team
 * (`inTeam`), và tháng mới chưa có dòng (→ tạo) hoặc có dòng nhưng toàn 0 (→ điền đè). Tháng mới đã có
 * chỉ tiêu = leader đặt trước rồi, giữ nguyên.
 */
export function planKpiRollover<R extends KpiRowKey>(
  sources: R[],
  targets: R[],
  inTeam: Set<string>,
  isEmpty: (row: R) => boolean,
): { create: R[]; fill: { source: R; targetId: string }[] } {
  const targetByKey = new Map(
    targets
      .filter((t) => t.team_id)
      .map((t) => [rolloverKey(t.user_id, t.team_id!), t]),
  );
  const create: R[] = [];
  const fill: { source: R; targetId: string }[] = [];
  for (const source of sources) {
    if (!source.team_id || isEmpty(source)) continue;
    const key = rolloverKey(source.user_id, source.team_id);
    if (!inTeam.has(key)) continue;
    const existing = targetByKey.get(key);
    if (!existing) create.push(source);
    else if (isEmpty(existing)) fill.push({ source, targetId: existing.id });
  }
  return { create, fill };
}

function pickEditorTargets(row: EditorKpiRow): EditorKpiTargets {
  return Object.fromEntries(
    EDITOR_KPI_TARGET_FIELDS.map((f) => [f, row[f]]),
  ) as EditorKpiTargets;
}

/**
 * Cặp (user, team) còn hiệu lực: user đang hoạt động, team đang bật, user là thành viên HOẶC leader
 * của team (leader được tự đặt KPI cho mình mà không cần dòng team_members — xem upsertEditorKpi).
 */
async function loadActiveMemberships(db: Db, rows: KpiRowKey[]): Promise<Set<string>> {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter((id): id is string => !!id))];
  if (!userIds.length || !teamIds.length) return new Set();
  const [activeUsers, members, ledTeams] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds }, is_active: true, deleted_at: null },
      select: { id: true },
    }),
    db.teamMember.findMany({
      where: { user_id: { in: userIds }, team_id: { in: teamIds }, team: { is_active: true } },
      select: { user_id: true, team_id: true },
    }),
    db.team.findMany({
      where: { id: { in: teamIds }, is_active: true, leader_id: { in: userIds } },
      select: { id: true, leader_id: true },
    }),
  ]);
  const active = new Set(activeUsers.map((u) => u.id));
  const pairs = [
    ...members.map((m) => [m.user_id, m.team_id] as const),
    ...ledTeams.map((t) => [t.leader_id!, t.id] as const),
  ];
  return new Set(
    pairs.filter(([userId]) => active.has(userId)).map(([userId, teamId]) => rolloverKey(userId, teamId)),
  );
}

async function copyEditorKpis(db: Db, sourceMonth: string, month: string): Promise<number> {
  const sources: EditorKpiRow[] = await db.editorKpi.findMany({
    where: { month: sourceMonth, team_id: { not: null } },
    select: EDITOR_KPI_SELECT,
  });
  if (!sources.length) return 0;
  const [targets, inTeam] = await Promise.all([
    db.editorKpi.findMany({
      where: { month, user_id: { in: [...new Set(sources.map((s) => s.user_id))] } },
      select: EDITOR_KPI_SELECT,
    }),
    loadActiveMemberships(db, sources),
  ]);
  const plan = planKpiRollover(sources, targets, inTeam, isEmptyEditorKpi);

  // Id tạo trước để gắn phân bổ tuyến/dòng SP bằng 1 câu createMany thay vì create lồng từng dòng.
  const created = plan.create.map((source) => ({ id: randomUUID(), source }));
  if (created.length) {
    await db.editorKpi.createMany({
      data: created.map(({ id, source }) => ({
        id,
        user_id: source.user_id,
        team_id: source.team_id,
        month,
        set_by_id: source.set_by_id,
        ...pickEditorTargets(source),
      })),
    });
  }
  for (const { source, targetId } of plan.fill) {
    await db.editorKpi.update({
      where: { id: targetId },
      data: { ...pickEditorTargets(source), set_by_id: source.set_by_id },
    });
  }
  if (plan.fill.length) {
    await db.editorKpiAllocation.deleteMany({
      where: { editor_kpi_id: { in: plan.fill.map((f) => f.targetId) } },
    });
  }
  const allocations = [
    ...created.map(({ id, source }) => ({ kpiId: id, source })),
    ...plan.fill.map(({ targetId, source }) => ({ kpiId: targetId, source })),
  ].flatMap(({ kpiId, source }) =>
    source.allocations.map((a) => ({ editor_kpi_id: kpiId, ...a })),
  );
  if (allocations.length) await db.editorKpiAllocation.createMany({ data: allocations });
  return created.length + plan.fill.length;
}

async function copyContentCreatorKpis(db: Db, sourceMonth: string, month: string): Promise<number> {
  const sources: CreatorKpiRow[] = await db.contentCreatorKpi.findMany({
    where: { month: sourceMonth },
    select: CREATOR_KPI_SELECT,
  });
  if (!sources.length) return 0;
  const [targets, inTeam] = await Promise.all([
    db.contentCreatorKpi.findMany({
      where: { month, user_id: { in: [...new Set(sources.map((s) => s.user_id))] } },
      select: CREATOR_KPI_SELECT,
    }),
    loadActiveMemberships(db, sources),
  ]);
  const plan = planKpiRollover(sources, targets, inTeam, isEmptyCreatorKpi);
  // Ghi chú tháng trước không chép — thường gắn với hoàn cảnh riêng của tháng đó.
  const targetsOf = (s: CreatorKpiRow) => ({
    content_target: s.content_target,
    translation_target: s.translation_target,
    set_by_id: s.set_by_id,
  });
  if (plan.create.length) {
    await db.contentCreatorKpi.createMany({
      data: plan.create.map((s) => ({ user_id: s.user_id, team_id: s.team_id!, month, ...targetsOf(s) })),
    });
  }
  for (const { source, targetId } of plan.fill) {
    await db.contentCreatorKpi.update({ where: { id: targetId }, data: targetsOf(source) });
  }
  return plan.create.length + plan.fill.length;
}

/**
 * KPI tháng ít đổi giữa các tháng → sang tháng mới, ai chưa được đặt KPI thì tự nhận chỉ tiêu y như
 * tháng trước (editor_kpis kèm phân bổ tuyến/dòng SP, content_creator_kpis). KPI ngày và KPI/OKR bổ
 * sung (performance_goals) không chép. Leader sửa lại như bình thường sau khi chép.
 */
@Injectable()
export class KpiRolloverService {
  private readonly logger = new Logger(KpiRolloverService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Lưới an toàn khi auto-assign tắt hoặc lượt chạy ngày cuối tháng không chạy — chạy mỗi ngày, nhưng
   * tháng đã chép thì chỉ tốn 1 query đọc mốc.
   */
  @Cron("0 5 0 * * *", { name: "kpi-month-rollover", timeZone: VN_TZ })
  async cronRollover(): Promise<void> {
    try {
      await this.ensureMonthRollover(vietnamMonthString(), "CRON");
    } catch (err) {
      this.logger.error("Chép KPI tháng mới thất bại", err);
    }
  }

  /**
   * Chép KPI tháng trước sang `month` nếu tháng đó chưa chép lần nào (bảng kpi_month_rollovers).
   * Trả null khi đã chép từ trước. Auto-assign gọi với tháng của NGÀY ĐƯỢC CHIA — lượt chạy ngày
   * cuối tháng đã đọc KPI tháng sau.
   */
  async ensureMonthRollover(
    month: string,
    trigger: KpiRolloverTrigger,
  ): Promise<KpiRolloverResult | null> {
    const done = await this.prisma.kpiMonthRollover.findUnique({
      where: { month },
      select: { month: true },
    });
    if (done) return null;

    const sourceMonth = previousMonthKey(month);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Ghi mốc TRƯỚC khi chép: 2 tiến trình chạy cùng lúc thì bên sau vướng khoá chính và bỏ qua.
        await tx.kpiMonthRollover.create({
          data: { month, source_month: sourceMonth, trigger },
        });
        const editor_kpis_copied = await copyEditorKpis(tx, sourceMonth, month);
        const creator_kpis_copied = await copyContentCreatorKpis(tx, sourceMonth, month);
        await tx.kpiMonthRollover.update({
          where: { month },
          data: { editor_kpis_copied, creator_kpis_copied },
        });
        return { month, source_month: sourceMonth, editor_kpis_copied, creator_kpis_copied };
      }, ROLLOVER_TX_OPTIONS);
      this.logger.log(
        `Chép KPI ${sourceMonth} → ${month} (${trigger}): ${result.editor_kpis_copied} KPI editor, ` +
          `${result.creator_kpis_copied} KPI content creator`,
      );
      return result;
    } catch (err: any) {
      if (err?.code === "P2002") return null;
      throw err;
    }
  }
}

import { DateTime } from "luxon";
import {
  deriveDailyTarget,
  effectiveAssignmentDate,
  dailyKpiDate,
} from "../../../../utils/date.utils";
import { EditorCapacity, WeightedAllocation } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

export async function loadEligibleEditors(
  prisma: PrismaService,
  teamId: string,
  now: DateTime,
  month: string,
  monthStart: Date,
): Promise<EditorCapacity[]> {
  const members = await prisma.teamMember.findMany({
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
            where: { month, team_id: teamId }, // KPI theo đúng team đang assign
            select: {
              total_target: true,
              product_planned: true,
              allocations: {
                select: {
                  type: true,
                  content_line_id: true,
                  product_line_id: true,
                  quantity: true,
                },
              },
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
  const todayStart = now.startOf("day").toJSDate();

  // Đếm task theo team cụ thể → mỗi team assign độc lập, editor đa-team không bị ảnh hưởng chéo.
  // Tính cả task tạo tay (EXTRA) — task giao tay cũng trừ vào quota ngày/tháng.
  const [
    monthlyTaskCounts,
    todayTaskCounts,
    monthlyByContentLine,
    monthlyByProductLine,
    manualDailyKpis,
  ] = await Promise.all([
    prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        team_id: teamId,
        assigned_at: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        team_id: teamId,
        assigned_at: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ["assignee_id", "content_line_id"],
      where: {
        assignee_id: { in: userIds },
        team_id: teamId,
        assigned_at: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ["assignee_id", "product_line_id"],
      where: {
        assignee_id: { in: userIds },
        team_id: teamId,
        assigned_at: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    // KPI ngày set tay cho ngày hiệu lực (task giao hôm nay → làm ngày mai);
    // target = 0 coi như chưa set nên lọc luôn ở query.
    prisma.editorDailyKpi.findMany({
      where: {
        user_id: { in: userIds },
        team_id: teamId,
        date: dailyKpiDate(effectiveAssignmentDate(now).toFormat("yyyy-MM-dd")),
        target: { gt: 0 },
      },
      select: { user_id: true, target: true },
    }),
  ]);

  const monthlyTaskCountMap = new Map(
    monthlyTaskCounts.map((r) => [r.assignee_id!, r._count.id]),
  );
  const todayTaskCountMap = new Map(
    todayTaskCounts.map((r) => [r.assignee_id!, r._count.id]),
  );
  const manualDailyTargetMap = new Map(
    manualDailyKpis.map((r) => [r.user_id, r.target]),
  );

  // editorId -> (lineId -> count đã giao trong tháng)
  const contentLineCountByEditor = new Map<string, Map<string, number>>();
  for (const r of monthlyByContentLine) {
    const editorId = r.assignee_id!;
    if (!contentLineCountByEditor.has(editorId))
      contentLineCountByEditor.set(editorId, new Map());
    contentLineCountByEditor
      .get(editorId)!
      .set(r.content_line_id!, r._count.id);
  }
  const productLineCountByEditor = new Map<string, Map<string, number>>();
  for (const r of monthlyByProductLine) {
    const editorId = r.assignee_id!;
    if (!productLineCountByEditor.has(editorId))
      productLineCountByEditor.set(editorId, new Map());
    productLineCountByEditor
      .get(editorId)!
      .set(r.product_line_id!, r._count.id);
  }

  const editors: EditorCapacity[] = [];

  for (const u of eligible) {
    const kpi = u.editor_kpis[0];
    if (!kpi) continue;

    const assignedThisMonth = monthlyTaskCountMap.get(u.id) ?? 0;
    const assignedToday = todayTaskCountMap.get(u.id) ?? 0;
    // dailyTarget must be based on state BEFORE today so it stays stable across multiple same-day runs
    const assignedBeforeToday = Math.max(0, assignedThisMonth - assignedToday);
    const remainingMonthly = Math.max(0, kpi.total_target - assignedThisMonth);
    // KPI ngày set tay (nếu có) thay cho target dẫn xuất từ KPI tháng
    const dailyTarget =
      manualDailyTargetMap.get(u.id) ??
      deriveDailyTarget(kpi.total_target, assignedBeforeToday, now);
    // Only assign what's left of today's quota (handles multiple same-day runs correctly)
    const remainingDaily = Math.max(
      0,
      Math.min(dailyTarget - assignedToday, remainingMonthly),
    );
    if (remainingDaily <= 0) continue;

    const contentTypeWeights: WeightedAllocation[] = (kpi.allocations ?? [])
      .filter((a) => a.type === "CONTENT_LINE" && a.content_line_id)
      .map((a) => ({ key: a.content_line_id!, weight: a.quantity }))
      .filter((i) => i.weight > 0);

    const productTypeWeights: WeightedAllocation[] = (kpi.allocations ?? [])
      .filter((a) => a.type === "PRODUCT_LINE" && a.product_line_id)
      .map((a) => ({ key: a.product_line_id!, weight: a.quantity }))
      .filter((i) => i.weight > 0);

    const contentDoneByLine = contentLineCountByEditor.get(u.id) ?? new Map();
    const contentLineRemaining = new Map(
      contentTypeWeights.map((w) => [
        w.key,
        Math.max(0, w.weight - (contentDoneByLine.get(w.key) ?? 0)),
      ]),
    );

    const productDoneByLine = productLineCountByEditor.get(u.id) ?? new Map();
    const productLineRemaining = new Map(
      productTypeWeights.map((w) => [
        w.key,
        Math.max(0, w.weight - (productDoneByLine.get(w.key) ?? 0)),
      ]),
    );

    editors.push({
      userId: u.id,
      remainingDaily,
      remainingMonthly,
      productPlanned: kpi.product_planned ?? 0,
      contentTypeWeights,
      productTypeWeights,
      contentLineRemaining,
      productLineRemaining,
    });
  }

  return editors;
}

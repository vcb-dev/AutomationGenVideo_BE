import { DateTime } from "luxon";
import { deriveDailyTarget } from "../utils/date.utils";
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
                  percent: true,
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

  // Đếm task theo team cụ thể → mỗi team assign độc lập, editor đa-team không bị ảnh hưởng chéo
  const [monthlyTaskCounts, todayTaskCounts] = await Promise.all([
    prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        team_id: teamId,
        task_type: { not: "EXTRA" },
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
        task_type: { not: "EXTRA" },
        assigned_at: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
  ]);

  const monthlyTaskCountMap = new Map(
    monthlyTaskCounts.map((r) => [r.assignee_id!, r._count.id]),
  );
  const todayTaskCountMap = new Map(
    todayTaskCounts.map((r) => [r.assignee_id!, r._count.id]),
  );

  const editors: EditorCapacity[] = [];

  for (const u of eligible) {
    const kpi = u.editor_kpis[0];
    if (!kpi) continue;

    const assignedThisMonth = monthlyTaskCountMap.get(u.id) ?? 0;
    const assignedToday = todayTaskCountMap.get(u.id) ?? 0;
    // dailyTarget must be based on state BEFORE today so it stays stable across multiple same-day runs
    const assignedBeforeToday = Math.max(0, assignedThisMonth - assignedToday);
    const remainingMonthly = Math.max(0, kpi.total_target - assignedThisMonth);
    const dailyTarget = deriveDailyTarget(
      kpi.total_target,
      assignedBeforeToday,
      now,
    );
    // Only assign what's left of today's quota (handles multiple same-day runs correctly)
    const remainingDaily = Math.max(
      0,
      Math.min(dailyTarget - assignedToday, remainingMonthly),
    );
    if (remainingDaily <= 0) continue;

    const contentTypeWeights: WeightedAllocation[] = (kpi.allocations ?? [])
      .filter((a) => a.type === "CONTENT_LINE" && a.content_line_id)
      .map((a) => ({ key: a.content_line_id!, weight: a.percent }))
      .filter((i) => i.weight > 0);

    const productTypeWeights: WeightedAllocation[] = (kpi.allocations ?? [])
      .filter((a) => a.type === "PRODUCT_LINE" && a.product_line_id)
      .map((a) => ({ key: a.product_line_id!, weight: a.percent }))
      .filter((i) => i.weight > 0);

    editors.push({
      userId: u.id,
      remainingDaily,
      remainingMonthly,
      productPlanned: kpi.product_planned ?? 0,
      contentTypeWeights,
      productTypeWeights,
    });
  }

  return editors;
}

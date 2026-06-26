import { DateTime } from "luxon";
import { deriveDailyTarget } from "../helpers/date.helpers";
import { EditorSlot, QuotaItem } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

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

const categoryToField: Record<
  string,
  "video_traffic" | "video_gmv" | "video_profit"
> = {
  TRAFFIC: "video_traffic",
  GMV: "video_gmv",
  PROFIT: "video_profit",
};

export async function getEligibleEditors(
  prisma: PrismaService,
  teamId: string,
  now: DateTime,
  month: string,
  monthStart: Date,
  contentLineTypes: { id: string; a_type: string | null }[],
  productLineTypes: { id: string; video_category: string | null }[],
): Promise<EditorSlot[]> {
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

  const todayStart = now.startOf("day").toJSDate();

  const [autoRows, todayRows] = await Promise.all([
    prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        is_extra: false,
        assigned_at: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ["assignee_id"],
      where: {
        assignee_id: { in: userIds },
        is_extra: false,
        assigned_at: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
  ]);
  const autoCountMap = new Map(
    autoRows.map((r) => [r.assignee_id!, r._count.id]),
  );
  const todayCountMap = new Map(
    todayRows.map((r) => [r.assignee_id!, r._count.id]),
  );

  const slots: EditorSlot[] = [];

  for (const u of eligible) {
    const kpi = u.editor_kpis[0];
    if (!kpi) continue;

    const assignedThisMonth = autoCountMap.get(u.id) ?? 0;
    const assignedToday = todayCountMap.get(u.id) ?? 0;
    // dailyTarget must be based on state BEFORE today so it stays stable across multiple same-day runs
    const assignedBeforeToday = assignedThisMonth - assignedToday;
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

    const contentTypeWeights: QuotaItem[] = contentLineTypes
      .filter((cl) => cl.a_type && aTypeToField[cl.a_type])
      .map((cl) => ({
        key: cl.id,
        weight: kpi[aTypeToField[cl.a_type!]] ?? 0,
      }))
      .filter((i) => i.weight > 0);

    const productTypeWeights: QuotaItem[] = productLineTypes
      .filter((pl) => pl.video_category && categoryToField[pl.video_category])
      .map((pl) => ({
        key: pl.id,
        weight: kpi[categoryToField[pl.video_category!]] ?? 0,
      }))
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

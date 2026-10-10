import { DateTime } from "luxon";
import {
  deriveDailyTarget,
  effectiveAssignmentDate,
} from "../../../../utils/date.utils";
import { deadlineWindow } from "../../../../utils/task-auto/deadline-window.util";
import { A4EditorQuota, LineQuota } from "../types";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Chia `total` việc trong ngày cho các tuyến theo tỷ lệ phần KPI còn lại (phương pháp phần dư lớn
 * nhất): mỗi tuyến nhận phần nguyên, số dư dành cho tuyến có phần lẻ lớn nhất (bằng nhau → tuyến còn
 * nhiều hơn → id). Tuyến nhỏ (VD 0,5 việc/ngày) được xen kẽ ngày có ngày không, không ngày nào cũng 1.
 */
export function splitDailyTotal(
  total: number,
  lines: { id: string; remaining: number }[],
): Map<string, number> {
  const shares = new Map<string, number>();
  const sum = lines.reduce((s, l) => s + l.remaining, 0);
  if (total <= 0 || sum <= 0) return shares;
  // Phần lẻ so bằng số nguyên (total × remaining mod sum) để không lệch do làm tròn số thực.
  const parts = lines.map((l) => {
    const whole = Math.floor((total * l.remaining) / sum);
    return { ...l, whole, fraction: total * l.remaining - whole * sum };
  });
  let left = total - parts.reduce((s, p) => s + p.whole, 0);
  const byFraction = [...parts].sort(
    (a, b) => b.fraction - a.fraction || b.remaining - a.remaining || a.id.localeCompare(b.id),
  );
  const extra = new Set<string>();
  for (const p of byFraction) {
    if (left <= 0) break;
    if (p.whole >= p.remaining) continue;
    extra.add(p.id);
    left--;
  }
  for (const p of parts) shares.set(p.id, p.whole + (extra.has(p.id) ? 1 : 0));
  return shares;
}

/**
 * Chỉ tiêu ngày theo từng tuyến trong `contentLineIds` của các editor 1 team (thành viên đang hoạt động,
 * đã duyệt editor, có KPI tháng phân bổ cho tuyến đó > 0) — dùng chung cho chia task A4 và Kế hoạch ngày.
 * Số việc trong ngày = TỔNG KPI còn lại mọi tuyến / số ngày lịch còn lại (làm tròn lên), rồi chia cho các
 * tuyến theo splitDailyTotal — làm tròn lên riêng từng tuyến sẽ cộng lại vượt xa trung bình.
 * Task đã có đếm theo HẠN CHÓT (deadlineWindow), không theo assigned_at, kể cả task tạo tay.
 */
export async function loadLineQuotas(
  prisma: PrismaService,
  teamId: string,
  contentLineIds: string[],
  now: DateTime,
  month: string,
): Promise<LineQuota[]> {
  if (!contentLineIds.length) return [];
  const members = await prisma.teamMember.findMany({
    where: {
      team_id: teamId,
      user: {
        is_active: true,
        editor_approvals: { some: { status: "APPROVED" } },
      },
    },
    select: {
      user: {
        select: {
          id: true,
          editor_kpis: {
            where: { month, team_id: teamId }, // KPI theo đúng team đang assign
            select: {
              allocations: {
                where: { type: "CONTENT_LINE" }, // mọi tuyến — chỉ tiêu ngày chia trên tổng KPI
                select: { content_line_id: true, quantity: true },
              },
            },
          },
        },
      },
    },
  });

  // KPI tháng theo tuyến của từng editor có ít nhất 1 tuyến cần tính.
  const wanted = new Set(contentLineIds);
  const targetsByUser = new Map<string, Map<string, number>>();
  for (const { user } of members) {
    const byLine = targetsByUser.get(user.id) ?? new Map<string, number>();
    for (const a of user.editor_kpis.flatMap((k) => k.allocations)) {
      if (!a.content_line_id) continue;
      byLine.set(a.content_line_id, (byLine.get(a.content_line_id) ?? 0) + a.quantity);
    }
    targetsByUser.set(user.id, byLine);
  }
  for (const [userId, byLine] of targetsByUser) {
    for (const [lineId, target] of byLine) if (target <= 0) byLine.delete(lineId);
    if (![...byLine.keys()].some((lineId) => wanted.has(lineId))) targetsByUser.delete(userId);
  }
  if (!targetsByUser.size) return [];

  // Ngày hiệu lực = ngày mai (task giao hôm nay → làm ngày mai), tháng KPI = tháng của ngày mai.
  const dayStart = effectiveAssignmentDate(now);
  const dayEnd = dayStart.plus({ days: 1 });
  const monthStart = dayStart.startOf("month");
  const monthEnd = monthStart.plus({ months: 1 });

  const allLineIds = [...new Set([...targetsByUser.values()].flatMap((byLine) => [...byLine.keys()]))];
  const tasks = await prisma.task.findMany({
    where: {
      assignee_id: { in: [...targetsByUser.keys()] },
      team_id: teamId,
      content_line_id: { in: allLineIds },
      status: { not: "CANCELLED" },
      ...deadlineWindow({ gte: monthStart.toJSDate(), lt: monthEnd.toJSDate() }),
    },
    select: { assignee_id: true, content_line_id: true, deadline: true, created_at: true },
  });

  const key = (userId: string, lineId: string) => `${userId}|${lineId}`;
  const counts = new Map<string, { month: number; beforeDay: number; onDay: number }>();
  for (const t of tasks) {
    const k = key(t.assignee_id!, t.content_line_id!);
    const c = counts.get(k) ?? { month: 0, beforeDay: 0, onDay: 0 };
    const due = (t.deadline ?? t.created_at).getTime();
    c.month++;
    if (due < dayStart.toMillis()) c.beforeDay++;
    else if (due < dayEnd.toMillis()) c.onDay++;
    counts.set(k, c);
  }

  const quotas: LineQuota[] = [];
  for (const [userId, byLine] of targetsByUser) {
    // Phần KPI còn lại tính tới TRƯỚC ngày hiệu lực — giữ ổn định khi chạy nhiều lần trong ngày vì
    // task vừa giao rơi vào onDay, không vào beforeDay.
    const lines = [...byLine].map(([lineId, monthlyTarget]) => {
      const c = counts.get(key(userId, lineId)) ?? { month: 0, beforeDay: 0, onDay: 0 };
      return { id: lineId, monthlyTarget, c, remaining: Math.max(0, monthlyTarget - c.beforeDay) };
    });
    const totalRemaining = lines.reduce((s, l) => s + l.remaining, 0);
    const shares = splitDailyTotal(deriveDailyTarget(totalRemaining, 0, now), lines);
    for (const { id: lineId, monthlyTarget, c } of lines) {
      const dailyTarget = shares.get(lineId) ?? 0;
      if (!wanted.has(lineId) || dailyTarget <= 0) continue;
      const remainingMonthly = Math.max(0, monthlyTarget - c.month);
      quotas.push({
        userId,
        contentLineId: lineId,
        monthlyTarget,
        assignedThisMonth: c.month,
        dailyTarget,
        onDay: c.onDay,
        remainingToday: Math.max(0, Math.min(dailyTarget - c.onDay, remainingMonthly)),
      });
    }
  }
  return quotas;
}

/** Editor còn thiếu task tuyến `contentLineId` cho ngày hiệu lực — auto-assign tạo đủ phần thiếu. */
export async function loadA4Editors(
  prisma: PrismaService,
  teamId: string,
  contentLineId: string,
  now: DateTime,
  month: string,
): Promise<A4EditorQuota[]> {
  const quotas = await loadLineQuotas(prisma, teamId, [contentLineId], now, month);
  return quotas
    .filter((q) => q.remainingToday > 0)
    .map(({ userId, monthlyTarget, assignedThisMonth, remainingToday }) => ({
      userId,
      monthlyTarget,
      assignedThisMonth,
      remainingToday,
    }));
}

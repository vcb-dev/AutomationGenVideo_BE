import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DailyTaskComplianceSource, Prisma, TaskStatus } from "@prisma/client";
import { DateTime } from "luxon";

import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService } from "../../../common/push/push.service";
import { dailyKpiDate } from "../../../utils/date.utils";
import {
  QueryComplianceDayDto,
  QueryComplianceHistoryDto,
} from "./dto/compliance-history.dto";
import {
  PayrollGroupBy,
  TaskCompliancePayrollSyncQueryDto,
} from "./dto/compliance-payroll-sync.dto";

const VN_TZ = "Asia/Ho_Chi_Minh";
const LOOKBACK_DAYS = 31;
const COMPLETED_STATUSES: TaskStatus[] = ["SUBMITTED", "APPROVED"];

type Actor = { id: string; roles: string[] };

type SourceRow = {
  userId: string;
  teamId: string;
  workDate: string;
  contentLineId: string;
  contentLineName: string;
  source: DailyTaskComplianceSource;
  expected: number;
  deadline: Date;
  taskIds?: Set<string>;
};

type TaskForEvaluation = {
  id: string;
  assignee_id: string | null;
  team_id: string;
  content_line_id: string | null;
  task_type: string;
  run_id: string | null;
  status: TaskStatus;
  deadline: Date | null;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  content_line: { name: string } | null;
};

function dateOfDeadline(deadline: Date): string {
  return DateTime.fromJSDate(deadline).setZone(VN_TZ).toFormat("yyyy-MM-dd");
}

function sourceKey(
  row: Pick<
    SourceRow,
    "userId" | "teamId" | "workDate" | "contentLineId" | "source"
  >,
): string {
  return [
    row.userId,
    row.teamId,
    row.workDate,
    row.contentLineId,
    row.source,
  ].join("|");
}

function taskKey(
  task: Pick<
    TaskForEvaluation,
    "assignee_id" | "team_id" | "content_line_id" | "deadline"
  >,
): string | null {
  if (!task.assignee_id || !task.content_line_id || !task.deadline) return null;
  return [
    task.assignee_id,
    task.team_id,
    dateOfDeadline(task.deadline),
    task.content_line_id,
  ].join("|");
}

function submittedBy(
  task: Pick<TaskForEvaluation, "status" | "submitted_at" | "reviewed_at">,
  deadline: Date,
): boolean {
  const submittedAt =
    task.submitted_at ?? (task.status === "APPROVED" ? task.reviewed_at : null);
  return !!submittedAt && submittedAt.getTime() <= deadline.getTime();
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const TASK_DETAIL_SELECT = {
  id: true,
  assignee_id: true,
  team_id: true,
  content_line_id: true,
  task_type: true,
  run_id: true,
  status: true,
  deadline: true,
  submitted_at: true,
  reviewed_at: true,
  editor_content: { select: { title: true } },
  team_content: {
    select: {
      title: true,
      source_editor_content: { select: { title: true } },
    },
  },
  content: {
    select: {
      title: true,
      source_team_content: {
        select: {
          title: true,
          source_editor_content: { select: { title: true } },
        },
      },
    },
  },
  editor_product: { select: { name: true } },
  team_product: {
    select: {
      name: true,
      source_editor_product: { select: { name: true } },
    },
  },
  product: {
    select: {
      name: true,
      source_team_product: {
        select: {
          name: true,
          source_editor_product: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.TaskSelect;

type TaskDetailRow = Prisma.TaskGetPayload<{
  select: typeof TASK_DETAIL_SELECT;
}>;

/** Đủ trường để ghép task cho một dòng snapshot. */
type SnapshotLine = {
  id: string;
  user_id: string;
  team_id: string;
  work_date: Date;
  content_line_id: string;
  source: DailyTaskComplianceSource;
  deadline: Date;
  missing_count: number;
};

function toTaskItem(task: TaskDetailRow, deadline: Date) {
  const globalTeamContent = task.content?.source_team_content;
  const globalTeamProduct = task.product?.source_team_product;
  return {
    id: task.id,
    title:
      task.editor_content?.title ??
      task.team_content?.title ??
      task.team_content?.source_editor_content?.title ??
      task.content?.title ??
      globalTeamContent?.title ??
      globalTeamContent?.source_editor_content?.title ??
      null,
    product_name:
      task.editor_product?.name ??
      task.team_product?.name ??
      task.team_product?.source_editor_product?.name ??
      task.product?.name ??
      globalTeamProduct?.name ??
      globalTeamProduct?.source_editor_product?.name ??
      null,
    status: task.status,
    deadline: task.deadline,
    submitted_at:
      task.submitted_at ??
      (task.status === "APPROVED" ? task.reviewed_at : null),
    on_time:
      COMPLETED_STATUSES.includes(task.status) && submittedBy(task, deadline),
  };
}

type LineTasks = {
  // Phần thiếu không ứng với task nào: kế hoạch tuyến thì là task chưa tạo, A4 thì là task đã bị
  // huỷ/xoá sau khi giao.
  untracked_missing: number;
  tasks: ReturnType<typeof toTaskItem>[];
};

// Thứ tự tuyến của màn chi tiết ngày: tuyến thiếu nhiều lên đầu.
const DAY_LINE_ORDER: Prisma.DailyTaskComplianceOrderByWithRelationInput[] = [
  { missing_count: "desc" },
  { content_line: { name: "asc" } },
  { source: "asc" },
];

const PAYROLL_LINE_SELECT = {
  id: true,
  user_id: true,
  team_id: true,
  work_date: true,
  content_line_id: true,
  source: true,
  expected_count: true,
  completed_count: true,
  missing_count: true,
  deadline: true,
  evaluated_at: true,
  user: { select: { full_name: true, employee_id: true } },
  content_line: { select: { id: true, name: true } },
} satisfies Prisma.DailyTaskComplianceSelect;

type PayrollLineRow = Prisma.DailyTaskComplianceGetPayload<{
  select: typeof PAYROLL_LINE_SELECT;
}>;

function toPayrollRecord(row: PayrollLineRow, detail: LineTasks) {
  return {
    id: row.id,
    user_id: row.user_id,
    employee_id: row.user.employee_id,
    user_name: row.user.full_name,
    team_id: row.team_id,
    work_date: toDateOnly(row.work_date),
    content_line: row.content_line,
    source: row.source,
    expected_count: row.expected_count,
    completed_count: row.completed_count,
    missing_count: row.missing_count,
    deadline: row.deadline.toISOString(),
    evaluated_at: row.evaluated_at.toISOString(),
    untracked_missing: detail.untracked_missing,
    tasks: detail.tasks.map((task) => ({
      ...task,
      deadline: task.deadline?.toISOString() ?? null,
      submitted_at: task.submitted_at?.toISOString() ?? null,
    })),
  };
}

type PayrollRecord = ReturnType<typeof toPayrollRecord>;

function sumCounts(
  lines: Pick<
    PayrollRecord,
    "expected_count" | "completed_count" | "missing_count"
  >[],
) {
  return {
    expected: lines.reduce((s, l) => s + l.expected_count, 0),
    completed: lines.reduce((s, l) => s + l.completed_count, 0),
    missing: lines.reduce((s, l) => s + l.missing_count, 0),
  };
}

@Injectable()
export class TaskComplianceService {
  private readonly logger = new Logger(TaskComplianceService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  /**
   * Chạy mỗi giờ ở phút 05. Chỉ chốt các ngày lịch đã kết thúc ở VN, nhờ vậy mọi tuyến trong cùng
   * ngày được ghi và cảnh báo cùng lúc. Quét bù 31 ngày để server ngừng một thời gian vẫn không mất
   * lịch sử; unique key làm thao tác idempotent.
   */
  @Cron("5 * * * *", { name: "daily-task-compliance", timeZone: VN_TZ })
  async cronEvaluate(): Promise<void> {
    try {
      const result = await this.evaluatePastDays();
      if (result.created || result.notified) {
        this.logger.log(
          `Daily compliance: created=${result.created}, notified=${result.notified}`,
        );
      }
    } catch (err) {
      this.logger.error("Daily compliance evaluation failed", err);
    }
  }

  async evaluatePastDays(
    now: DateTime = DateTime.now().setZone(VN_TZ),
  ): Promise<{ created: number; notified: number }> {
    const today = now.startOf("day");
    const start = today.minus({ days: LOOKBACK_DAYS });
    const startDate = dailyKpiDate(start.toFormat("yyyy-MM-dd"));
    const todayDate = dailyKpiDate(today.toFormat("yyyy-MM-dd"));

    const [plans, tasks] = await Promise.all([
      this.prisma.dailyLinePlan.findMany({
        where: { plan_date: { gte: startDate, lt: todayDate } },
        select: {
          user_id: true,
          team_id: true,
          plan_date: true,
          content_line_id: true,
          target: true,
          deadline: true,
          content_line: { select: { name: true } },
        },
      }),
      this.prisma.task.findMany({
        where: {
          deadline: { gte: start.toJSDate(), lt: today.toJSDate() },
          assignee_id: { not: null },
          content_line_id: { not: null },
          status: { not: "CANCELLED" },
        },
        select: {
          id: true,
          assignee_id: true,
          team_id: true,
          content_line_id: true,
          task_type: true,
          run_id: true,
          status: true,
          deadline: true,
          submitted_at: true,
          reviewed_at: true,
          content_line: { select: { name: true } },
        },
      }),
    ]);

    const taskRows = tasks as TaskForEvaluation[];
    const sources = new Map<string, SourceRow>();

    for (const plan of plans) {
      const row: SourceRow = {
        userId: plan.user_id,
        teamId: plan.team_id,
        workDate: plan.plan_date.toISOString().slice(0, 10),
        contentLineId: plan.content_line_id,
        contentLineName: plan.content_line.name,
        source: "DAILY_PLAN",
        expected: plan.target,
        deadline: plan.deadline,
      };
      sources.set(sourceKey(row), row);
    }

    // A4 không có DailyLinePlan: chính các task AUTO do assignment run tạo ra là kế hoạch phải làm.
    for (const task of taskRows) {
      if (
        task.task_type !== "AUTO" ||
        !task.run_id ||
        !task.assignee_id ||
        !task.content_line_id ||
        !task.deadline ||
        task.content_line?.name.trim().toUpperCase() !== "A4"
      )
        continue;
      const seed: SourceRow = {
        userId: task.assignee_id,
        teamId: task.team_id,
        workDate: dateOfDeadline(task.deadline),
        contentLineId: task.content_line_id,
        contentLineName: task.content_line.name,
        source: "AUTO_A4",
        expected: 0,
        deadline: task.deadline,
        taskIds: new Set(),
      };
      const key = sourceKey(seed);
      const row = sources.get(key) ?? seed;
      row.expected++;
      row.taskIds!.add(task.id);
      if (task.deadline > row.deadline) row.deadline = task.deadline;
      sources.set(key, row);
    }

    const tasksByPlanKey = new Map<string, TaskForEvaluation[]>();
    for (const task of taskRows) {
      const key = taskKey(task);
      if (!key) continue;
      if (!tasksByPlanKey.has(key)) tasksByPlanKey.set(key, []);
      tasksByPlanKey.get(key)!.push(task);
    }

    const snapshots: Prisma.DailyTaskComplianceCreateManyInput[] = [];
    for (const row of sources.values()) {
      if (row.expected <= 0) continue;
      const candidates =
        tasksByPlanKey.get(
          [row.userId, row.teamId, row.workDate, row.contentLineId].join("|"),
        ) ?? [];
      const completed = candidates.filter((task) => {
        if (!COMPLETED_STATUSES.includes(task.status)) return false;
        if (row.source === "AUTO_A4" && !row.taskIds?.has(task.id))
          return false;
        return submittedBy(task, row.deadline);
      }).length;
      snapshots.push({
        user_id: row.userId,
        team_id: row.teamId,
        work_date: dailyKpiDate(row.workDate),
        content_line_id: row.contentLineId,
        source: row.source,
        expected_count: row.expected,
        completed_count: completed,
        missing_count: Math.max(0, row.expected - completed),
        deadline: row.deadline,
        evaluated_at: now.toJSDate(),
      });
    }

    const inserted = snapshots.length
      ? await this.prisma.dailyTaskCompliance.createMany({
          data: snapshots,
          skipDuplicates: true,
        })
      : { count: 0 };
    const notified = await this.notifyPendingShortfalls(
      startDate,
      todayDate,
      now.toJSDate(),
    );
    return { created: inserted.count, notified };
  }

  private async notifyPendingShortfalls(
    from: Date,
    to: Date,
    sentAt: Date,
  ): Promise<number> {
    const pending = await this.prisma.dailyTaskCompliance.findMany({
      where: {
        work_date: { gte: from, lt: to },
        missing_count: { gt: 0 },
        notification_sent_at: null,
      },
      select: { user_id: true, work_date: true },
      distinct: ["user_id", "work_date"],
    });
    let notified = 0;
    for (const group of pending) {
      const result = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.dailyTaskCompliance.updateMany({
          where: {
            user_id: group.user_id,
            work_date: group.work_date,
            missing_count: { gt: 0 },
            notification_sent_at: null,
          },
          data: { notification_sent_at: sentAt },
        });
        if (!claimed.count) return null;
        const rows = await tx.dailyTaskCompliance.findMany({
          where: {
            user_id: group.user_id,
            work_date: group.work_date,
            missing_count: { gt: 0 },
          },
          select: {
            expected_count: true,
            completed_count: true,
            missing_count: true,
            content_line: { select: { name: true } },
          },
          orderBy: { content_line: { name: "asc" } },
        });
        const date = group.work_date.toISOString().slice(0, 10);
        const label = DateTime.fromISO(date).toFormat("dd/MM/yyyy");
        const missing = rows.reduce((sum, row) => sum + row.missing_count, 0);
        const body = rows
          .map(
            (row) =>
              `${row.content_line.name}: ${row.completed_count}/${row.expected_count}`,
          )
          .join(" · ");
        await tx.notification.create({
          data: {
            user_id: group.user_id,
            type: "DAILY_TASK_SHORTFALL",
            title: `Thiếu ${missing} task ngày ${label}`,
            body: `${body}. Mở lịch sử để xem chi tiết.`,
            meta: {
              work_date: date,
              missing,
              lines: rows.map((row) => ({
                name: row.content_line.name,
                expected: row.expected_count,
                completed: row.completed_count,
                missing: row.missing_count,
              })),
            } as Prisma.InputJsonValue,
          },
        });
        return { date, missing, body };
      });
      if (!result) continue;
      notified++;
      this.push
        .sendToUser(group.user_id, {
          title: `Cảnh báo thiếu ${result.missing} task`,
          body: result.body,
          url: `/dashboard/task-auto/compliance?date=${result.date}`,
        })
        .catch(() => {});
    }
    return notified;
  }

  /** Phạm vi theo vai trò, dùng chung cho danh sách và chi tiết ngày. */
  private scopeWhere(
    actor: Actor,
    filter: { team_id?: string; user_id?: string },
  ): Prisma.DailyTaskComplianceWhereInput {
    const isAdminOrManager = actor.roles.some(
      (role) => role === "ADMIN" || role === "MANAGER",
    );
    if (isAdminOrManager) {
      return {
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
        ...(filter.team_id ? { team_id: filter.team_id } : {}),
      };
    }
    if (actor.roles.includes("LEADER")) {
      return {
        team: {
          leader_id: actor.id,
          ...(filter.team_id ? { id: filter.team_id } : {}),
        },
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
      };
    }
    return {
      user_id: actor.id,
      ...(filter.team_id ? { team_id: filter.team_id } : {}),
    };
  }

  /**
   * Mỗi dòng là một người trong một ngày (gộp các tuyến bị thiếu), phân trang theo nhóm đó. Số
   * nhóm bị chặn bởi số ngày × số người nên lấy hết khóa nhóm rồi cắt trang trong bộ nhớ.
   */
  async findHistory(actor: Actor, query: QueryComplianceHistoryDto) {
    const today = DateTime.now().setZone(VN_TZ).startOf("day");
    const from = query.from ?? today.minus({ days: 29 }).toFormat("yyyy-MM-dd");
    const to = query.to ?? today.toFormat("yyyy-MM-dd");

    const where: Prisma.DailyTaskComplianceWhereInput = {
      ...this.scopeWhere(actor, query),
      missing_count: { gt: 0 },
      work_date: {
        gte: dailyKpiDate(from),
        lt: dailyKpiDate(
          DateTime.fromISO(to).plus({ days: 1 }).toFormat("yyyy-MM-dd"),
        ),
      },
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { groups, summary } = await this.shortfallGroups(where);

    const pageGroups = groups.slice((page - 1) * limit, page * limit);
    const rows = pageGroups.length
      ? await this.prisma.dailyTaskCompliance.findMany({
          where: {
            ...where,
            OR: pageGroups.map((group) => ({
              user_id: group.user_id,
              work_date: group.work_date,
            })),
          },
          select: {
            id: true,
            user_id: true,
            work_date: true,
            source: true,
            expected_count: true,
            completed_count: true,
            missing_count: true,
            deadline: true,
            user: { select: { id: true, full_name: true, email: true } },
            team: { select: { id: true, name: true } },
            content_line: { select: { id: true, name: true } },
          },
          orderBy: [{ content_line: { name: "asc" } }, { source: "asc" }],
        })
      : [];

    const dayKey = (userId: string, workDate: Date) =>
      `${userId}|${toDateOnly(workDate)}`;
    const rowsByDay = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = dayKey(row.user_id, row.work_date);
      if (!rowsByDay.has(key)) rowsByDay.set(key, []);
      rowsByDay.get(key)!.push(row);
    }

    const data = pageGroups.flatMap((group) => {
      const key = dayKey(group.user_id, group.work_date);
      const lines = rowsByDay.get(key) ?? [];
      if (!lines.length) return [];
      const teams = new Map(lines.map((line) => [line.team.id, line.team]));
      return [
        {
          key,
          work_date: key.slice(-10),
          user: lines[0].user,
          teams: [...teams.values()],
          expected_count: lines.reduce((s, l) => s + l.expected_count, 0),
          completed_count: lines.reduce((s, l) => s + l.completed_count, 0),
          missing_count: lines.reduce((s, l) => s + l.missing_count, 0),
          lines: lines.map((line) => ({
            id: line.id,
            source: line.source,
            expected_count: line.expected_count,
            completed_count: line.completed_count,
            missing_count: line.missing_count,
            deadline: line.deadline,
            team: line.team,
            content_line: line.content_line,
          })),
        },
      ];
    });

    return {
      data,
      total: groups.length,
      page,
      limit,
      totalPages: Math.ceil(groups.length / limit),
      summary,
    };
  }

  /**
   * Nhóm người × ngày có tuyến thiếu cùng tổng của riêng các tuyến thiếu. Màn danh sách và
   * payroll-sync cùng gọi hàm này nên thứ tự, phân trang và con số tổng luôn trùng nhau.
   */
  private async shortfallGroups(where: Prisma.DailyTaskComplianceWhereInput) {
    const [groups, totals] = await Promise.all([
      this.prisma.dailyTaskCompliance.groupBy({
        by: ["user_id", "work_date"],
        where,
        _sum: { missing_count: true },
        orderBy: [
          { work_date: "desc" },
          { _sum: { missing_count: "desc" } },
          { user_id: "asc" },
        ],
      }),
      this.prisma.dailyTaskCompliance.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          expected_count: true,
          completed_count: true,
          missing_count: true,
        },
      }),
    ]);
    return {
      groups,
      summary: {
        person_days: groups.length,
        lines: totals._count._all,
        expected: totals._sum.expected_count ?? 0,
        completed: totals._sum.completed_count ?? 0,
        missing: totals._sum.missing_count ?? 0,
      },
    };
  }

  /**
   * Task của từng dòng snapshot, ghép theo đúng luật evaluatePastDays (A4 chỉ tính task AUTO có
   * run_id) để danh sách khớp với con số đã chốt. Chi tiết ngày và payroll-sync dùng chung.
   */
  private async loadLineTasks(
    rows: SnapshotLine[],
  ): Promise<Map<string, LineTasks>> {
    const result = new Map<string, LineTasks>();
    if (!rows.length) return result;

    const personDays = new Map<string, { userId: string; date: string }>();
    for (const row of rows) {
      const date = toDateOnly(row.work_date);
      personDays.set(`${row.user_id}|${date}`, { userId: row.user_id, date });
    }
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { not: "CANCELLED" },
        team_id: { in: [...new Set(rows.map((row) => row.team_id))] },
        content_line_id: {
          in: [...new Set(rows.map((row) => row.content_line_id))],
        },
        OR: [...personDays.values()].map(({ userId, date }) => {
          const dayStart = DateTime.fromISO(date, { zone: VN_TZ }).startOf(
            "day",
          );
          return {
            assignee_id: userId,
            deadline: {
              gte: dayStart.toJSDate(),
              lt: dayStart.plus({ days: 1 }).toJSDate(),
            },
          };
        }),
      },
      select: TASK_DETAIL_SELECT,
      orderBy: { created_at: "asc" },
    });

    for (const row of rows) {
      const date = toDateOnly(row.work_date);
      const items = tasks
        .filter(
          (task) =>
            task.assignee_id === row.user_id &&
            task.team_id === row.team_id &&
            task.content_line_id === row.content_line_id &&
            !!task.deadline &&
            dateOfDeadline(task.deadline) === date &&
            (row.source !== "AUTO_A4" ||
              (task.task_type === "AUTO" && !!task.run_id)),
        )
        .map((task) => toTaskItem(task, row.deadline))
        // Task chưa đạt lên đầu: đó là thứ người xem cần thấy trước.
        .sort((a, b) => Number(a.on_time) - Number(b.on_time));
      const notOnTime = items.filter((item) => !item.on_time).length;
      result.set(row.id, {
        untracked_missing: Math.max(0, row.missing_count - notOnTime),
        tasks: items,
      });
    }
    return result;
  }

  /**
   * Chi tiết một người trong một ngày: mọi tuyến đã chốt (kể cả tuyến đủ) kèm danh sách task. Số
   * thiếu là bản chụp lúc hết hạn; task là trạng thái hiện tại nên có thể thấy task nộp bù sau đó.
   * Ghép task theo đúng luật của evaluatePastDays để danh sách khớp với con số đã chốt.
   */
  async findDayDetail(actor: Actor, query: QueryComplianceDayDto) {
    const userId = query.user_id ?? actor.id;
    const rows = await this.prisma.dailyTaskCompliance.findMany({
      where: {
        AND: [
          this.scopeWhere(actor, { team_id: query.team_id }),
          { user_id: userId, work_date: dailyKpiDate(query.date) },
        ],
      },
      select: {
        id: true,
        user_id: true,
        team_id: true,
        work_date: true,
        content_line_id: true,
        source: true,
        expected_count: true,
        completed_count: true,
        missing_count: true,
        deadline: true,
        evaluated_at: true,
        user: { select: { id: true, full_name: true, email: true } },
        team: { select: { id: true, name: true } },
        content_line: { select: { id: true, name: true } },
      },
      orderBy: DAY_LINE_ORDER,
    });
    if (!rows.length) {
      throw new NotFoundException("Không có dữ liệu nhiệm vụ của ngày này");
    }

    const lineTasks = await this.loadLineTasks(rows);
    const lines = rows.map((row) => ({
      id: row.id,
      source: row.source,
      expected_count: row.expected_count,
      completed_count: row.completed_count,
      missing_count: row.missing_count,
      deadline: row.deadline,
      evaluated_at: row.evaluated_at,
      team: row.team,
      content_line: row.content_line,
      ...lineTasks.get(row.id)!,
    }));

    return {
      work_date: query.date,
      user: rows[0].user,
      summary: {
        // Tổng của cả ngày, gồm cả tuyến đã đủ — khác danh sách chỉ cộng tuyến thiếu.
        expected: rows.reduce((s, row) => s + row.expected_count, 0),
        completed: rows.reduce((s, row) => s + row.completed_count, 0),
        missing: rows.reduce((s, row) => s + row.missing_count, 0),
      },
      lines,
    };
  }

  /**
   * Contract read-only cho VCB Salary. Summary/coverage dùng toàn bộ snapshot phù hợp bộ lọc, còn records
   * chỉ phân trang các dòng thực sự thiếu task. Không gọi evaluatePastDays ở đây để request từ hệ thống
   * ngoài không bao giờ tạo hoặc thay đổi dữ liệu nghiệp vụ.
   */
  async payrollSync(teamId: string, query: TaskCompliancePayrollSyncQueryDto) {
    const from = DateTime.fromISO(query.from, { zone: VN_TZ }).startOf("day");
    const to = DateTime.fromISO(query.to, { zone: VN_TZ }).startOf("day");
    if (!from.isValid || !to.isValid) {
      throw new BadRequestException("from và to phải là ngày hợp lệ");
    }
    if (to < from) {
      throw new BadRequestException("from phải nhỏ hơn hoặc bằng to");
    }
    // Hiệu hai đầu tối đa 365 ngày tương ứng tối đa 366 ngày lịch tính cả from và to.
    if (to.diff(from, "days").days > 365) {
      throw new BadRequestException("Khoảng ngày không được vượt quá 366 ngày");
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    if (!team) throw new NotFoundException("Team không tồn tại");

    const baseWhere: Prisma.DailyTaskComplianceWhereInput = {
      team_id: teamId,
      ...(query.user_id ? { user_id: query.user_id } : {}),
      work_date: {
        gte: dailyKpiDate(from.toFormat("yyyy-MM-dd")),
        lt: dailyKpiDate(to.plus({ days: 1 }).toFormat("yyyy-MM-dd")),
      },
    };
    const missingWhere: Prisma.DailyTaskComplianceWhereInput = {
      ...baseWhere,
      missing_count: { gt: 0 },
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const groupBy: PayrollGroupBy = query.group_by ?? "line";

    const [shortfall, totals] = await Promise.all([
      this.shortfallGroups(missingWhere),
      this.prisma.dailyTaskCompliance.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: {
          expected_count: true,
          completed_count: true,
          missing_count: true,
        },
        _min: { work_date: true },
        _max: { work_date: true },
      }),
    ]);

    // person_day phân trang theo nhóm người × ngày như màn danh sách; line giữ phân trang theo
    // tuyến của contract 1.0. records luôn chỉ gồm tuyến thiếu.
    const days =
      groupBy === "person_day"
        ? await this.payrollPersonDays(
            baseWhere,
            shortfall.groups.slice((page - 1) * limit, page * limit),
          )
        : undefined;
    const records = days
      ? days.flatMap((day) => day.lines.filter((line) => line.missing_count > 0))
      : await this.payrollLines(missingWhere, page, limit);
    const total = days ? shortfall.summary.person_days : shortfall.summary.lines;

    const snapshotCount = totals._count._all;
    const dateOnly = (value: Date | null | undefined) =>
      value ? toDateOnly(value) : null;

    return {
      contract_version: "1.1",
      generated_at: new Date().toISOString(),
      timezone: VN_TZ,
      range: { from: query.from, to: query.to },
      team,
      filters: { user_id: query.user_id ?? null, group_by: groupBy },
      coverage: {
        snapshot_count: snapshotCount,
        evaluated_from: dateOnly(totals._min.work_date),
        evaluated_through: dateOnly(totals._max.work_date),
      },
      summary: {
        expected: totals._sum.expected_count ?? 0,
        completed_on_time: totals._sum.completed_count ?? 0,
        missing: totals._sum.missing_count ?? 0,
        affected_days: new Set(
          shortfall.groups.map((group) => toDateOnly(group.work_date)),
        ).size,
        affected_records: shortfall.summary.lines,
      },
      // Đúng bằng các ô tổng của màn Nhiệm vụ còn thiếu: chỉ cộng các tuyến bị thiếu, nên
      // expected/completed khác summary ở trên (summary cộng cả tuyến đã đủ).
      shortfall_summary: shortfall.summary,
      records,
      ...(days ? { days } : {}),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
      warnings:
        snapshotCount === 0
          ? [
              {
                code: "NO_COMPLIANCE_SNAPSHOT",
                message:
                  "Không có dữ liệu tuân thủ nhiệm vụ trong khoảng ngày đã chọn.",
              },
            ]
          : [],
    };
  }

  /** Mỗi record là một tuyến bị thiếu, phân trang và sắp xếp giữ nguyên như contract 1.0. */
  private async payrollLines(
    where: Prisma.DailyTaskComplianceWhereInput,
    page: number,
    limit: number,
  ): Promise<PayrollRecord[]> {
    const rows = await this.prisma.dailyTaskCompliance.findMany({
      where,
      select: PAYROLL_LINE_SELECT,
      orderBy: [
        { work_date: "desc" },
        { user: { full_name: "asc" } },
        { content_line: { name: "asc" } },
        { id: "asc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    });
    const lineTasks = await this.loadLineTasks(rows);
    return rows.map((row) => toPayrollRecord(row, lineTasks.get(row.id)!));
  }

  /**
   * Mỗi phần tử là một dòng của màn Nhiệm vụ còn thiếu (người × ngày, cùng thứ tự) kèm phần mở
   * rộng của dòng đó: mọi tuyến đã chốt trong ngày, kể cả tuyến đủ, và task của từng tuyến.
   */
  private async payrollPersonDays(
    baseWhere: Prisma.DailyTaskComplianceWhereInput,
    pageGroups: { user_id: string; work_date: Date }[],
  ) {
    if (!pageGroups.length) return [];
    const rows = await this.prisma.dailyTaskCompliance.findMany({
      where: {
        ...baseWhere,
        OR: pageGroups.map((group) => ({
          user_id: group.user_id,
          work_date: group.work_date,
        })),
      },
      select: PAYROLL_LINE_SELECT,
      orderBy: DAY_LINE_ORDER,
    });
    const lineTasks = await this.loadLineTasks(rows);

    const linesByDay = new Map<string, PayrollRecord[]>();
    for (const row of rows) {
      const key = `${row.user_id}|${toDateOnly(row.work_date)}`;
      if (!linesByDay.has(key)) linesByDay.set(key, []);
      linesByDay.get(key)!.push(toPayrollRecord(row, lineTasks.get(row.id)!));
    }

    return pageGroups.flatMap((group) => {
      const workDate = toDateOnly(group.work_date);
      const key = `${group.user_id}|${workDate}`;
      const lines = linesByDay.get(key) ?? [];
      if (!lines.length) return [];
      const shortfall = sumCounts(lines.filter((line) => line.missing_count > 0));
      return [
        {
          key,
          work_date: workDate,
          user_id: group.user_id,
          employee_id: lines[0].employee_id,
          user_name: lines[0].user_name,
          // Đúng bằng số trên dòng danh sách: chỉ cộng các tuyến thiếu.
          expected_count: shortfall.expected,
          completed_count: shortfall.completed,
          missing_count: shortfall.missing,
          // Đúng bằng "Cả ngày" ở phần mở rộng: cộng cả tuyến đã đủ.
          day_total: sumCounts(lines),
          lines,
        },
      ];
    });
  }
}

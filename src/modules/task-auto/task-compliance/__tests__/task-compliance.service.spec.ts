import { Reflector } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { DateTime } from "luxon";
import { RolesGuard } from "../../../auth/guards/roles.guard";
import { TaskCompliancePayrollSyncController } from "../task-compliance.controller";
import { TaskCompliancePayrollSyncQueryDto } from "../dto/compliance-payroll-sync.dto";
import { TaskComplianceService } from "../task-compliance.service";

const DEADLINE = new Date("2026-09-30T10:00:00.000Z"); // 17:00 giờ VN
const TEAM_UUID = "0f2a1b3c-0000-4000-8000-000000000001";
const USER_UUID = "11111111-1111-4111-8111-111111111111";

function task(id: string, extra: Record<string, any>) {
  return {
    id,
    assignee_id: "u1",
    team_id: "team-1",
    content_line_id: "cl-a1",
    task_type: "EXTRA",
    run_id: null,
    status: "ASSIGNED",
    deadline: DEADLINE,
    submitted_at: null,
    reviewed_at: null,
    content_line: { name: "A1" },
    ...extra,
  };
}

function build() {
  const createdSnapshots: any[] = [];
  const tx: any = {
    dailyTaskCompliance: {
      updateMany: jest.fn(async () => ({ count: 2 })),
      findMany: jest.fn(async () => [
        {
          expected_count: 2,
          completed_count: 1,
          missing_count: 1,
          content_line: { name: "A1" },
        },
        {
          expected_count: 2,
          completed_count: 1,
          missing_count: 1,
          content_line: { name: "A4" },
        },
      ]),
    },
    notification: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    team: {
      findUnique: jest.fn(async () => ({ id: TEAM_UUID, name: "Team K2" })),
    },
    dailyLinePlan: {
      findMany: jest.fn(async () => [
        {
          user_id: "u1",
          team_id: "team-1",
          plan_date: new Date("2026-09-30T00:00:00.000Z"),
          content_line_id: "cl-a1",
          target: 2,
          deadline: DEADLINE,
          content_line: { name: "A1" },
        },
      ]),
    },
    task: {
      findMany: jest.fn(async () => [
        task("a1-done", {
          status: "SUBMITTED",
          submitted_at: new Date("2026-09-30T09:00:00.000Z"),
        }),
        task("a1-missing", {}),
        task("a4-done", {
          content_line_id: "cl-a4",
          content_line: { name: "A4" },
          task_type: "AUTO",
          run_id: "run-1",
          status: "APPROVED",
          reviewed_at: new Date("2026-09-30T09:30:00.000Z"),
        }),
        task("a4-missing", {
          content_line_id: "cl-a4",
          content_line: { name: "A4" },
          task_type: "AUTO",
          run_id: "run-1",
        }),
      ]),
    },
    dailyTaskCompliance: {
      createMany: jest.fn(async ({ data }: any) => {
        createdSnapshots.push(...data);
        return { count: data.length };
      }),
      findMany: jest.fn(async () => [
        { user_id: "u1", work_date: new Date("2026-09-30T00:00:00.000Z") },
      ]),
      count: jest.fn(async () => 0),
      groupBy: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({
        _count: { _all: 0 },
        _sum: {},
        _min: {},
        _max: {},
      })),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const push: any = { sendToUser: jest.fn(async () => undefined) };
  return {
    service: new TaskComplianceService(prisma, push),
    prisma,
    push,
    tx,
    createdSnapshots,
  };
}

describe("TaskComplianceService.evaluatePastDays", () => {
  it("chốt thiếu task A4 tự động và các tuyến DailyLinePlan, rồi cảnh báo đúng một lần/ngày", async () => {
    const { service, push, tx, createdSnapshots } = build();

    const result = await service.evaluatePastDays(
      DateTime.fromISO("2026-10-01T00:05:00", { zone: "Asia/Ho_Chi_Minh" }),
    );

    expect(result).toEqual({ created: 2, notified: 1 });
    expect(createdSnapshots).toHaveLength(2);
    expect(createdSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "DAILY_PLAN",
          expected_count: 2,
          completed_count: 1,
          missing_count: 1,
        }),
        expect.objectContaining({
          source: "AUTO_A4",
          expected_count: 2,
          completed_count: 1,
          missing_count: 1,
        }),
      ]),
    );
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: "u1",
        type: "DAILY_TASK_SHORTFALL",
        title: "Thiếu 2 task ngày 30/09/2026",
      }),
    });
    expect(push.sendToUser).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        url: "/dashboard/task-auto/compliance?date=2026-09-30",
      }),
    );
  });

  it("task nộp sau deadline không được tính hoàn thành trong ngày", async () => {
    const fixture = build();
    fixture.prisma.task.findMany.mockResolvedValueOnce([
      task("late", {
        status: "SUBMITTED",
        submitted_at: new Date("2026-09-30T11:00:00.000Z"),
      }),
    ]);
    fixture.prisma.dailyTaskCompliance.findMany.mockResolvedValueOnce([]);

    await fixture.service.evaluatePastDays(
      DateTime.fromISO("2026-10-01T00:05:00", { zone: "Asia/Ho_Chi_Minh" }),
    );

    expect(fixture.createdSnapshots[0]).toMatchObject({
      expected_count: 2,
      completed_count: 0,
      missing_count: 2,
    });
  });
});

describe("TaskComplianceService.findHistory", () => {
  const SEP_30 = new Date("2026-09-30T00:00:00.000Z");
  const SEP_29 = new Date("2026-09-29T00:00:00.000Z");
  const user = { id: "u1", full_name: "Nguyễn Văn A", email: "a@x.vn" };
  const team = { id: "team-1", name: "Team K2" };

  function line(extra: Record<string, any>) {
    return {
      id: "c-a1",
      user_id: "u1",
      work_date: SEP_30,
      source: "DAILY_PLAN",
      expected_count: 2,
      completed_count: 1,
      missing_count: 1,
      deadline: DEADLINE,
      user,
      team,
      content_line: { id: "cl-a1", name: "A1" },
      ...extra,
    };
  }

  it("Leader chỉ xem lịch sử thiếu task của team mình quản lý", async () => {
    const { service, prisma } = build();
    prisma.dailyTaskCompliance.groupBy = jest.fn(async () => []);
    prisma.dailyTaskCompliance.aggregate = jest.fn(async () => ({
      _count: { _all: 0 },
      _sum: {},
    }));

    await service.findHistory(
      { id: "leader-1", roles: ["LEADER"] },
      { team_id: "team-1", user_id: "u1", page: 1, limit: 20 },
    );

    const where = prisma.dailyTaskCompliance.groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({
      missing_count: { gt: 0 },
      user_id: "u1",
      team: { leader_id: "leader-1", id: "team-1" },
    });
  });

  it("gộp mỗi người × ngày thành một dòng, phân trang theo nhóm và cộng các tuyến thiếu", async () => {
    const { service, prisma } = build();
    prisma.dailyTaskCompliance.groupBy = jest.fn(async () => [
      { user_id: "u1", work_date: SEP_30, _sum: { missing_count: 3 } },
      { user_id: "u2", work_date: SEP_30, _sum: { missing_count: 1 } },
      { user_id: "u1", work_date: SEP_29, _sum: { missing_count: 1 } },
    ]);
    prisma.dailyTaskCompliance.aggregate = jest.fn(async () => ({
      _count: { _all: 4 },
      _sum: { expected_count: 9, completed_count: 4, missing_count: 5 },
    }));
    prisma.dailyTaskCompliance.findMany.mockReset().mockResolvedValueOnce([
      line({}),
      line({
        id: "c-a4",
        source: "AUTO_A4",
        expected_count: 3,
        completed_count: 1,
        missing_count: 2,
        content_line: { id: "cl-a4", name: "A4" },
      }),
      line({
        id: "c-u2",
        user_id: "u2",
        user: { id: "u2", full_name: "Trần B", email: "b@x.vn" },
      }),
    ]);

    const result = await service.findHistory(
      { id: "admin", roles: ["ADMIN"] },
      { from: "2026-09-01", to: "2026-09-30", page: 1, limit: 2 },
    );

    // Chỉ tải tuyến của 2 nhóm thuộc trang 1.
    const rowWhere = prisma.dailyTaskCompliance.findMany.mock.calls[0][0].where;
    expect(rowWhere.OR).toEqual([
      { user_id: "u1", work_date: SEP_30 },
      { user_id: "u2", work_date: SEP_30 },
    ]);
    expect(result).toMatchObject({
      total: 3,
      totalPages: 2,
      summary: {
        person_days: 3,
        lines: 4,
        expected: 9,
        completed: 4,
        missing: 5,
      },
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      key: "u1|2026-09-30",
      work_date: "2026-09-30",
      user,
      teams: [team],
      expected_count: 5,
      completed_count: 2,
      missing_count: 3,
    });
    expect(result.data[0].lines.map((l: any) => l.content_line.name)).toEqual([
      "A1",
      "A4",
    ]);
    expect(result.data[1]).toMatchObject({ key: "u2|2026-09-30", missing_count: 1 });
  });
});

describe("TaskComplianceService.findDayDetail", () => {
  function snapshot(extra: Record<string, any>) {
    return {
      id: "c-a1",
      user_id: "u1",
      team_id: "team-1",
      work_date: new Date("2026-09-30T00:00:00.000Z"),
      content_line_id: "cl-a1",
      source: "DAILY_PLAN",
      expected_count: 3,
      completed_count: 1,
      missing_count: 2,
      deadline: DEADLINE,
      evaluated_at: new Date("2026-10-01T00:05:00.000Z"),
      user: { id: "u1", full_name: "Nguyễn Văn A", email: "a@x.vn" },
      team: { id: "team-1", name: "Team K2" },
      content_line: { id: "cl-a1", name: "A1" },
      ...extra,
    };
  }

  function detailTask(id: string, extra: Record<string, any>) {
    return {
      ...task(id, extra),
      editor_content: null,
      team_content: null,
      content: null,
      editor_product: null,
      team_product: null,
      product: null,
      ...extra,
    };
  }

  it("liệt kê task chưa nộp đúng hạn theo tuyến và số task chưa tạo của kế hoạch", async () => {
    const { service, prisma } = build();
    prisma.dailyTaskCompliance.findMany.mockReset().mockResolvedValueOnce([
      snapshot({}),
      snapshot({
        id: "c-a4",
        source: "AUTO_A4",
        expected_count: 2,
        completed_count: 1,
        missing_count: 1,
        content_line_id: "cl-a4",
        content_line: { id: "cl-a4", name: "A4" },
      }),
    ]);
    prisma.task.findMany.mockReset().mockResolvedValueOnce([
      detailTask("a1-done", {
        status: "SUBMITTED",
        submitted_at: new Date("2026-09-30T09:00:00.000Z"),
        content: {
          title: null,
          source_team_content: {
            title: null,
            source_editor_content: { title: "Review nồi chiên" },
          },
        },
      }),
      detailTask("a1-late", {
        status: "SUBMITTED",
        submitted_at: new Date("2026-09-30T12:00:00.000Z"),
        editor_content: { title: "Mở hộp máy xay" },
        team_product: { name: null, source_editor_product: { name: "Máy xay" } },
      }),
      detailTask("a4-missing", {
        content_line_id: "cl-a4",
        task_type: "AUTO",
        run_id: "run-1",
      }),
      detailTask("a4-done", {
        content_line_id: "cl-a4",
        task_type: "AUTO",
        run_id: "run-1",
        status: "APPROVED",
        reviewed_at: new Date("2026-09-30T09:30:00.000Z"),
      }),
      // Task A4 tạo tay không thuộc chỉ tiêu A4 tự động.
      detailTask("a4-manual", { content_line_id: "cl-a4" }),
    ]);

    const result = await service.findDayDetail(
      { id: "admin", roles: ["ADMIN"] },
      { date: "2026-09-30", user_id: "u1" },
    );

    const taskWhere = prisma.task.findMany.mock.calls[0][0].where;
    expect(taskWhere).toMatchObject({
      status: { not: "CANCELLED" },
      team_id: { in: ["team-1"] },
      content_line_id: { in: ["cl-a1", "cl-a4"] },
      OR: [
        {
          assignee_id: "u1",
          deadline: {
            gte: new Date("2026-09-29T17:00:00.000Z"),
            lt: new Date("2026-09-30T17:00:00.000Z"),
          },
        },
      ],
    });
    expect(result.summary).toEqual({ expected: 5, completed: 2, missing: 3 });

    const [a1, a4] = result.lines;
    expect(a1.tasks.map((t: any) => [t.id, t.on_time])).toEqual([
      ["a1-late", false],
      ["a1-done", true],
    ]);
    expect(a1.tasks[0]).toMatchObject({
      title: "Mở hộp máy xay",
      product_name: "Máy xay",
    });
    expect(a1.tasks[1].title).toBe("Review nồi chiên");
    // Thiếu 2 nhưng chỉ 1 task trễ → 1 task chưa được tạo.
    expect(a1.untracked_missing).toBe(1);

    expect(a4.tasks.map((t: any) => t.id)).toEqual(["a4-missing", "a4-done"]);
    expect(a4.untracked_missing).toBe(0);
    expect(a4.tasks[1].submitted_at).toEqual(
      new Date("2026-09-30T09:30:00.000Z"),
    );
  });

  it("Member chỉ xem được ngày của chính mình", async () => {
    const { service, prisma } = build();
    prisma.dailyTaskCompliance.findMany.mockReset().mockResolvedValueOnce([]);

    await expect(
      service.findDayDetail(
        { id: "u1", roles: ["EDITOR"] },
        { date: "2026-09-30", user_id: "u2" },
      ),
    ).rejects.toThrow("Không có dữ liệu nhiệm vụ của ngày này");

    const where = prisma.dailyTaskCompliance.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { user_id: "u1" },
      { user_id: "u2", work_date: new Date("2026-09-30T00:00:00.000Z") },
    ]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe("TaskCompliancePayrollSyncQueryDto", () => {
  const errorsFor = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(TaskCompliancePayrollSyncQueryDto, query));

  it("nhận khoảng ngày, UUID và phân trang hợp lệ", () => {
    expect(
      errorsFor({
        from: "2026-09-01",
        to: "2026-09-30",
        user_id: USER_UUID,
        page: 1,
        limit: 100,
      }),
    ).toHaveLength(0);
  });

  it("từ chối ngày sai định dạng, UUID sai và limit vượt giới hạn", () => {
    expect(
      errorsFor({ from: "2026-9-01", to: "2026-09-30" }).length,
    ).toBeGreaterThan(0);
    expect(
      errorsFor({ from: "2026-09-01", to: "2026-02-30" }).length,
    ).toBeGreaterThan(0);
    expect(
      errorsFor({ from: "2026-09-01", to: "2026-09-30", user_id: "u1" }).length,
    ).toBeGreaterThan(0);
    expect(
      errorsFor({ from: "2026-09-01", to: "2026-09-30", limit: 101 }).length,
    ).toBeGreaterThan(0);
  });

  it("group_by chỉ nhận line hoặc person_day, mặc định line", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(errorsFor({ ...range, group_by: "person_day" })).toHaveLength(0);
    expect(errorsFor({ ...range, group_by: "day" }).length).toBeGreaterThan(0);
    expect(
      plainToInstance(TaskCompliancePayrollSyncQueryDto, range).group_by,
    ).toBe("line");
  });
});

/**
 * Bảng daily_task_compliance giả trong bộ nhớ: lọc/gộp/sắp xếp như Prisma ở mức các truy vấn của
 * service dùng, để danh sách, chi tiết ngày và payroll-sync chạy trên cùng một bộ dữ liệu.
 */
function fakeComplianceTable(prisma: any, data: any[]) {
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.AND) return where.AND.every((w: any) => matches(row, w));
    if (where.OR && !where.OR.some((w: any) => matches(row, w))) return false;
    if (where.user_id && row.user_id !== where.user_id) return false;
    if (where.team_id && row.team_id !== where.team_id) return false;
    if (where.missing_count && !(row.missing_count > where.missing_count.gt))
      return false;
    const wd = where.work_date;
    if (wd instanceof Date) {
      if (row.work_date.getTime() !== wd.getTime()) return false;
    } else if (wd) {
      if (wd.gte && row.work_date < wd.gte) return false;
      if (wd.lt && row.work_date >= wd.lt) return false;
    }
    return true;
  };
  const field = (row: any, key: string): any => {
    if (key === "content_line") return row.content_line.name;
    if (key === "user") return row.user.full_name;
    return row[key];
  };
  const sortBy = (rows: any[], orderBy: any[] = []) =>
    [...rows].sort((a, b) => {
      for (const order of orderBy) {
        const [key, dir] = Object.entries(order)[0] as [string, any];
        const direction = typeof dir === "string" ? dir : Object.values(dir)[0];
        const x = field(a, key);
        const y = field(b, key);
        if (x < y) return direction === "asc" ? -1 : 1;
        if (x > y) return direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  const sum = (rows: any[], key: string) =>
    rows.reduce((s, row) => s + row[key], 0);

  prisma.dailyTaskCompliance.findMany = jest.fn(async (args: any) => {
    const rows = sortBy(data.filter((r) => matches(r, args.where)), args.orderBy);
    const skip = args.skip ?? 0;
    return rows.slice(skip, args.take ? skip + args.take : undefined);
  });
  prisma.dailyTaskCompliance.groupBy = jest.fn(async (args: any) => {
    const groups = new Map<string, any>();
    for (const row of data.filter((r) => matches(r, args.where))) {
      const key = `${row.user_id}|${row.work_date.toISOString()}`;
      const group = groups.get(key) ?? {
        user_id: row.user_id,
        work_date: row.work_date,
        _sum: { missing_count: 0 },
      };
      group._sum.missing_count += row.missing_count;
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (a, b) =>
        b.work_date.getTime() - a.work_date.getTime() ||
        b._sum.missing_count - a._sum.missing_count ||
        a.user_id.localeCompare(b.user_id),
    );
  });
  prisma.dailyTaskCompliance.aggregate = jest.fn(async (args: any) => {
    const rows = data.filter((r) => matches(r, args.where));
    const dates = rows.map((r) => r.work_date.getTime());
    return {
      _count: { _all: rows.length },
      _sum: rows.length
        ? {
            expected_count: sum(rows, "expected_count"),
            completed_count: sum(rows, "completed_count"),
            missing_count: sum(rows, "missing_count"),
          }
        : {},
      _min: { work_date: dates.length ? new Date(Math.min(...dates)) : null },
      _max: { work_date: dates.length ? new Date(Math.max(...dates)) : null },
    };
  });
}

describe("TaskComplianceService.payrollSync", () => {
  const SEP_30 = new Date("2026-09-30T00:00:00.000Z");
  const SEP_29 = new Date("2026-09-29T00:00:00.000Z");
  const SEP_28 = new Date("2026-09-28T00:00:00.000Z");
  const team = { id: TEAM_UUID, name: "Team K2" };
  const userA = {
    id: "u1",
    full_name: "Nguyễn Văn A",
    email: "a@x.vn",
    employee_id: "K2_07",
  };
  const userB = {
    id: "u2",
    full_name: "Trần B",
    email: "b@x.vn",
    employee_id: "K2_08",
  };
  const lines = {
    a1: { id: "cl-a1", name: "A1" },
    a2: { id: "cl-a2", name: "A2" },
    a4: { id: "cl-a4", name: "A4" },
  };

  function snapshotRow(
    id: string,
    user: typeof userA,
    workDate: Date,
    line: { id: string; name: string },
    counts: [number, number],
    source = "DAILY_PLAN",
  ) {
    const [expected, completed] = counts;
    return {
      id,
      user_id: user.id,
      team_id: TEAM_UUID,
      work_date: workDate,
      content_line_id: line.id,
      source,
      expected_count: expected,
      completed_count: completed,
      missing_count: expected - completed,
      deadline: new Date(workDate.getTime() + 10 * 3600 * 1000), // 17:00 VN
      evaluated_at: new Date(workDate.getTime() + 24 * 3600 * 1000),
      user,
      team,
      content_line: line,
    };
  }

  const DATA = [
    snapshotRow("s-a-30-a1", userA, SEP_30, lines.a1, [3, 1]),
    snapshotRow("s-a-30-a4", userA, SEP_30, lines.a4, [2, 1], "AUTO_A4"),
    snapshotRow("s-a-30-a2", userA, SEP_30, lines.a2, [2, 2]), // tuyến đủ
    snapshotRow("s-b-30-a1", userB, SEP_30, lines.a1, [1, 0]),
    snapshotRow("s-a-29-a1", userA, SEP_29, lines.a1, [2, 2]), // ngày đủ hết
    snapshotRow("s-a-28-a4", userA, SEP_28, lines.a4, [1, 0], "AUTO_A4"),
  ];

  function dayTask(
    id: string,
    line: { id: string },
    extra: Record<string, any> = {},
  ) {
    return {
      ...task(id, { team_id: TEAM_UUID, content_line_id: line.id }),
      editor_content: null,
      team_content: null,
      content: null,
      editor_product: null,
      team_product: null,
      product: null,
      ...extra,
    };
  }

  const TASKS = [
    dayTask("a1-done", lines.a1, {
      status: "SUBMITTED",
      submitted_at: new Date("2026-09-30T09:00:00.000Z"),
      editor_content: { title: "Review nồi chiên" },
    }),
    dayTask("a1-late", lines.a1, {
      status: "SUBMITTED",
      submitted_at: new Date("2026-09-30T12:00:00.000Z"),
    }),
    dayTask("a4-missing", lines.a4, { task_type: "AUTO", run_id: "run-1" }),
    dayTask("a4-done", lines.a4, {
      task_type: "AUTO",
      run_id: "run-1",
      status: "APPROVED",
      reviewed_at: new Date("2026-09-30T09:30:00.000Z"),
    }),
    // Task A4 tạo tay không thuộc chỉ tiêu A4 tự động.
    dayTask("a4-manual", lines.a4),
    dayTask("a2-done-1", lines.a2, {
      status: "APPROVED",
      reviewed_at: new Date("2026-09-30T08:00:00.000Z"),
    }),
    dayTask("a2-done-2", lines.a2, {
      status: "SUBMITTED",
      submitted_at: new Date("2026-09-30T08:30:00.000Z"),
    }),
    // Task của người khác cùng ngày/tuyến không được ghép nhầm.
    dayTask("b-a1-other-day", lines.a1, {
      assignee_id: "u2",
      deadline: new Date("2026-09-29T10:00:00.000Z"),
    }),
  ];

  function setup() {
    const fixture = build();
    fakeComplianceTable(fixture.prisma, DATA);
    fixture.prisma.task.findMany.mockReset().mockResolvedValue(TASKS);
    return fixture;
  }

  const query = {
    from: "2026-09-01",
    to: "2026-09-30",
    page: 1,
    limit: 20,
  };

  it("giữ nguyên các trường 1.0: summary cộng mọi snapshot, records chỉ có tuyến thiếu", async () => {
    const { service, prisma } = setup();

    const result = await service.payrollSync(TEAM_UUID, query);

    expect(result).toMatchObject({
      contract_version: "1.1",
      timezone: "Asia/Ho_Chi_Minh",
      range: { from: "2026-09-01", to: "2026-09-30" },
      team: { id: TEAM_UUID, name: "Team K2" },
      filters: { user_id: null, group_by: "line" },
      coverage: {
        snapshot_count: 6,
        evaluated_from: "2026-09-28",
        evaluated_through: "2026-09-30",
      },
      summary: {
        expected: 11,
        completed_on_time: 6,
        missing: 5,
        affected_days: 2,
        affected_records: 4,
      },
      pagination: { page: 1, limit: 20, total: 4, total_pages: 1 },
      warnings: [],
    });
    expect(result).not.toHaveProperty("days");
    // Thứ tự 1.0: ngày giảm dần → tên người → tên tuyến.
    expect(result.records.map((r) => r.id)).toEqual([
      "s-a-30-a1",
      "s-a-30-a4",
      "s-b-30-a1",
      "s-a-28-a4",
    ]);
    expect(result.records[0]).toMatchObject({
      user_id: "u1",
      employee_id: "K2_07",
      user_name: "Nguyễn Văn A",
      team_id: TEAM_UUID,
      work_date: "2026-09-30",
      content_line: lines.a1,
      deadline: "2026-09-30T10:00:00.000Z",
      evaluated_at: "2026-10-01T00:00:00.000Z",
      untracked_missing: 1,
    });
    expect(result.records[0].tasks[0]).toEqual({
      id: "a1-late",
      title: null,
      product_name: null,
      status: "SUBMITTED",
      deadline: "2026-09-30T10:00:00.000Z",
      submitted_at: "2026-09-30T12:00:00.000Z",
      on_time: false,
    });
    // Người B không có task nào → toàn bộ phần thiếu là task chưa tạo.
    expect(result.records[2]).toMatchObject({ untracked_missing: 1, tasks: [] });

    const baseAggregate = prisma.dailyTaskCompliance.aggregate.mock.calls.find(
      ([args]: any[]) => !args.where.missing_count,
    )[0];
    expect(baseAggregate.where).toMatchObject({ team_id: TEAM_UUID });
  });

  it("khớp chính xác màn Nhiệm vụ còn thiếu: ô tổng, từng dòng người × ngày và phần mở rộng", async () => {
    const { service } = setup();
    const admin = { id: "admin", roles: ["ADMIN"] };

    const [payroll, history] = await Promise.all([
      service.payrollSync(TEAM_UUID, { ...query, group_by: "person_day" }),
      service.findHistory(admin, { ...query, team_id: TEAM_UUID }),
    ]);

    expect(payroll.shortfall_summary).toEqual(history.summary);
    expect(payroll.shortfall_summary).toEqual({
      person_days: 3,
      lines: 4,
      expected: 7,
      completed: 2,
      missing: 5,
    });
    expect(payroll.pagination).toEqual({
      page: 1,
      limit: 20,
      total: history.total,
      total_pages: history.totalPages,
    });

    const days = payroll.days!;
    expect(
      days.map((d) => [
        d.key,
        d.employee_id,
        d.expected_count,
        d.completed_count,
        d.missing_count,
      ]),
    ).toEqual(
      history.data.map((row) => [
        row.key,
        DATA.find((s) => s.user_id === row.user.id)!.user.employee_id,
        row.expected_count,
        row.completed_count,
        row.missing_count,
      ]),
    );

    for (const day of days) {
      const detail = await service.findDayDetail(admin, {
        date: day.work_date,
        user_id: day.user_id,
        team_id: TEAM_UUID,
      });
      expect(day.day_total).toEqual(detail.summary);
      expect(
        day.lines.map((l) => [
          l.id,
          l.missing_count,
          l.untracked_missing,
          l.tasks.map((t) => [t.id, t.on_time]),
        ]),
      ).toEqual(
        detail.lines.map((l) => [
          l.id,
          l.missing_count,
          l.untracked_missing,
          l.tasks.map((t) => [t.id, t.on_time]),
        ]),
      );
    }

    // Phần mở rộng có cả tuyến đủ A2, còn records chỉ gồm tuyến thiếu của trang.
    expect(days[0].lines.map((l) => l.id)).toEqual([
      "s-a-30-a1",
      "s-a-30-a4",
      "s-a-30-a2",
    ]);
    expect(days[0].day_total).toEqual({ expected: 7, completed: 4, missing: 3 });
    expect(payroll.records.map((r) => r.id)).toEqual([
      "s-a-30-a1",
      "s-a-30-a4",
      "s-b-30-a1",
      "s-a-28-a4",
    ]);
  });

  it("person_day phân trang theo người × ngày như màn danh sách", async () => {
    const { service } = setup();

    const result = await service.payrollSync(TEAM_UUID, {
      ...query,
      group_by: "person_day",
      page: 2,
      limit: 2,
    });

    expect(result.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      total_pages: 2,
    });
    expect(result.days!.map((d) => d.key)).toEqual(["u1|2026-09-28"]);
    expect(result.records.map((r) => r.id)).toEqual(["s-a-28-a4"]);
  });

  it("trả 200 cùng warning khi chưa có snapshot", async () => {
    const { service, prisma } = build();
    fakeComplianceTable(prisma, []);

    const result = await service.payrollSync(TEAM_UUID, {
      ...query,
      user_id: USER_UUID,
    });

    expect(result.coverage).toEqual({
      snapshot_count: 0,
      evaluated_from: null,
      evaluated_through: null,
    });
    expect(result.shortfall_summary).toEqual({
      person_days: 0,
      lines: 0,
      expected: 0,
      completed: 0,
      missing: 0,
    });
    expect(result.records).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "NO_COMPLIANCE_SNAPSHOT" }),
    ]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it("từ chối khoảng ngày đảo ngược hoặc dài quá 366 ngày", async () => {
    const { service, prisma } = build();

    await expect(
      service.payrollSync(TEAM_UUID, {
        ...query,
        from: "2026-10-01",
        to: "2026-09-01",
      }),
    ).rejects.toThrow("from phải nhỏ hơn hoặc bằng to");
    await expect(
      service.payrollSync(TEAM_UUID, {
        ...query,
        from: "2025-01-01",
        to: "2026-01-02",
      }),
    ).rejects.toThrow("Khoảng ngày không được vượt quá 366 ngày");
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it("trả 404 khi team không tồn tại", async () => {
    const { service, prisma } = build();
    prisma.team.findUnique.mockResolvedValueOnce(null);

    await expect(service.payrollSync(TEAM_UUID, query)).rejects.toThrow(
      "Team không tồn tại",
    );
  });
});

describe("TaskCompliancePayrollSyncController — route & auth", () => {
  const handler = TaskCompliancePayrollSyncController.prototype.payrollSync;

  function ctx(user: any) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => handler,
      getClass: () => TaskCompliancePayrollSyncController,
    } as any;
  }

  it("chuyển team và query xuống service", async () => {
    const snapshot = { contract_version: "1.1", records: [] };
    const compliance = { payrollSync: jest.fn(async () => snapshot) };
    const controller = new TaskCompliancePayrollSyncController(
      compliance as any,
    );
    const query = { from: "2026-09-01", to: "2026-09-30", page: 1, limit: 20 };

    await expect(controller.payrollSync(TEAM_UUID, query)).resolves.toBe(
      snapshot,
    );
    expect(compliance.payrollSync).toHaveBeenCalledWith(TEAM_UUID, query);
  });

  it("chỉ role ADMIN được RolesGuard chấp nhận", () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata("roles", handler)).toEqual(["ADMIN"]);
    expect(
      Reflect.getMetadata(
        "apiKeyReadOnly",
        TaskCompliancePayrollSyncController,
      ),
    ).toBe(true);
    expect(guard.canActivate(ctx({ id: "svc", roles: ["ADMIN"] }))).toBe(true);
    expect(guard.canActivate(ctx({ id: "manager", roles: ["MANAGER"] }))).toBe(
      false,
    );
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });
});

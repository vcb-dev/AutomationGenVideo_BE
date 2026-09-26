import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PerformanceGoalsService } from "../performance-goals.service";

const baseGoal = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  team_id: "33333333-3333-4333-8333-333333333333",
  month: "2026-09",
  type: "KPI",
  kpi_group_id: "10000000-0000-4000-8000-000000000002",
  title: "Concept mới",
  description: null,
  metric_type: "NUMBER",
  unit: "concept",
  direction: "AT_LEAST",
  target_value: 10,
  actual_system: null,
  actual_manual: 8,
  pass_threshold_pct: 80,
  status: "PUBLISHED",
  revision: 1,
  set_by_id: "44444444-4444-4444-8444-444444444444",
  archived_at: null,
  created_at: new Date("2026-09-01T00:00:00Z"),
  updated_at: new Date("2026-09-02T00:00:00Z"),
  kpi_group: {
    id: "10000000-0000-4000-8000-000000000002",
    team_id: null,
    code: "CONTENT",
    name: "Content",
    description: null,
    color: "GREEN",
    icon: "FILE_TEXT",
    sort_order: 20,
    is_system: true,
    is_active: true,
  },
};

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    team: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      ...overrides.team,
    },
    performanceGoal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      ...overrides.performanceGoal,
    },
    performanceKpiGroup: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      ...overrides.performanceKpiGroup,
    },
    ...overrides,
  } as any;
}

describe("PerformanceGoalsService", () => {
  it("leader không thể giao mục tiêu cho team mình không lead", async () => {
    const prisma = makePrisma({
      team: {
        findUnique: jest.fn().mockResolvedValue({
          id: baseGoal.team_id,
          leader_id: "leader-khac",
          members: [{ id: "member-1" }],
        }),
      },
    });
    const service = new PerformanceGoalsService(prisma);

    await expect(
      service.create(
        {
          user_id: baseGoal.user_id,
          team_id: baseGoal.team_id,
          month: "2026-09",
          type: "KPI" as any,
          title: "Concept mới",
          target_value: 10,
        },
        { id: "leader-1", roles: ["LEADER"] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("manager không thể giao mục tiêu cho người không thuộc team", async () => {
    const prisma = makePrisma({
      team: {
        findUnique: jest.fn().mockResolvedValue({
          id: baseGoal.team_id,
          leader_id: "leader-1",
          members: [],
        }),
      },
    });
    const service = new PerformanceGoalsService(prisma);

    await expect(
      service.create(
        {
          user_id: baseGoal.user_id,
          team_id: baseGoal.team_id,
          month: "2026-09",
          type: "OKR" as any,
          title: "OKR không hợp lệ",
          target_value: 10,
        },
        { id: "manager-1", roles: ["MANAGER"] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("bắt buộc lý do khi điều chỉnh số thực đạt", async () => {
    const prisma = makePrisma({
      team: {
        findUnique: jest.fn().mockResolvedValue({
          id: baseGoal.team_id,
          leader_id: "leader-1",
          members: [],
        }),
      },
      performanceGoal: {
        findUnique: jest.fn().mockResolvedValue(baseGoal),
      },
    });
    const service = new PerformanceGoalsService(prisma);

    await expect(
      service.update(
        baseGoal.id,
        { expected_revision: 1, actual_manual: 9 },
        { id: "manager-1", roles: ["MANAGER"] },
      ),
    ).rejects.toThrow("Vui lòng nhập lý do");
  });

  it("payroll trả actual cuối và tiến độ đã cap, không chứa cấu hình thưởng", async () => {
    const prisma = makePrisma({
      team: {
        findUnique: jest.fn().mockResolvedValue({ id: baseGoal.team_id, name: "Team K2" }),
      },
      performanceGoal: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...baseGoal,
            actual_manual: 12,
            user: {
              id: baseGoal.user_id,
              full_name: "Editor A",
              email: "a@example.com",
              employee_id: "K2_07",
            },
            team: { id: baseGoal.team_id, name: "Team K2", leader_id: "leader-1" },
            set_by: { id: "manager-1", full_name: "Manager" },
          },
        ]),
      },
    });
    const service = new PerformanceGoalsService(prisma);
    const result = await service.payrollSync(baseGoal.team_id, "2026-09");

    expect(result.records[0]).toEqual(
      expect.objectContaining({
        kpi_group_code: "CONTENT",
        kpi_group_name: "Content",
        actual_final: 12,
        progress_pct: 120,
        progress_pct_for_overall: 100,
        passed: true,
        actual_source: "MANUAL_IN_AGV",
      }),
    );
    expect(result.contract_version).toBe("2.0");
    expect(result.records[0]).not.toHaveProperty("bonus_amount");
    expect(result.records[0]).not.toHaveProperty("bonus_earned");
  });
});

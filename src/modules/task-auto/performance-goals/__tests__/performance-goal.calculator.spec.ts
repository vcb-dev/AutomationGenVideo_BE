import {
  calculateGoalProgress,
  calculateUnweightedOverall,
} from "../performance-goal.calculator";

describe("performance goal calculator", () => {
  it("ưu tiên actual nhập tay và giữ tiến độ hiển thị vượt 100%", () => {
    expect(
      calculateGoalProgress({
        target: 10,
        actualSystem: 8,
        actualManual: 12,
        direction: "AT_LEAST",
        passThresholdPct: 80,
      }),
    ).toEqual({
      actualFinal: 12,
      progressPct: 120,
      progressPctForOverall: 100,
      passed: true,
    });
  });

  it("actual trống được tính 0 khi lấy trung bình tổng nhưng chưa pass", () => {
    expect(
      calculateGoalProgress({
        target: 10,
        direction: "AT_LEAST",
        passThresholdPct: 80,
      }),
    ).toEqual({
      actualFinal: null,
      progressPct: null,
      progressPctForOverall: 0,
      passed: false,
    });
  });

  it("hỗ trợ chỉ tiêu càng thấp càng tốt", () => {
    expect(
      calculateGoalProgress({
        target: 5,
        actualManual: 4,
        direction: "AT_MOST",
        passThresholdPct: 80,
      }).passed,
    ).toBe(true);
    expect(
      calculateGoalProgress({
        target: 5,
        actualManual: 10,
        direction: "AT_MOST",
        passThresholdPct: 80,
      }).progressPct,
    ).toBe(50);
  });

  it("tính trung bình không trọng số và dùng giá trị đã cap", () => {
    expect(
      calculateUnweightedOverall([
        { progressPctForOverall: 100 },
        { progressPctForOverall: 80 },
        { progressPctForOverall: 0 },
      ]),
    ).toBe(60);
    expect(calculateUnweightedOverall([])).toBeNull();
  });
});

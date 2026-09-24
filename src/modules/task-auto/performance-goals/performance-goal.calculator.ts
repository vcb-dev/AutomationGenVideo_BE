export type GoalDirection = "AT_LEAST" | "AT_MOST";

export interface GoalProgress {
  actualFinal: number | null;
  progressPct: number | null;
  progressPctForOverall: number;
  passed: boolean;
}

/**
 * Tiến độ hiển thị giữ nguyên phần vượt 100%; riêng giá trị đi vào trung bình tổng được cap 100%
 * để một mục vượt xa kế hoạch không bù cho nhiều mục chưa đạt.
 */
export function calculateGoalProgress(input: {
  target: number;
  actualSystem?: number | null;
  actualManual?: number | null;
  direction: GoalDirection;
  passThresholdPct: number;
}): GoalProgress {
  const actualFinal = input.actualManual ?? input.actualSystem ?? null;
  if (actualFinal === null || input.target <= 0) {
    return {
      actualFinal,
      progressPct: null,
      progressPctForOverall: 0,
      passed: false,
    };
  }

  const ratio =
    input.direction === "AT_MOST"
      ? actualFinal <= input.target
        ? 1
        : input.target / actualFinal
      : actualFinal / input.target;
  const progressPct = Math.max(0, ratio * 100);
  const passed = progressPct >= input.passThresholdPct;

  return {
    actualFinal,
    progressPct,
    progressPctForOverall: Math.min(progressPct, 100),
    passed,
  };
}

export function calculateUnweightedOverall(
  progress: Array<Pick<GoalProgress, "progressPctForOverall">>,
): number | null {
  if (progress.length === 0) return null;
  return (
    progress.reduce((sum, item) => sum + item.progressPctForOverall, 0) /
    progress.length
  );
}

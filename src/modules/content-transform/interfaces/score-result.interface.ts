export interface ScoreItemResult {
  label: string;
  passed: boolean;
  quote: string;
  suggestion?: string;
}

/**
 * 'error': score/maxScore < 0.5 (fail quá nửa số tiêu chí trong nhóm)
 * 'warning': 0.5 <= score/maxScore < 1 (có fail nhưng chưa quá nửa)
 * 'good': score/maxScore === 1 (không fail tiêu chí nào)
 */
export type GroupStatus = 'good' | 'warning' | 'error';

export interface ScoreGroupResult {
  name: string;
  maxScore: number;
  score: number;
  status: GroupStatus;
  items: ScoreItemResult[];
}

export interface HardGateViolation {
  type: string;
  quote: string;
  explanation: string;
}

export interface ScoreResult {
  groups: ScoreGroupResult[];
  overallScore: number;
  verdict: string;
  hardGateViolations: HardGateViolation[];
}

/** Shape thô AI trả về trước khi BE validate quote + tính lại điểm. */
export interface RawAiScoreItem {
  label?: string;
  passed?: boolean;
  quote?: string;
  suggestion?: string;
}

export interface RawAiScoreGroup {
  name?: string;
  items?: RawAiScoreItem[];
}

export interface RawAiHardGateViolation {
  type?: string;
  quote?: string;
  explanation?: string;
}

export interface RawAiScoreResponse {
  groups?: RawAiScoreGroup[];
  hardGateViolations?: RawAiHardGateViolation[];
}

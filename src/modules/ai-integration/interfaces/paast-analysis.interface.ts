/**
 * Cấu trúc kết quả chấm điểm PAAST do AI service trả về.
 *
 * Đây là NGUỒN TÊN FIELD DUY NHẤT cho khung PAAST trong BE: phần "chuyển đổi content" của
 * AiIntegrationService import lại chính các type này và lưu/trả nguyên shape cho FE, không tự
 * đặt tên khác (tránh phải sửa 2 nơi mỗi khi khung PAAST đổi). Tên field giữ đúng snake_case như
 * AI service trả ra — cố ý không camelCase hoá để không phát sinh lớp map trung gian.
 *
 * (Chuyển từ module `paast-analyzer` sang đây khi gộp content-transform vào ai-integration —
 * module paast-analyzer chỉ còn tồn tại để giữ types này, nay không còn lý do tách riêng.)
 */

/**
 * Phiên bản logic chấm điểm PAAST. Lưu kèm mỗi bản ghi (`logic_version`), bắt buộc khớp khi tra
 * cache — đổi công thức/tiêu chí/prompt thì tăng hằng số này để điểm cũ thành cache miss thay vì
 * bị trả lại theo công thức lỗi thời.
 *
 * v2: trọng số 5 lớp 25/25/20/15/15; Prefer thành hard-gate coherence (>1 primary hoặc
 *     incoherent ⇒ 0/25); verdict Prefer đòi đúng 1 primary + coherent.
 * v3: sửa nghĩa rubric (Prefer = cảm xúc đọng lại; Action nhận cả CTA trực tiếp; Acknowledge cần
 *     sản phẩm cụ thể; Trust mặc định pass nếu không có bằng chứng ngược) — công thức giữ nguyên.
 * v4: mỗi tiêu chí có `level` 0-5 thay pass/miss; điểm lớp = max × (Σlevel / Σlevel_max);
 *     primary/secondary của Prefer do code chọn theo level, điểm mỗi khe tỷ lệ theo level đó.
 */
export const PAAST_LOGIC_VERSION = 'v4';

/** Mức độ triển khai 1 tiêu chí — 0 (Không có) tới 5 (Xuất sắc), xem `PAAST_LEVEL_LABELS`. */
export type PaastLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Nhãn hiển thị cho từng mức `PaastLevel` — khớp LEVEL_LABELS phía AI service. */
export const PAAST_LEVEL_LABELS: Record<PaastLevel, string> = {
  0: 'Không có',
  1: 'Rất yếu',
  2: 'Yếu',
  3: 'Khá',
  4: 'Mạnh',
  5: 'Xuất sắc',
};

/** Trạng thái 1 insight ở lớp Prefer — đánh giá toàn bài, không phải pass/miss. */
export type PaastPreferStatus = 'primary' | 'secondary' | 'off';

/** Trạng thái 1 tiêu chí ở 4 lớp còn lại. `na` = không đánh giá được bằng text (cần production). */
export type PaastCriterionStatus = 'pass' | 'miss' | 'na';

/** Độ "đọng lại" của takeaway sau khi xem hết. */
export type PaastWowStrength = 'strong' | 'moderate' | 'weak';

export interface PaastInsight {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastPreferStatus;
  /** v4: mức độ insight này là động lực chính (0-5), không chỉ "có nhắc tới". */
  level: PaastLevel;
  level_label: string;
  description: string;
  /** 1-2 câu lý do, dựa trên vai trò trong mạch nội dung. */
  reasoning: string;
  evidence_sentences: string[];
}

export interface PaastCriterion {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastCriterionStatus;
  /** v4: mức triển khai thật (0-5); `status='pass'` khi level ≥ 3. `null` chỉ khi `status='na'`. */
  level: PaastLevel | null;
  level_label: string | null;
  evidence: string;
  /** 1-2 câu lý do đạt/miss, dựa trên đọc hiểu toàn bài. */
  reasoning: string;
}

/** Content có giữ đúng 1 trọng tâm từ hook đến payoff không. `warning` chỉ có khi không coherent. */
export interface PaastCoherence {
  is_coherent: boolean;
  warning?: string;
}

/** Lớp Prefer (CRAVES) — chấm theo insight nổi bật của toàn bài. */
export interface PaastLayerInsights {
  score: number;
  max: number;
  primary_count: number;
  secondary_count: number;
  insights: PaastInsight[];
  /** Điều đọng lại sau khi xem hết, gói trong 1 câu. */
  takeaway_statement: string;
  wow_strength: PaastWowStrength;
  coherence: PaastCoherence;
}

/** 4 lớp Action / Acknowledge / Stick / Trust — chấm theo từng tiêu chí. */
export interface PaastLayerCriteria {
  score: number;
  max: number;
  pass_count: number;
  text_detectable_count?: number;
  criteria: PaastCriterion[];
}

export interface PaastLayers {
  prefer: PaastLayerInsights;
  action: PaastLayerCriteria;
  acknowledge: PaastLayerCriteria;
  stick: PaastLayerCriteria;
  trust: PaastLayerCriteria;
}

/**
 * Mô phỏng "xem như video thật" — độc lập với 5 lớp PAAST, luôn xuất hiện kể cả khi verdict = đạt
 * (content đủ 5 lớp nội dung vẫn có thể "chết" khi quay thật).
 */
export interface PaastVideoRealism {
  opening_beat: string;
  pacing_note: string;
  show_vs_tell: string;
  payoff_note: string;
  overall_feasibility: 'realistic' | 'needs-adjustment' | 'high-risk';
}

/** Band hiển thị kèm `total_score`. */
export type PaastScoreBand = 'ready' | 'close' | 'needs-work' | 'not-ready';

/** Cảnh báo CTA lệch chuẩn New Media — chỉ cảnh báo, KHÔNG trừ vào điểm 100. */
export interface PaastCtaWarning {
  detected: boolean;
  matches: string[];
}

/**
 * Kết luận đạt/chưa đạt chuẩn PAAST — do AI service tính (compute_verdict), KHÔNG theo ngưỡng
 * điểm tổng: điểm cao vẫn có thể do dồn hết vào vài lớp trong khi bỏ trắng hẳn 1 lớp khác.
 * Đạt khi cả 5 lớp đều có ít nhất 1 tiêu chí đạt; riêng Prefer đòi đúng 1 `primary` và coherent.
 */
export interface PaastVerdict {
  passed: boolean;
  passed_layers: string[];
  missing_layers: string[];
}

/** Payload thô AI service trả về ở /api/ai/paast/analyze/. */
export interface PaastAnalysisPayload {
  layers: PaastLayers;
  video_realism: PaastVideoRealism;
  total_score: number;
  /** Optional: bản ghi/response cũ chấm trước khi AI service có score_band. */
  score_band?: PaastScoreBand;
  cta_warning: PaastCtaWarning;
  /** Optional: bản ghi/response cũ chấm trước khi AI service có compute_verdict. */
  verdict?: PaastVerdict;
}

/**
 * Kết quả chấm khi ĐÃ LƯU xuống DB — là payload thô cộng thêm dấu phiên bản logic đã dùng.
 *
 * `logic_version` để optional vì các bản ghi chấm TRƯỚC khi có cơ chế version hoàn toàn không
 * có field này; chúng được coi là version không xác định nên luôn cache miss (chấm lại), đúng
 * ý đồ — không thể khẳng định chúng được chấm bằng công thức hiện hành.
 */
export interface PaastStoredScore extends PaastAnalysisPayload {
  logic_version?: string;
}

/** 1 tiêu chí đang `miss` — dùng để dựng prompt nâng cấp content. */
export interface PaastMissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

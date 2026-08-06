/**
 * Cấu trúc kết quả chấm điểm PAAST do AI service trả về.
 *
 * Đây là NGUỒN TÊN FIELD DUY NHẤT cho khung PAAST trong BE: module content-transform
 * import lại chính các type này và lưu/trả nguyên shape cho FE, không tự đặt tên khác
 * (tránh phải sửa 2 nơi mỗi khi khung PAAST đổi). Tên field giữ đúng snake_case như AI
 * service trả ra — cố ý không camelCase hoá để không phát sinh lớp map trung gian.
 */

/**
 * Phiên bản logic chấm điểm PAAST hiện hành.
 *
 * Được lưu KÈM vào từng bản ghi kết quả chấm (`logic_version`) và bắt buộc khớp khi tra cache.
 * Nhờ vậy khi công thức chấm đổi (đổi bộ tiêu chí, đổi cách quy đổi điểm, đổi prompt phân loại)
 * chỉ cần tăng hằng số này: mọi điểm cũ lập tức thành cache miss và được chấm lại thật, thay vì
 * lặng lẽ trả về điểm tính theo công thức đã lỗi thời.
 *
 * TĂNG version mỗi khi thay đổi bất cứ thứ gì làm cùng một nội dung phải ra điểm khác trước đây.
 */
export const PAAST_LOGIC_VERSION = 'v1';

/** Trạng thái 1 insight ở lớp Prefer — đánh giá toàn bài, không phải pass/miss. */
export type PaastPreferStatus = 'primary' | 'secondary' | 'off';

/** Trạng thái 1 tiêu chí ở 4 lớp còn lại. `na` = không đánh giá được bằng text (cần production). */
export type PaastCriterionStatus = 'pass' | 'miss' | 'na';

export interface PaastInsight {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastPreferStatus;
  description: string;
  evidence_sentences: string[];
}

export interface PaastCriterion {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastCriterionStatus;
  evidence: string;
}

/** Lớp Prefer (CRAVES) — chấm theo insight nổi bật của toàn bài. */
export interface PaastLayerInsights {
  score: number;
  primary_count: number;
  secondary_count: number;
  insights: PaastInsight[];
}

/** 4 lớp Action / Acknowledge / Stick / Trust — chấm theo từng tiêu chí. */
export interface PaastLayerCriteria {
  score: number;
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

/** Cảnh báo CTA lệch chuẩn New Media — chỉ cảnh báo, KHÔNG trừ vào điểm 100. */
export interface PaastCtaWarning {
  detected: boolean;
  matches: string[];
}

/** Payload thô AI service trả về ở /api/ai/paast/analyze/. */
export interface PaastAnalysisPayload {
  layers: PaastLayers;
  total_score: number;
  cta_warning: PaastCtaWarning;
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

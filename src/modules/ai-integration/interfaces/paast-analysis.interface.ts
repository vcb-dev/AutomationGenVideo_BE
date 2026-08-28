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
 * Phiên bản logic chấm điểm PAAST hiện hành.
 *
 * Được lưu KÈM vào từng bản ghi kết quả chấm (`logic_version`) và bắt buộc khớp khi tra cache.
 * Nhờ vậy khi công thức chấm đổi (đổi bộ tiêu chí, đổi cách quy đổi điểm, đổi prompt phân loại)
 * chỉ cần tăng hằng số này: mọi điểm cũ lập tức thành cache miss và được chấm lại thật, thay vì
 * lặng lẽ trả về điểm tính theo công thức đã lỗi thời.
 *
 * TĂNG version mỗi khi thay đổi bất cứ thứ gì làm cùng một nội dung phải ra điểm khác trước đây.
 *
 * v2 (PAAST_Analyzer_Spec.md patch v2.1): đổi trọng số 5 lớp (25/25/20/15/15 thay vì 20 đều
 * nhau), đổi công thức Prefer sang hard-gate coherence (>1 primary hoặc coherence=false ⇒
 * Prefer=0/25 thay vì tuyến tính primary*10+secondary*2), đổi điều kiện Prefer "đạt" ở verdict
 * (primary_count===1 && is_coherent, không còn >=1) — điểm/verdict cũ hoàn toàn không so sánh
 * được với công thức mới, buộc phải bump version để cache-by-content không trả nhầm điểm cũ.
 *
 * v3 (sửa lệch nghĩa rubric, không đổi công thức tính điểm): (1) Prefer/Reactions ("Cảm xúc
 * mạnh") đổi nghĩa từ "gây phản ứng nhất thời" (con số sốc, tình huống nguy hiểm — dễ nhầm với
 * Curiosity) sang đúng nghĩa gốc "nếu dựng thành video, gây cảm xúc buồn/vui RÕ RÀNG và đọng lại"
 * — cùng nội dung có thể đổi primary/secondary. (2) Action/FEEL/ANSWER/CONNECT/ENGAGE giờ nhận
 * diện cả lời mời tương tác TRỰC TIẾP kiểu "hãy comment/lưu/like và chia sẻ..." là hợp lệ (trước
 * đây ưu tiên câu hỏi khiêu khích, generic CTA dễ bị chấm miss hơn) — cùng nội dung có thể đổi
 * pass/miss. (3) Acknowledge/Basics yêu cầu rõ nội dung xoay quanh một sản phẩm/dịch vụ CỤ THỂ.
 * (4) Trust/Transparency: kịch bản chỉ có câu chữ không còn bị chấm "miss" oan vì thiếu yếu tố
 * vốn chỉ thể hiện được qua hình ảnh/hậu trường khi lên video — mặc định "pass" khi không có bằng
 * chứng ngược lại, ép tại code (không chỉ nhờ prompt) — Trust hầu như luôn có ≥1 tiêu chí đạt, ảnh
 * hưởng cả điểm Trust lẫn verdict layer này. Tất cả 4 thay đổi trên có thể khiến CÙNG một content
 * ra điểm/verdict khác bản v2 dù công thức compute_scores/compute_verdict giữ nguyên.
 *
 * v4 (đổi CÔNG THỨC tính điểm — theo tài liệu nghiệp vụ PAAST đầy đủ, "Quy tắc 2: có nhưng yếu ≠
 * điểm cao"): mọi tiêu chí giờ có thêm field `level` (0-5, xem `PaastLevel`) — thay pass/miss nhị
 * phân, một tiêu chí "có mặt" không còn tự động ăn trọn điểm của tiêu chí đó. Action/Acknowledge/
 * Stick/Trust: điểm lớp = điểm tối đa × (tổng level đã chấm / tổng level tối đa có thể đạt) thay
 * vì đếm số tiêu chí "pass". Prefer: GIỮ NGUYÊN cơ chế "1 chủ + 1 phụ + coherence hard-gate" của
 * v2 (primary/secondary vẫn tối đa 1 mỗi loại, coherence=false vẫn ép Prefer=0/25), nhưng primary/
 * secondary giờ do CODE chọn theo `level` (insight level cao nhất ⇒ primary, cao nhì đủ ngưỡng ⇒
 * secondary — không còn LLM tự gán nhãn primary/secondary/off), và điểm mỗi khe tỷ lệ theo level
 * của chính insight đó (không còn 12.5đ cố định chỉ vì được chọn). `status` (pass/miss/na hoặc
 * primary/secondary/off) VẪN tồn tại — giờ là field SUY RA từ `level` ở AI service, giữ để
 * `pass_count`/verdict/UI hiện tại không cần đổi theo. CÙNG một content gần như chắc chắn ra điểm
 * khác bản v3 (dù verdict pass/fail có thể vẫn giữ nguyên do ngưỡng "đạt" không đổi).
 */
export const PAAST_LOGIC_VERSION = 'v4';

/** Mức độ triển khai 1 tiêu chí PAAST — 0 (Không có) tới 5 (Xuất sắc), xem `PAAST_LEVEL_LABELS`. */
export type PaastLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Nhãn hiển thị cho từng mức `PaastLevel` — khớp đúng LEVEL_LABELS phía AI service (Python). */
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

/** Độ "đọng lại" của takeaway sau khi xem hết — patch v2.1 §3.1. */
export type PaastWowStrength = 'strong' | 'moderate' | 'weak';

export interface PaastInsight {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastPreferStatus;
  /** MỚI v4 — mức độ insight này thực sự là động lực chính, không phải chỉ "có nhắc tới". */
  level: PaastLevel;
  level_label: string;
  description: string;
  /** 1-2 câu TẠI SAO — dựa trên vai trò trong mạch nội dung, không phải đếm từ khoá. */
  reasoning: string;
  evidence_sentences: string[];
}

export interface PaastCriterion {
  code: string;
  name_en: string;
  name_vi: string;
  status: PaastCriterionStatus;
  /** MỚI v4 — mức độ triển khai thật (0-5); `status` = "pass" khi level ≥ 3 ("Khá"). `null` chỉ
   * khi `status === 'na'` (4 tiêu chí Stick cần production, không detect được từ text). */
  level: PaastLevel | null;
  level_label: string | null;
  evidence: string;
  /** 1-2 câu TẠI SAO đạt/miss — dựa trên đọc hiểu toàn bài, không phải đếm từ khoá. */
  reasoning: string;
}

/**
 * Coherence check (MỚI, patch v2.1 §3.1) — content có giữ đúng 1 trọng tâm từ hook đến payoff
 * không. `warning` chỉ có khi `is_coherent = false`.
 */
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
  /** Điều đọng lại sau khi xem hết — nếu chỉ được nói 1 câu. */
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
 * Video Realism Check (MỚI, patch v2.1 §4) — mô phỏng "xem như video thật", độc lập với 5 lớp
 * PAAST và LUÔN xuất hiện, kể cả khi verdict tổng = "Đạt chuẩn": 1 content có thể đủ 5 lớp về
 * nội dung nhưng vẫn "chết" khi quay thành video thật.
 */
export interface PaastVideoRealism {
  opening_beat: string;
  pacing_note: string;
  show_vs_tell: string;
  payoff_note: string;
  overall_feasibility: 'realistic' | 'needs-adjustment' | 'high-risk';
}

/** Band hiển thị kèm `total_score` — patch v2.1 §10.4. */
export type PaastScoreBand = 'ready' | 'close' | 'needs-work' | 'not-ready';

/** Cảnh báo CTA lệch chuẩn New Media — chỉ cảnh báo, KHÔNG trừ vào điểm 100. */
export interface PaastCtaWarning {
  detected: boolean;
  matches: string[];
}

/**
 * Kết luận đạt/chưa đạt chuẩn PAAST — do AI service tính (compute_verdict), KHÔNG theo ngưỡng
 * điểm tổng: điểm cao vẫn có thể do dồn hết vào vài lớp trong khi bỏ trắng hẳn 1 lớp khác.
 * Đạt khi cả 5 lớp đều có ít nhất 1 tiêu chí đạt. Riêng Prefer (patch v2.1): đòi ĐÚNG 1 insight
 * `primary` VÀ `coherence.is_coherent === true` — không còn chỉ ≥1 primary như bản trước.
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
  /** Optional: bản ghi/response cũ (trước patch v2.1) chấm trước khi AI service có score_band. */
  score_band?: PaastScoreBand;
  cta_warning: PaastCtaWarning;
  /** Optional: bản ghi/response cũ chấm trước khi AI service có compute_verdict không có field này. */
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

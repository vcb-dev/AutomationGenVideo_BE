/**
 * Tiêu chí chấm điểm kịch bản — lấy nguyên văn từ tài liệu nội bộ
 * "Content Creator & Editor Playbook" (BDC-VCB), mục 21.1 (Chấm kịch bản — 100 điểm)
 * và mục 22 (Hard Gate). Đây là nguồn sự thật duy nhất cho cấu trúc chấm điểm —
 * AI chỉ trả về passed/quote/suggestion cho từng tiêu chí, điểm số/verdict được
 * BE tính lại theo công thức của Playbook, không tin tưởng tuyệt đối phép cộng của AI.
 */

export interface ScoringItemDef {
  label: string;
}

export interface ScoringGroupDef {
  name: string;
  maxScore: number;
  items: ScoringItemDef[];
}

export const SCORING_CRITERIA: ScoringGroupDef[] = [
  {
    name: 'Chủ đề & Insight',
    maxScore: 15,
    items: [
      { label: 'Có một câu hỏi trung tâm rõ ràng' },
      { label: 'Có chi tiết đắt (chi tiết đáng chú ý)' },
      { label: 'Phù hợp tuyến và tệp người xem' },
    ],
  },
  {
    name: 'Source & độ đúng',
    maxScore: 20,
    items: [
      { label: 'Claim chính có nguồn/căn cứ từ input gốc' },
      { label: 'Con số được kiểm chứng, không bịa thêm so với input' },
      { label: 'Tên riêng/thuật ngữ kỹ thuật đúng, có trong input' },
    ],
  },
  {
    name: 'Hook & mở đầu',
    maxScore: 15,
    items: [
      { label: 'Có tính tò mò (khoảng trống thông tin)' },
      { label: 'Cụ thể (có đối tượng/chi tiết/con số)' },
      {
        label:
          'Đúng (được nội dung sau chứng minh, không có con số/mức độ nào trong hook mà thân bài không xác nhận)',
      },
      { label: 'Phù hợp tệp người xem' },
    ],
  },
  {
    name: 'Logic kể chuyện',
    maxScore: 15,
    items: [
      { label: 'Mạch rõ ràng, dễ theo dõi' },
      { label: 'Mỗi đoạn có vai trò riêng' },
      { label: 'Không liệt kê khô khan' },
      { label: 'Không vòng vo' },
    ],
  },
  {
    name: 'Phân tích & HuyK POV',
    maxScore: 20,
    items: [
      { label: 'Trả lời được "vì sao" (không chỉ "là gì")' },
      { label: 'Có lăng kính nghề cụ thể (kỹ thuật/thiết kế/thẩm mỹ/thương hiệu/người đeo...)' },
      {
        label:
          'Nhận định có căn cứ/dữ kiện đứng trước (không mở đầu bằng "Theo HuyK" rồi mới tìm lý do)',
      },
    ],
  },
  {
    name: 'Ngôn ngữ nói',
    maxScore: 10,
    items: [
      { label: 'Tự nhiên (giọng kể chuyện, không sách giáo khoa/quảng cáo)' },
      { label: 'Dễ hiểu' },
      { label: 'Đúng nhịp câu (8-18 từ là chính, xen câu 3-7 từ)' },
      { label: 'Không dồn thuật ngữ chuyên môn liên tiếp' },
    ],
  },
  {
    name: 'Câu đắt & CTA',
    maxScore: 5,
    items: [
      {
        label: 'Câu đắt được chứng minh bởi phần trước, không phải câu triết lý chung chung gắn tùy tiện',
      },
      { label: 'CTA chỉ có một mục tiêu duy nhất' },
    ],
  },
];

/** Tổng điểm tối đa — phải luôn bằng 100 (15+20+15+15+20+10+5). */
export const TOTAL_MAX_SCORE = SCORING_CRITERIA.reduce((sum, g) => sum + g.maxScore, 0);

/** 5 loại lỗi Hard Gate — Playbook mục 22. Kiểm tra riêng, KHÔNG cộng vào điểm 100. */
export const HARD_GATE_TYPES = [
  'Sai/thiếu nguồn',
  'Hook sai lời hứa',
  'Gán quan điểm giả',
  'Phong thủy tuyệt đối',
  'Công kích/phán xét',
] as const;

export type HardGateType = (typeof HARD_GATE_TYPES)[number];

/** Ngưỡng đánh giá — nguyên văn Playbook mục 21.3. */
export function computeVerdict(overallScore: number): string {
  if (overallScore >= 90) return 'Có thể đăng; xem xét lưu làm mẫu chuẩn';
  if (overallScore >= 80) return 'Đăng sau khi sửa lỗi nhỏ';
  if (overallScore >= 70) return 'Cần sửa có trọng tâm và duyệt lại';
  return 'Không đăng; quay lại bước insight/script/media';
}

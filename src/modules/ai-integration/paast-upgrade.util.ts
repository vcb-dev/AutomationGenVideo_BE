import {
  PaastAnalysisPayload,
  PaastMissingElement,
} from './interfaces/paast-analysis.interface';

/**
 * Thứ tự ưu tiên sửa khi nâng cấp content theo PAAST.
 *
 * Prefer đứng đầu vì đây là lớp quyết định người xem có "thích" bài hay không — sửa lớp này
 * thường kéo theo cả các lớp sau. Acknowledge và Trust đứng kế tiếp (thiếu thông tin nền và
 * thiếu độ tin cậy là loại lỗi nội dung, sửa được bằng cách viết thêm). Action xếp sau vì
 * phần lớn là kỹ thuật trình bày. Stick xếp cuối vì đa số tiêu chí của lớp này phụ thuộc
 * production (hình hiệu, đạo cụ, nhạc...), text sửa được rất ít.
 */
const LAYER_PRIORITY: string[] = ['prefer', 'acknowledge', 'trust', 'action', 'stick'];

const LAYER_LABEL: Record<string, string> = {
  prefer: 'Prefer (Thích) — CRAVES',
  action: 'Action (Hành động) — S-FACES',
  acknowledge: 'Acknowledge (Biết) — BRANDS',
  stick: 'Stick (Nhớ) — STICKS',
  trust: 'Trust (Tin) — TRUSTS',
};

/** Sắp các tiêu chí đang thiếu theo LAYER_PRIORITY để AI biết sửa gì trước. */
export function sortMissingByPriority(missing: PaastMissingElement[]): PaastMissingElement[] {
  return [...missing].sort(
    (a, b) => LAYER_PRIORITY.indexOf(a.layer) - LAYER_PRIORITY.indexOf(b.layer),
  );
}

/**
 * Dựng system prompt cho lần gọi AI "nâng cấp kịch bản".
 *
 * KHÔNG dùng endpoint /api/ai/paast/upgrade/ (dùng cho luồng PAAST Analyzer độc lập, xem các
 * method analyzeContent/upgradeAnalysis phía trên trong AiIntegrationService): endpoint đó viết
 * lại content theo giọng trung tính, trong khi kịch bản của Chuyển đổi nội dung BẮT BUỘC giữ
 * đúng giọng nhân vật (system_prompt riêng của từng Character). Nên vẫn đi qua đúng đường viết
 * kịch bản cũ (callAiService — endpoint transform-content), chỉ thay phần "sửa gì" bằng danh
 * sách tiêu chí PAAST đang thiếu.
 */
export function buildPaastUpgradeSystemPrompt(analysis: PaastAnalysisPayload, missing: PaastMissingElement[]): string {
  const lines: string[] = [
    'Bạn là biên tập viên kịch bản. Nhiệm vụ: SỬA NÂNG CẤP kịch bản hiện có, không viết lại từ đầu.',
    '',
    'NGUYÊN TẮC BẮT BUỘC:',
    '- Giữ nguyên giọng văn, nhân xưng và phong cách của nhân vật (mô tả ở phần NHÂN VẬT trong tin nhắn người dùng).',
    '- Giữ nguyên mọi nội dung đang đúng; chỉ bổ sung/chỉnh những chỗ cần thiết để khắc phục các điểm thiếu bên dưới.',
    '- Không bịa số liệu, không bịa nguồn, không gán quan điểm cho người khác.',
    '- Chỉ trả về kịch bản hoàn chỉnh sau khi sửa. Không giải thích, không thêm tiêu đề, không markdown.',
    '',
    // Mẫu số lấy từ `max` bản phân tích (5 lớp không đều: 25/25/20/15/15).
    `Điểm PAAST hiện tại: ${analysis.total_score}/100 (Prefer ${analysis.layers?.prefer?.score ?? 0}/${analysis.layers?.prefer?.max ?? 25}, ` +
      `Action ${analysis.layers?.action?.score ?? 0}/${analysis.layers?.action?.max ?? 25}, ` +
      `Acknowledge ${analysis.layers?.acknowledge?.score ?? 0}/${analysis.layers?.acknowledge?.max ?? 20}, ` +
      `Stick ${analysis.layers?.stick?.score ?? 0}/${analysis.layers?.stick?.max ?? 15}, ` +
      `Trust ${analysis.layers?.trust?.score ?? 0}/${analysis.layers?.trust?.max ?? 15}).`,
  ];

  // incoherent chặn Prefer=0 nhưng không nằm trong `missing` — phải nói riêng ở prompt.
  if (analysis.layers?.prefer?.coherence?.is_coherent === false) {
    lines.push(
      '',
      `LƯU Ý QUAN TRỌNG — Prefer đang bị chặn ở 0/${analysis.layers?.prefer?.max ?? 25} điểm vì nội dung ĐỔI TRỌNG TÂM giữa chừng ` +
        `(chưa hội tụ về 1 insight chủ đạo xuyên suốt): ${analysis.layers?.prefer?.coherence?.warning ?? ''}`.trim(),
      'Khi sửa, ưu tiên gọt bớt/điều chỉnh phần lệch hướng để cả bài quay về ĐÚNG 1 trọng tâm xuyên suốt từ hook đến payoff — không chỉ thêm câu mới.',
    );
  }

  const sorted = sortMissingByPriority(missing);
  if (sorted.length > 0) {
    lines.push('', 'CÁC ĐIỂM CẦN KHẮC PHỤC (đã xếp theo thứ tự ưu tiên, sửa từ trên xuống):');
    sorted.forEach((m, idx) => {
      const label = LAYER_LABEL[m.layer] || m.layer;
      lines.push(`${idx + 1}. [${label}] ${m.criterion}${m.suggestion ? ` — ${m.suggestion}` : ''}`);
    });
  }

  // Tiêu chí `na` (cần production: hình hiệu, đạo cụ, nhạc...) KHÔNG đưa vào danh sách sửa —
  // không thể khắc phục bằng cách viết thêm chữ, ép AI sửa chỉ tạo ra câu mô tả thừa.
  const ctaMatches = analysis.cta_warning?.matches || [];
  if (analysis.cta_warning?.detected && ctaMatches.length > 0) {
    lines.push(
      '',
      'CẢNH BÁO CTA LỆCH CHUẨN NEW MEDIA — thay các cụm ép hành vi thương mại sau bằng lời mời chia sẻ/lưu giữ giá trị',
      '(ví dụ: mời bình luận quan điểm, mời kể trải nghiệm, mời lưu lại để dùng sau, mời gửi cho người cần):',
      ...ctaMatches.map((m) => `- "${m}"`),
    );
  }

  return lines.join('\n');
}

/**
 * Dựng user prompt 3 phần cho lần gọi nâng cấp: kịch bản thô gốc, mô tả nhân vật, và kịch bản
 * hiện tại cần sửa. Dùng dấu phân cách rõ ràng để model không nhầm 3 khối với nhau.
 */
export function buildPaastUpgradeUserPrompt(
  inputText: string,
  characterSystemPrompt: string,
  currentOutputText: string,
): string {
  return [
    '=== KỊCH BẢN THÔ (đầu vào gốc) ===',
    inputText,
    '',
    '=== NHÂN VẬT (giọng văn bắt buộc giữ nguyên) ===',
    characterSystemPrompt,
    '',
    '=== KỊCH BẢN HIỆN TẠI (cần sửa nâng cấp) ===',
    currentOutputText,
  ].join('\n');
}

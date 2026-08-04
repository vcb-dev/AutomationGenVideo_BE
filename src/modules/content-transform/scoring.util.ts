import { HARD_GATE_TYPES, SCORING_CRITERIA, computeVerdict } from './config/scoring-criteria';
import {
  GroupStatus,
  HardGateViolation,
  RawAiScoreResponse,
  ScoreGroupResult,
  ScoreResult,
} from './interfaces/score-result.interface';

/**
 * Trạng thái 1 nhóm tiêu chí, tính từ tỷ lệ điểm đạt/tối đa (score luôn tỷ lệ đúng với số
 * tiêu chí đạt trong nhóm — xem buildScoreResult). Dùng chung cho cả nhóm vừa chấm mới
 * (buildScoreResult) và nhóm phục hồi từ bản ghi cũ đã lưu DB (normalizeStoredScoreResult).
 */
export function computeGroupStatus(score: number, maxScore: number): GroupStatus {
  if (maxScore <= 0) return 'good';
  const ratio = score / maxScore;
  if (ratio >= 1) return 'good';
  if (ratio >= 0.5) return 'warning';
  return 'error';
}

/** System prompt tĩnh cho lần gọi AI thứ 2 (giám khảo) — build 1 lần từ SCORING_CRITERIA. */
export const SCORING_SYSTEM_PROMPT = buildScoringSystemPrompt();

function buildScoringSystemPrompt(): string {
  const groupsText = SCORING_CRITERIA.map((g, i) => {
    const itemsText = g.items.map((it, j) => `   ${i + 1}.${j + 1}. ${it.label}`).join('\n');
    return `${i + 1}. ${g.name} (tối đa ${g.maxScore} điểm, ${g.items.length} ý):\n${itemsText}`;
  }).join('\n\n');

  const hardGateText = HARD_GATE_TYPES.map((t, i) => `${i + 1}. ${t}`).join('\n');

  return `Bạn là giám khảo chấm điểm kịch bản content theo đúng tiêu chí trong tài liệu nội bộ "Content Creator & Editor Playbook" (BDC-VCB), mục 21.1 (Chấm kịch bản — 100 điểm) và mục 22 (Hard Gate).

Nhiệm vụ DUY NHẤT của bạn là CHẤM ĐIỂM. TUYỆT ĐỐI KHÔNG viết lại, KHÔNG sửa, KHÔNG đề xuất phiên bản mới của kịch bản.

Tin nhắn tiếp theo sẽ gồm 3 phần:
1. KỊCH BẢN THÔ GỐC — input ban đầu của người dùng, dùng để đối chiếu sự thật/số liệu.
2. SYSTEM PROMPT NHÂN VẬT — văn phong/nguyên tắc nhân vật đang áp dụng, dùng để đánh giá có đúng văn phong không.
3. KỊCH BẢN KẾT QUẢ — kịch bản cần chấm điểm.

QUAN TRỌNG: mọi giá trị "quote" bạn trả về BẮT BUỘC phải copy NGUYÊN VĂN, chính xác từng ký tự, từ đúng phần KỊCH BẢN KẾT QUẢ (không copy từ input gốc, không diễn giải lại, không thêm/bớt dấu câu). Nếu không tìm được câu cụ thể để trích, để quote rỗng ("").

Chấm đúng 7 nhóm tiêu chí sau, đúng thứ tự, đúng số ý mỗi nhóm — với MỖI ý trả về passed (true/false), quote (câu trích minh hoạ, có thể rỗng), suggestion (gợi ý sửa ngắn gọn — CHỈ điền khi passed = false):

${groupsText}

Sau đó kiểm tra Hard Gate — liệt kê TOÀN BỘ vi phạm tìm được (có thể nhiều vi phạm cùng loại, liệt kê hết, không bỏ sót), mỗi vi phạm gồm type (đúng 1 trong 5 loại dưới đây), quote (trích nguyên văn từ KỊCH BẢN KẾT QUẢ), explanation (giải thích ngắn gọn):
${hardGateText}
Nếu không phát hiện vi phạm nào, trả về mảng rỗng.

CHỈ trả về DUY NHẤT một JSON hợp lệ theo đúng schema sau, không kèm markdown code fence (không dùng \`\`\`), không kèm bất kỳ chữ nào khác ngoài JSON:
{
  "groups": [ { "name": "<đúng tên nhóm>", "items": [ { "label": "<đúng label>", "passed": true, "quote": "...", "suggestion": "..." } ] } ],
  "hardGateViolations": [ { "type": "...", "quote": "...", "explanation": "..." } ]
}
Bạn KHÔNG cần tự tính score/maxScore/overallScore/verdict — hệ thống sẽ tự tính lại dựa trên passed của bạn. Chỉ cần chấm đúng passed/quote/suggestion cho từng ý, theo đúng thứ tự nhóm và đúng thứ tự ý trong nhóm như đã liệt kê ở trên.`;
}

/** Ghép 3 phần ngữ cảnh (input gốc, system prompt nhân vật, kịch bản kết quả) làm user message. */
export function buildContextPrompt(inputText: string, characterSystemPrompt: string, outputText: string): string {
  return `=== KỊCH BẢN THÔ GỐC ===
${inputText}

=== SYSTEM PROMPT NHÂN VẬT ===
${characterSystemPrompt}

=== KỊCH BẢN KẾT QUẢ (cần chấm điểm) ===
${outputText}`;
}

/** Bóc JSON khỏi response AI — chịu được trường hợp AI lỡ bọc trong ```json ... ```. */
export function extractJson(raw: string): any | null {
  if (!raw) return null;
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Validate 1 quote: chỉ giữ lại nếu là substring xuất hiện NGUYÊN VĂN trong outputText.
 * Không tự sửa/trim/chuẩn hoá quote để "cho khớp" — không khớp thì trả về rỗng.
 */
function validateQuote(quote: string | undefined, outputText: string): string {
  if (typeof quote !== 'string' || quote.length === 0) return '';
  return outputText.includes(quote) ? quote : '';
}

/**
 * Ghép JSON thô AI trả về vào đúng cấu trúc canonical (SCORING_CRITERIA), validate quote,
 * và tự tính lại score/overallScore/verdict — không tin tưởng phép tính của AI.
 */
export function buildScoreResult(rawAi: RawAiScoreResponse, outputText: string): ScoreResult {
  const aiGroups = Array.isArray(rawAi?.groups) ? rawAi.groups : [];

  const groups: ScoreGroupResult[] = SCORING_CRITERIA.map((groupDef, gIdx) => {
    // Ưu tiên match theo index, fallback match theo tên (phòng khi AI đổi thứ tự).
    const aiGroup =
      aiGroups[gIdx] && (!aiGroups[gIdx].name || aiGroups[gIdx].name!.trim() === groupDef.name)
        ? aiGroups[gIdx]
        : aiGroups.find((g) => g.name?.trim() === groupDef.name) || aiGroups[gIdx];

    const aiItems = Array.isArray(aiGroup?.items) ? aiGroup!.items! : [];

    const items = groupDef.items.map((itemDef, iIdx) => {
      const aiItem =
        aiItems[iIdx] && (!aiItems[iIdx].label || aiItems[iIdx].label!.trim() === itemDef.label)
          ? aiItems[iIdx]
          : aiItems.find((it) => it.label?.trim() === itemDef.label) || aiItems[iIdx];

      const passed = aiItem?.passed === true;
      const quote = validateQuote(aiItem?.quote, outputText);
      const suggestion = !passed && typeof aiItem?.suggestion === 'string' ? aiItem.suggestion.trim() : undefined;

      return {
        label: itemDef.label,
        passed,
        quote,
        ...(suggestion ? { suggestion } : {}),
      };
    });

    const passedCount = items.filter((it) => it.passed).length;
    const score = Math.round((passedCount / groupDef.items.length) * groupDef.maxScore);

    return {
      name: groupDef.name,
      maxScore: groupDef.maxScore,
      score,
      status: computeGroupStatus(score, groupDef.maxScore),
      items,
    };
  });

  const overallScore = groups.reduce((sum, g) => sum + g.score, 0);

  const hardGateViolations: HardGateViolation[] = Array.isArray(rawAi?.hardGateViolations)
    ? rawAi.hardGateViolations
        .filter((v) => v && typeof v.type === 'string' && v.type.trim().length > 0)
        .map((v) => ({
          type: v.type!.trim(),
          quote: validateQuote(v.quote, outputText),
          explanation: typeof v.explanation === 'string' ? v.explanation.trim() : '',
        }))
    : [];

  return {
    groups,
    overallScore,
    verdict: computeVerdict(overallScore),
    hardGateViolations,
  };
}

/**
 * Chuẩn hoá score_result thô đọc từ DB (bản ghi cũ, có thể được lưu trước khi field
 * groups[].status tồn tại) về đúng shape ScoreResult hiện hành — luôn TÍNH LẠI status từng
 * nhóm từ score/maxScore đã lưu sẵn (không tin vào status cũ nếu có, đảm bảo đồng nhất công
 * thức dù ngưỡng tính status có đổi trong tương lai). KHÔNG gọi AI, KHÔNG chấm điểm lại.
 * Trả về null nếu dữ liệu thô rỗng/không hợp lệ (record chưa từng được chấm điểm).
 */
export function normalizeStoredScoreResult(raw: any): ScoreResult | null {
  if (!raw || !Array.isArray(raw.groups)) return null;

  const groups: ScoreGroupResult[] = raw.groups.map((g: any) => {
    const score = typeof g?.score === 'number' ? g.score : 0;
    const maxScore = typeof g?.maxScore === 'number' ? g.maxScore : 0;
    const items = Array.isArray(g?.items)
      ? g.items.map((it: any) => ({
          label: typeof it?.label === 'string' ? it.label : '',
          passed: it?.passed === true,
          quote: typeof it?.quote === 'string' ? it.quote : '',
          ...(typeof it?.suggestion === 'string' && it.suggestion ? { suggestion: it.suggestion } : {}),
        }))
      : [];

    return {
      name: typeof g?.name === 'string' ? g.name : '',
      maxScore,
      score,
      status: computeGroupStatus(score, maxScore),
      items,
    };
  });

  const overallScore =
    typeof raw.overallScore === 'number' ? raw.overallScore : groups.reduce((sum, g) => sum + g.score, 0);

  const hardGateViolations: HardGateViolation[] = Array.isArray(raw.hardGateViolations)
    ? raw.hardGateViolations
        .filter((v: any) => v && typeof v.type === 'string' && v.type.trim().length > 0)
        .map((v: any) => ({
          type: v.type.trim(),
          quote: typeof v.quote === 'string' ? v.quote : '',
          explanation: typeof v.explanation === 'string' ? v.explanation : '',
        }))
    : [];

  return {
    groups,
    overallScore,
    verdict: typeof raw.verdict === 'string' ? raw.verdict : computeVerdict(overallScore),
    hardGateViolations,
  };
}

export function buildUpgradeSystemPrompt(
  hardGateViolations: HardGateViolation[],
  groups: ScoreGroupResult[],
): string {
  const hardGateText =
    hardGateViolations.length > 0
      ? hardGateViolations
          .map((v, i) => `${i + 1}. [${v.type}] "${v.quote || '(không xác định được câu trích)'}" — ${v.explanation}`)
          .join('\n')
      : '(không có vi phạm Hard Gate)';

  // Liệt kê TOÀN BỘ tiêu chí chưa đạt của TẤT CẢ 7 nhóm — không chỉ nhóm điểm thấp nhất,
  // để tránh bỏ sót tiêu chí failed nằm ở nhóm có điểm tổng cao hơn (đã xảy ra thực tế: nhóm
  // "Chủ đề & Insight" đạt 10/15 vẫn còn 1 ý failed, nhưng bị bỏ qua vì không phải nhóm thấp
  // nhất, khiến bản nâng cấp không hề sửa đúng ý đó dù prompt cũ tưởng là "đã liệt kê đủ").
  const groupsWithFailures = groups.filter((g) => g.items.some((it) => !it.passed));
  const failedItemsText =
    groupsWithFailures.length > 0
      ? groupsWithFailures
          .map((g) => {
            const failedItems = g.items.filter((it) => !it.passed);
            const itemsText = failedItems
              .map((it, i) => `   ${i + 1}. ${it.label}${it.suggestion ? ` — gợi ý: ${it.suggestion}` : ''}`)
              .join('\n');
            return `- Nhóm "${g.name}" (đang đạt ${g.score}/${g.maxScore} điểm):\n${itemsText}`;
          })
          .join('\n\n')
      : '(không có tiêu chí nào chưa đạt, chỉ cần trau chuốt thêm)';

  return `Bạn là biên tập viên sửa kịch bản content theo đúng system prompt/văn phong nhân vật được cung cấp trong tin nhắn tiếp theo (gồm kịch bản thô gốc, system prompt nhân vật, và kịch bản hiện tại cần sửa).

Nhiệm vụ: SỬA kịch bản hiện tại theo đúng thứ tự ưu tiên sau. KHÔNG viết lại toàn bộ nếu không cần thiết — GIỮ NGUYÊN các phần đã đạt tốt, chỉ sửa đúng chỗ cần sửa.

ƯU TIÊN 1 — khắc phục toàn bộ lỗi Hard Gate sau (bắt buộc sửa hết):
${hardGateText}

ƯU TIÊN 2 — khắc phục TOÀN BỘ các tiêu chí chưa đạt sau đây, thuộc nhiều nhóm khác nhau. PHẢI sửa HẾT từng mục, KHÔNG được bỏ sót bất kỳ mục nào dù nhóm đó đã có điểm tương đối cao:
${failedItemsText}

Chỉ trả về DUY NHẤT kịch bản đã sửa (văn nói liền mạch, không tiêu đề/markdown/giải thích thêm) — không kèm bất kỳ ghi chú, lời dẫn, hay đánh dấu nào khác ngoài chính nội dung kịch bản.`;
}

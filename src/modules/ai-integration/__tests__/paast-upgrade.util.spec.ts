import {
  sortMissingByPriority,
  buildPaastUpgradeSystemPrompt,
  buildPaastUpgradeUserPrompt,
} from '../paast-upgrade.util';
import { PaastAnalysisPayload, PaastMissingElement } from '../interfaces/paast-analysis.interface';

/**
 * Khung PAAST hợp nhất về AiIntegrationService (a57e9ba/a78e782/9ceba96/26a9af6) — nguồn tên
 * field duy nhất cho PAAST trong BE. Test này khoá 2 điều dễ vỡ nhất khi nâng cấp kịch bản:
 * (1) thứ tự ưu tiên sửa Prefer→Acknowledge→Trust→Action→Stick, sai thứ tự này khiến AI sửa
 * nhầm phần ít quan trọng trước; (2) cảnh báo CTA lệch chuẩn chỉ xuất hiện khi thật sự phát
 * hiện, không được thừa ra khi content sạch.
 */

function missing(layer: string, criterion = 'X', suggestion?: string): PaastMissingElement {
  return { layer, criterion, suggestion } as PaastMissingElement;
}

function basePayload(overrides: Partial<PaastAnalysisPayload> = {}): PaastAnalysisPayload {
  return {
    total_score: 60,
    layers: {
      prefer: { score: 12 },
      action: { score: 12 },
      acknowledge: { score: 12 },
      stick: { score: 12 },
      trust: { score: 12 },
    },
    cta_warning: { detected: false, matches: [] },
    ...overrides,
  } as PaastAnalysisPayload;
}

describe('sortMissingByPriority', () => {
  it('sắp đúng thứ tự Prefer → Acknowledge → Trust → Action → Stick', () => {
    const input = [
      missing('stick'),
      missing('action'),
      missing('trust'),
      missing('prefer'),
      missing('acknowledge'),
    ];

    const sorted = sortMissingByPriority(input);

    expect(sorted.map((m) => m.layer)).toEqual(['prefer', 'acknowledge', 'trust', 'action', 'stick']);
  });

  it('không sửa mảng gốc (trả bản sao)', () => {
    const input = [missing('stick'), missing('prefer')];
    const original = [...input];

    sortMissingByPriority(input);

    expect(input).toEqual(original);
  });

  it('nhiều phần tử cùng layer giữ nguyên thứ tự tương đối (sort ổn định)', () => {
    const input = [
      missing('action', 'A1'),
      missing('prefer', 'P1'),
      missing('action', 'A2'),
    ];

    const sorted = sortMissingByPriority(input);

    expect(sorted.map((m) => m.criterion)).toEqual(['P1', 'A1', 'A2']);
  });

  it('mảng rỗng trả mảng rỗng, không lỗi', () => {
    expect(sortMissingByPriority([])).toEqual([]);
  });
});

describe('buildPaastUpgradeSystemPrompt', () => {
  it('liệt kê điểm cần khắc phục ĐÃ SẮP theo priority, không theo thứ tự truyền vào', () => {
    const prompt = buildPaastUpgradeSystemPrompt(basePayload(), [
      missing('stick', 'SIGNATURE_FACE'),
      missing('prefer', 'CURIOSITY'),
    ]);

    const idxPrefer = prompt.indexOf('CURIOSITY');
    const idxStick = prompt.indexOf('SIGNATURE_FACE');
    expect(idxPrefer).toBeGreaterThan(-1);
    expect(idxStick).toBeGreaterThan(-1);
    expect(idxPrefer).toBeLessThan(idxStick);
  });

  it('không có gì thiếu thì không in mục "CÁC ĐIỂM CẦN KHẮC PHỤC"', () => {
    const prompt = buildPaastUpgradeSystemPrompt(basePayload(), []);

    expect(prompt).not.toContain('CÁC ĐIỂM CẦN KHẮC PHỤC');
  });

  it('cta_warning.detected=false thì KHÔNG in cảnh báo CTA dù matches có phần tử thừa', () => {
    const prompt = buildPaastUpgradeSystemPrompt(
      basePayload({ cta_warning: { detected: false, matches: ['mua ngay'] } as any }),
      [],
    );

    expect(prompt).not.toContain('CẢNH BÁO CTA');
  });

  it('cta_warning.detected=true kèm matches thì in đủ từng cụm bị cảnh báo', () => {
    const prompt = buildPaastUpgradeSystemPrompt(
      basePayload({ cta_warning: { detected: true, matches: ['mua ngay', 'chốt đơn liền'] } as any }),
      [],
    );

    expect(prompt).toContain('CẢNH BÁO CTA LỆCH CHUẨN NEW MEDIA');
    expect(prompt).toContain('"mua ngay"');
    expect(prompt).toContain('"chốt đơn liền"');
  });

  it('thiếu layers (undefined) thì hiện điểm 0 thay vì NaN/crash', () => {
    const prompt = buildPaastUpgradeSystemPrompt(basePayload({ layers: {} as any }), []);

    // Trọng số 5 lớp không đều (25/25/20/15/15) — mẫu số fallback theo default từng lớp.
    expect(prompt).toContain('Prefer 0/25');
    expect(prompt).toContain('Stick 0/15');
  });

  it('coherence.is_coherent=false thì in cảnh báo Prefer=0 kèm lý do — không có thì không in gì', () => {
    const withCoherenceFalse = buildPaastUpgradeSystemPrompt(
      basePayload({
        layers: {
          prefer: { score: 0, max: 25, coherence: { is_coherent: false, warning: 'Hook hứa hẹn A nhưng nửa sau lái sang B.' } },
          action: { score: 12 }, acknowledge: { score: 12 }, stick: { score: 12 }, trust: { score: 12 },
        } as any,
      }),
      [],
    );
    expect(withCoherenceFalse).toContain('LƯU Ý QUAN TRỌNG');
    expect(withCoherenceFalse).toContain('Hook hứa hẹn A nhưng nửa sau lái sang B.');

    const withCoherenceTrue = buildPaastUpgradeSystemPrompt(
      basePayload({
        layers: {
          prefer: { score: 25, max: 25, coherence: { is_coherent: true } },
          action: { score: 12 }, acknowledge: { score: 12 }, stick: { score: 12 }, trust: { score: 12 },
        } as any,
      }),
      [],
    );
    expect(withCoherenceTrue).not.toContain('LƯU Ý QUAN TRỌNG');
  });

  it('gợi ý (suggestion) đi kèm tiêu chí khi có, bỏ qua khi không có', () => {
    const prompt = buildPaastUpgradeSystemPrompt(basePayload(), [
      missing('prefer', 'CURIOSITY', 'thêm câu hỏi mở ở đầu'),
      missing('action', 'STOP'),
    ]);

    expect(prompt).toContain('CURIOSITY — thêm câu hỏi mở ở đầu');
    expect(prompt).toMatch(/STOP(?!\s*—)/);
  });
});

describe('buildPaastUpgradeUserPrompt', () => {
  it('ghép đủ 3 khối theo đúng thứ tự: thô gốc → nhân vật → kịch bản hiện tại', () => {
    const prompt = buildPaastUpgradeUserPrompt('kịch bản thô', 'giọng văn HuyK', 'bản hiện tại');

    const idxRaw = prompt.indexOf('kịch bản thô');
    const idxChar = prompt.indexOf('giọng văn HuyK');
    const idxCurrent = prompt.indexOf('bản hiện tại');
    expect(idxRaw).toBeLessThan(idxChar);
    expect(idxChar).toBeLessThan(idxCurrent);
  });

  it('có đủ 3 tiêu đề phân cách rõ ràng để model không nhầm khối', () => {
    const prompt = buildPaastUpgradeUserPrompt('a', 'b', 'c');

    expect(prompt).toContain('=== KỊCH BẢN THÔ (đầu vào gốc) ===');
    expect(prompt).toContain('=== NHÂN VẬT (giọng văn bắt buộc giữ nguyên) ===');
    expect(prompt).toContain('=== KỊCH BẢN HIỆN TẠI (cần sửa nâng cấp) ===');
  });
});

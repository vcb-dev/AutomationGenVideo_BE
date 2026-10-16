/**
 * Tạo ảnh sản phẩm — tiền của lượt tách nền ở tab Chi phí. Tách nền chạy model nhận diện tự huấn luyện
 * trên AI service nên thường 0đ, nhưng phần cộng tiền vẫn phải đúng cho mọi lượt CUTOUT có tiền.
 *
 * Khoá: tiền tách nền cộng vào tổng / theo ngày / theo người và hiện riêng ở `cutout_cost`, nhưng KHÔNG
 * làm lệch hai chỉ số của ảnh Gemini tạo ra (chi phí / lượt, chi phí / 1 ảnh đạt) và không thành
 * "lượt tạo"; lượt tách nền chưa biết tiền vẫn đếm vào "chưa tính được".
 */
import { GenerationRow, buildCostStats } from '../src/modules/product-image/product-image-cost.util';

const RATE = 26000;
const DAY = new Date('2026-10-08T03:00:00Z');

function row(partial: Partial<GenerationRow>): GenerationRow {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'user-1',
    mode: 'SCENE_PLACEMENT',
    status: 'SUCCESS',
    product_name: 'Túi Kelly xanh',
    model: 'gemini-3.1-flash-image',
    input_tokens: 2000,
    output_tokens: 1120,
    cost_usd: 0.0682,
    cost_note: null,
    error_message: null,
    approved_at: null,
    created_at: DAY,
    ...partial,
  };
}

const cutout = (partial: Partial<GenerationRow> = {}) =>
  row({ mode: 'CUTOUT', product_name: null, model: 'gemini-2.5-flash', input_tokens: 462, output_tokens: 96, cost_usd: 0.0004, ...partial });

const stats = (rows: GenerationRow[]) =>
  buildCostStats(rows, { rate: RATE, userNames: new Map([['user-1', 'Media']]), toDay: () => '2026-10-08', recentLimit: 10 });

describe('Tiền tách nền ở tab Chi phí', () => {
  const result = stats([
    row({ approved_at: DAY }),
    row({}),
    cutout(),
    cutout(),
    cutout({ status: 'FAILED', cost_usd: 0, cost_note: 'Tách nền chạy trên AI service (rembg + model tự huấn luyện) — không tính phí.' }),
  ]);

  it('tổng tiền gồm cả tạo ảnh lẫn tách nền; tiền tách nền hiện riêng', () => {
    expect(result.totals.cost_usd).toBeCloseTo(0.0682 * 2 + 0.0004 * 2, 6);
    expect(result.totals.cutout_cost.cost_usd).toBeCloseTo(0.0008, 6);
    expect(result.totals.cutout_cost.cost_vnd).toBe(Math.round(0.0008 * RATE));
    expect(result.totals).toMatchObject({ cutouts: 2, cutout_failed: 1 });
  });

  it('chi phí / lượt và / 1 ảnh đạt chỉ tính tiền Gemini tạo ảnh, tách nền không phải lượt tạo', () => {
    expect(result.totals.attempts).toBe(2);
    expect(result.totals.per_attempt?.cost_usd).toBeCloseTo(0.0682, 6);
    expect(result.totals.per_approved?.cost_usd).toBeCloseTo(0.0682 * 2, 6);
    expect(result.totals.per_approved?.attempts).toBe(2);
  });

  it('theo ngày và theo người có cả tiền tách nền; theo sản phẩm thì không (tách nền không có tên SP)', () => {
    expect(result.by_day[0].cost_usd).toBeCloseTo(0.0682 * 2 + 0.0008, 6);
    expect(result.by_user[0]).toMatchObject({ cutouts: 2, attempts: 2 });
    expect(result.by_user[0].cost_usd).toBeCloseTo(0.0682 * 2 + 0.0008, 6);
    expect(result.by_product).toHaveLength(1);
    expect(result.by_product[0].cost_usd).toBeCloseTo(0.0682 * 2, 6);
  });

  it('lượt tách nền chưa biết tiền (BE hết giờ chờ) đếm vào "chưa tính được", không ghi 0đ', () => {
    const unknown = stats([cutout({ status: 'FAILED', cost_usd: null, cost_note: 'BE hết thời gian chờ AI service' })]);
    expect(unknown.totals.unpriced).toBe(1);
    expect(unknown.unpriced_notes).toEqual([{ note: 'BE hết thời gian chờ AI service', count: 1 }]);
    expect(unknown.totals.cutout_cost.cost_usd).toBe(0);
  });
});

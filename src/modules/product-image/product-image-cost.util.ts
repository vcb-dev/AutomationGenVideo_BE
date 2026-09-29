import { InternalServerErrorException } from '@nestjs/common';

/**
 * Chi phí "Tạo ảnh sản phẩm": đọc khối `usage` AI service gửi về sau mỗi lượt, quy đổi VNĐ và
 * tổng hợp số liệu cho tab Chi phí. Thuần logic (không Prisma) để test được.
 *
 * Hai chỉ số chính lấy từ phương án tạo ảnh SP mới (mục 3–4):
 *  - số lượt tạo trung bình để ra 1 ảnh đạt = lượt tạo Gemini / số ảnh bấm "Đạt";
 *  - chi phí 1 ảnh đạt = tổng tiền Gemini / số ảnh đạt.
 */

export const PRODUCT_IMAGE_MODE = { CUTOUT: 'CUTOUT', HELD_PRODUCT: 'HELD_PRODUCT' } as const;
export type ProductImageMode = (typeof PRODUCT_IMAGE_MODE)[keyof typeof PRODUCT_IMAGE_MODE];

export const GENERATION_STATUS = { SUCCESS: 'SUCCESS', FAILED: 'FAILED' } as const;
export type GenerationStatus = (typeof GENERATION_STATUS)[keyof typeof GENERATION_STATUS];

/** Cùng biến tỷ giá với tab Chi phí Bộ sưu tập — BẮT BUỘC, không có giá trị mặc định. */
export const USD_VND_RATE_ENV = 'USD_VND_RATE';

const MISSING_RATE_MESSAGE =
  `Thiếu ${USD_VND_RATE_ENV} trong .env (tỷ giá quy đổi chi phí USD → VNĐ, số dương) — xem .env.example.`;

/** Tab Chi phí không có tỷ giá thì không hiện được tiền VNĐ → báo lỗi nêu tên biến. */
export function parseUsdVndRate(raw: string | undefined): number {
  const rate = Number(raw);
  if (!raw || !Number.isFinite(rate) || rate <= 0) {
    throw new InternalServerErrorException(MISSING_RATE_MESSAGE);
  }
  return rate;
}

/** Sau một lượt tạo ảnh: thiếu tỷ giá KHÔNG được làm hỏng lượt đó — chỉ chưa quy ra VNĐ được. */
export function tryParseUsdVndRate(raw: string | undefined): { rate: number | null; note: string | null } {
  try {
    return { rate: parseUsdVndRate(raw), note: null };
  } catch {
    return { rate: null, note: MISSING_RATE_MESSAGE };
  }
}

/** Khối `usage` AI service gửi kèm phản hồi held-product (xem product_image_cost.py). */
export interface AiUsage {
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number | null;
  cost_note?: string | null;
}

export interface GenerationCost {
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  /** null = chưa biết (thiếu đơn giá, hết thời gian chờ...) — lý do ở cost_note */
  cost_usd: number | null;
  cost_note: string | null;
}

const nonNegativeInt = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

/**
 * Khối usage → các cột chi phí của một lượt. Không có usage (AI sập giữa chừng, BE hết giờ chờ)
 * thì dùng `fallback` — bên gọi biết rõ hơn lượt đó có thể đã tốn tiền hay chưa.
 */
export function costFromAiUsage(
  usage: AiUsage | null | undefined,
  fallback: { cost_usd: number | null; cost_note: string },
): GenerationCost {
  if (!usage || typeof usage !== 'object') {
    return { model: null, input_tokens: 0, output_tokens: 0, ...fallback };
  }
  const cost = usage.cost_usd === null || usage.cost_usd === undefined ? null : Number(usage.cost_usd);
  const known = cost !== null && Number.isFinite(cost) && cost >= 0;
  return {
    model: typeof usage.model === 'string' && usage.model ? usage.model.slice(0, 100) : null,
    input_tokens: nonNegativeInt(usage.input_tokens),
    output_tokens: nonNegativeInt(usage.output_tokens),
    cost_usd: known ? cost : null,
    cost_note: typeof usage.cost_note === 'string' && usage.cost_note ? usage.cost_note.slice(0, 300) : null,
  };
}

// ─── Lỗi DB ────────────────────────────────────────────────────────────────

/** Mã lỗi Prisma "bảng không tồn tại" — gặp khi migration của bảng chưa được áp. */
const PRISMA_TABLE_MISSING = 'P2021';

/**
 * Lỗi DB khi đọc/ghi bảng product_image_generations → câu dễ hiểu cho người dùng. Chi tiết Prisma
 * (đường dẫn file, đoạn code, câu truy vấn) chỉ được ghi log, không đổ lên màn hình.
 */
export function generationsDbError(err: unknown): InternalServerErrorException {
  if ((err as { code?: string } | null)?.code === PRISMA_TABLE_MISSING) {
    return new InternalServerErrorException(
      'DB chưa có bảng product_image_generations — migration 20260929150000_add_product_image_generations ' +
        'chưa được áp (CI tự áp khi merge).',
    );
  }
  return new InternalServerErrorException('Không đọc/ghi được dữ liệu chi phí tạo ảnh trong DB, vui lòng thử lại.');
}

// ─── Chi phí của lượt thất bại ─────────────────────────────────────────────

const AI_USAGE = Symbol('productImageAiUsage');

/** Gắn khối usage vào lỗi ném ra từ lượt gọi AI, để nơi bắt lỗi vẫn ghi được chi phí lượt hỏng. */
export function attachAiUsage<E extends Error>(error: E, usage: AiUsage | null | undefined): E {
  if (usage) (error as any)[AI_USAGE] = usage;
  return error;
}

export function aiUsageOf(error: unknown): AiUsage | null {
  return ((error as any)?.[AI_USAGE] as AiUsage | undefined) ?? null;
}

/**
 * Usage của một lượt gọi AI bị lỗi axios. AI trả lỗi có kèm `usage` (Gemini đã chạy hoặc đã từ
 * chối) → dùng nguyên; BE hết giờ chờ → AI/Gemini có thể vẫn đang chạy nên CHƯA BIẾT tiền; không
 * kết nối được AI → chắc chắn chưa gọi Gemini, 0đ. Còn lại trả null để bên gọi tự quyết.
 */
export function usageFromAxiosError(err: any): AiUsage | null {
  const usage = err?.response?.data?.usage;
  if (usage && typeof usage === 'object') return usage;
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message ?? '')) {
    return { cost_usd: null, cost_note: 'BE hết thời gian chờ AI service — không biết Gemini đã tính phí lượt này chưa.' };
  }
  if (!err?.response && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err?.code)) {
    return { cost_usd: 0, cost_note: 'Không kết nối được AI service — chưa gọi Gemini, không tính phí.' };
  }
  return null;
}

/** Không có usage nào từ AI (lỗi lạ) — không khẳng định được lượt đó miễn phí. */
export const UNKNOWN_COST = {
  cost_usd: null,
  cost_note: 'AI service không báo số token/chi phí của lượt này.',
} as const;

/** Tách nền chạy rembg trên máy chủ công ty — không tốn phí API. */
export function freeCost(model: string | null | undefined): GenerationCost {
  return { model: model ? String(model).slice(0, 100) : null, input_tokens: 0, output_tokens: 0, cost_usd: 0, cost_note: null };
}

// ─── Thống kê ──────────────────────────────────────────────────────────────

export interface GenerationRow {
  id: string;
  user_id: string;
  mode: string;
  status: string;
  product_name: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_note: string | null;
  error_message: string | null;
  approved_at: Date | null;
  created_at: Date;
}

/**
 * Lượt Gemini được tính là "một lần tạo": có ảnh, hoặc đã tiêu token, hoặc chưa biết có tốn tiền
 * không. Lượt Gemini từ chối ngay (model 404, hết quota...) không tốn gì thì không tính — nếu
 * không, lỗi cấu hình sẽ làm phình "số lượt để ra 1 ảnh đạt".
 */
export function isGeminiAttempt(row: GenerationRow): boolean {
  if (row.mode !== PRODUCT_IMAGE_MODE.HELD_PRODUCT) return false;
  return (
    row.status === GENERATION_STATUS.SUCCESS ||
    row.input_tokens > 0 ||
    row.output_tokens > 0 ||
    row.cost_usd === null ||
    row.cost_usd > 0
  );
}

/** "  Nhẫn  Kim Vũ " và "nhẫn kim vũ" là một sản phẩm. */
export function productKey(name: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const UNNAMED_PRODUCT_LABEL = '(không ghi tên)';

export interface Money {
  cost_usd: number;
  cost_vnd: number;
}

interface Bucket {
  attempts: number;
  success: number;
  approved: number;
  cutouts: number;
  usd: number;
}

const emptyBucket = (): Bucket => ({ attempts: 0, success: 0, approved: 0, cutouts: 0, usd: 0 });

export function buildCostStats(
  rows: GenerationRow[],
  opts: { rate: number; userNames: Map<string, string>; toDay: (d: Date) => string; recentLimit: number },
) {
  const money = (usd: number): Money => ({
    cost_usd: Math.round(usd * 1e6) / 1e6,
    cost_vnd: Math.round(usd * opts.rate),
  });
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

  const total = emptyBucket();
  let failed = 0;
  let cutoutFailed = 0;
  let unpriced = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const byDay = new Map<string, Bucket>();
  const byProduct = new Map<string, Bucket & { label: string }>();
  const byUser = new Map<string, Bucket>();
  const unpricedNotes = new Map<string, number>();

  // rows đến theo created_at giảm dần → tên hiển thị của SP là tên gõ gần nhất.
  for (const row of rows) {
    const user = byUser.get(row.user_id) ?? emptyBucket();
    byUser.set(row.user_id, user);

    if (row.mode === PRODUCT_IMAGE_MODE.CUTOUT) {
      if (row.status === GENERATION_STATUS.SUCCESS) {
        total.cutouts += 1;
        user.cutouts += 1;
      } else {
        cutoutFailed += 1;
      }
      continue;
    }

    const usd = row.cost_usd ?? 0;
    const attempt = isGeminiAttempt(row);
    const success = row.status === GENERATION_STATUS.SUCCESS;
    const approved = success && row.approved_at !== null;
    if (!success) failed += 1;
    if (row.cost_usd === null) {
      unpriced += 1;
      const note = row.cost_note || 'Không rõ lý do';
      unpricedNotes.set(note, (unpricedNotes.get(note) ?? 0) + 1);
    }
    inputTokens += row.input_tokens;
    outputTokens += row.output_tokens;

    const key = productKey(row.product_name);
    const product = byProduct.get(key) ?? { ...emptyBucket(), label: row.product_name?.trim() || UNNAMED_PRODUCT_LABEL };
    byProduct.set(key, product);
    const day = byDay.get(opts.toDay(row.created_at)) ?? emptyBucket();
    byDay.set(opts.toDay(row.created_at), day);

    for (const bucket of [total, product, day, user]) {
      if (attempt) bucket.attempts += 1;
      if (success) bucket.success += 1;
      if (approved) bucket.approved += 1;
      bucket.usd += usd;
    }
  }

  const perApproved = (b: Bucket) =>
    b.approved > 0 ? { ...money(b.usd / b.approved), attempts: ratio(b.attempts, b.approved) } : null;

  return {
    pricing: {
      usd_vnd_rate: opts.rate,
      note:
        'Ước tính theo số token Gemini trả về × đơn giá model (GEMINI_IMAGE_PRICES_JSON trên AI service). ' +
        'Tách nền chạy trên máy chủ công ty, không tốn phí API.',
    },
    totals: {
      ...money(total.usd),
      attempts: total.attempts,
      success: total.success,
      failed,
      approved: total.approved,
      unpriced,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cutouts: total.cutouts,
      cutout_failed: cutoutFailed,
      per_attempt: total.attempts > 0 ? money(total.usd / total.attempts) : null,
      per_approved: perApproved(total),
    },
    by_day: [...byDay.entries()]
      .map(([date, b]) => ({ date, ...money(b.usd), attempts: b.attempts, approved: b.approved }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    by_product: [...byProduct.values()]
      .map((b) => ({
        product_name: b.label,
        attempts: b.attempts,
        success: b.success,
        approved: b.approved,
        ...money(b.usd),
        per_approved: perApproved(b),
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd || b.attempts - a.attempts),
    by_user: [...byUser.entries()]
      .map(([userId, b]) => ({
        user_id: userId,
        name: opts.userNames.get(userId) ?? 'Người dùng đã xoá',
        attempts: b.attempts,
        approved: b.approved,
        cutouts: b.cutouts,
        ...money(b.usd),
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd || b.attempts + b.cutouts - (a.attempts + a.cutouts)),
    unpriced_notes: [...unpricedNotes.entries()].map(([note, count]) => ({ note, count })),
    recent: rows.slice(0, opts.recentLimit).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      mode: row.mode,
      status: row.status,
      product_name: row.product_name,
      user_name: opts.userNames.get(row.user_id) ?? 'Người dùng đã xoá',
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cost_usd: row.cost_usd,
      cost_vnd: row.cost_usd === null ? null : Math.round(row.cost_usd * opts.rate),
      cost_note: row.cost_note,
      approved: row.approved_at !== null,
      error_message: row.error_message,
    })),
  };
}

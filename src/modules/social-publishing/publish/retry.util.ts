/**
 * Chính sách thử lại dùng chung cho các lời gọi API nền tảng.
 *
 * Trước đây cùng một khái niệm "thử lại" được chép tay ở bốn chỗ — ảnh carousel
 * Facebook, container Instagram, container Threads, ảnh bìa Facebook — mỗi bản
 * một cách giãn và một luật phân loại lỗi hơi khác nhau. Sửa chính sách phải
 * nhớ đủ bốn chỗ, sót một chỗ là hành vi lệch mà không ai thấy.
 */

/** Số lượt mặc định, giữ đúng con số các publisher đang dùng */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Lỗi có đáng thử lại không.
 *
 * Giữ nguyên luật cũ của các publisher: rate-limit (429), lỗi phía nền tảng
 * (5xx), hoặc không có status (timeout, đứt mạng). Lỗi 4xx khác là lỗi của
 * chính request nên thử lại chỉ tốn thời gian.
 */
export function isRetryableHttpError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  return !status || status === 429 || status >= 500;
}

/** Giãn tuyến tính 800ms, 1600ms… — đúng công thức các publisher đang dùng */
export function linearBackoff(attempt: number): number {
  return attempt * 800;
}

export type RetryOptions = {
  maxAttempts?: number;
  /** Trả false để dừng ngay, không thử tiếp */
  isRetryable?: (err: any) => boolean;
  /** Độ trễ trước lượt kế tiếp, tính theo số lượt đã thất bại (1-based) */
  delayMs?: (attempt: number) => number;
  /** Gọi trước mỗi lần thử lại — dùng để ghi log */
  onRetry?: (err: any, attempt: number, delayMs: number) => void;
};

/**
 * Chạy `fn`, thử lại khi lỗi còn đáng thử. Ném lỗi của lượt cuối cùng.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const isRetryable = opts.isRetryable ?? isRetryableHttpError;
  const delayMs = opts.delayMs ?? linearBackoff;

  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) break;

      const wait = delayMs(attempt);
      opts.onRetry?.(err, attempt, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

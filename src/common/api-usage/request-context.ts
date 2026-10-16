import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Ngữ cảnh của request đang chạy — để chốt ghi chi phí (api-usage-tracking) biết lượt gọi AI
 * do ai bấm, ở màn hình nào, mà không phải truyền tay qua từng module.
 *
 * AsyncLocalStorage giữ ngữ cảnh qua mọi `await` sinh ra từ request, kể cả việc chạy nền không
 * ai chờ (vd sinh kịch bản sau khi duyệt). Cron không đi qua request nên không có ngữ cảnh.
 */

/** Nhãn chi phí do code gắn thêm khi biết rõ hơn chốt chung (vd Bộ sưu tập: bước nào, content nào). */
export interface UsageTag {
  page?: string;
  feature?: string;
  userId?: string;
  videoId?: string;
  platform?: string;
  contentId?: string;
}

export interface UsageContext {
  req?: Request;
  tag?: UsageTag;
}

const storage = new AsyncLocalStorage<UsageContext>();

/** Gắn sớm nhất trong main.ts: mọi xử lý của request đều thấy được `req`. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ req }, next);
}

export function currentUsageContext(): UsageContext | undefined {
  return storage.getStore();
}

/** Chạy `fn` với nhãn chi phí gộp thêm vào ngữ cảnh hiện tại (dùng được cả ngoài request). */
export function runWithUsageTag<T>(tag: UsageTag, fn: () => T): T {
  const current = storage.getStore();
  return storage.run({ req: current?.req, tag: { ...current?.tag, ...tag } }, fn);
}

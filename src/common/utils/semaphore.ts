/**
 * Async counting semaphore — giới hạn số tác vụ nặng (ffmpeg, query DB, publish)
 * chạy đồng thời trong 1 process. KHÔNG phân tán đa-instance: mỗi instance giữ
 * giới hạn riêng (xem ghi chú concurrency ở schedule.service.ts).
 *
 * Dùng `run()` để tự acquire/release an toàn (release cả khi throw).
 * Dùng `tryRun()` khi muốn từ chối ngay thay vì xếp hàng (vd. endpoint sync).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max phải ≥ 1');
  }

  get inUse(): number { return this.active; }
  get queued(): number { return this.waiters.length; }
  get available(): number { return Math.max(0, this.max - this.active); }

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Chạy fn dưới semaphore — chờ slot nếu đầy. Release đảm bảo cả khi fn throw. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Thử chiếm slot NGAY (không xếp hàng). Nếu còn slot → chạy fn; nếu đầy → trả
   * { acquired: false } để caller tự quyết (vd. trả 429). Tránh giữ kết nối HTTP
   * chờ vô hạn rồi vẫn dính timeout 120s.
   */
  async tryRun<T>(fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }> {
    if (this.active >= this.max) return { acquired: false };
    this.active++;
    try {
      return { acquired: true, value: await fn() };
    } finally {
      this.release();
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

/**
 * In-memory TTL cache với stampede protection.
 *
 * Khi cache miss đồng thời (thundering herd):
 *  - Request đầu tiên tạo Promise và lưu vào `inFlight` Map.
 *  - Các request tiếp theo với cùng key CHỜ Promise đang chạy thay vì
 *    khởi động query mới → đảm bảo chỉ 1 fetchFn() chạy mỗi key.
 *
 * Usage: get(key, ttlMs, fetchFn)
 */
@Injectable()
export class CacheService {
    private store = new Map<string, CacheEntry<any>>();
    /** Tracks in-flight fetches to prevent thundering herd */
    private inFlight = new Map<string, Promise<any>>();

    async get<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
        // 1. Cache hit – return immediately
        const entry = this.store.get(key);
        if (entry && Date.now() < entry.expiresAt) {
            return entry.data as T;
        }

        // 2. In-flight hit – another request is already fetching, wait for it
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing as Promise<T>;
        }

        // 3. Cache miss – we are the first, kick off the fetch
        const fetchPromise = fetchFn()
            .then((data) => {
                this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
                return data;
            })
            .finally(() => {
                this.inFlight.delete(key);
            });

        this.inFlight.set(key, fetchPromise);
        return fetchPromise;
    }

    invalidate(prefix?: string) {
        if (!prefix) {
            this.store.clear();
            return;
        }
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }

    /** Evict expired entries every 10 minutes to prevent memory growth */
    @Cron('0 */10 * * * *')
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now >= entry.expiresAt) {
                this.store.delete(key);
            }
        }
    }
}

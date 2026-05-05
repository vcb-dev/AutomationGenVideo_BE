import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

interface MemEntry<T> {
    data: T;
    expiresAt: number;
}

/**
 * Pure in-memory TTL cache with thundering-herd (in-flight dedup) protection.
 * Optimized for high performance and zero external dependencies.
 */
@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);

    /** In-process memory store */
    private memStore = new Map<string, MemEntry<any>>();
    private static readonly MEM_MAX = 1000; 

    /** Tracks in-flight fetches to prevent thundering herd */
    private inFlight = new Map<string, Promise<any>>();

    constructor() {
        this.logger.log('CacheService initialized in In-Memory mode (Redis disabled).');
    }

    async get<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
        // 1. Cache hit
        const cached = this._read<T>(key);
        if (cached !== null) return cached;

        // 2. In-flight dedup
        const existing = this.inFlight.get(key);
        if (existing) return existing as Promise<T>;

        // 3. Miss — fetch once
        const fetchPromise = fetchFn()
            .then((data) => {
                this._write(key, data, ttlMs);
                return data;
            })
            .finally(() => this.inFlight.delete(key));

        this.inFlight.set(key, fetchPromise);
        return fetchPromise;
    }

    invalidate(prefix?: string) {
        if (!prefix) {
            this.memStore.clear();
            this.inFlight.clear();
            this.logger.log('Cache cleared entirely.');
            return;
        }
        
        for (const key of this.memStore.keys()) {
            if (key.startsWith(prefix)) this.memStore.delete(key);
        }
        for (const key of this.inFlight.keys()) {
            if (key.startsWith(prefix)) this.inFlight.delete(key);
        }
        this.logger.log(`Cache invalidated for prefix: ${prefix}`);
    }

    /** Evict expired mem entries once daily at 12:50 (VN time). */
    @Cron('0 50 12 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
    cleanup() {
        const now = Date.now();
        let expiredCount = 0;
        for (const [key, entry] of this.memStore.entries()) {
            if (now >= entry.expiresAt) {
                this.memStore.delete(key);
                expiredCount++;
            }
        }
        if (expiredCount > 0) {
            this.logger.log(`Cleanup: removed ${expiredCount} expired entries.`);
        }
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private _read<T>(key: string): T | null {
        const entry = this.memStore.get(key);
        if (entry && Date.now() < entry.expiresAt) return entry.data as T;
        if (entry) this.memStore.delete(key);
        return null;
    }

    private _write(key: string, data: any, ttlMs: number): void {
        this.memStore.set(key, { data, expiresAt: Date.now() + ttlMs });
        this._evictMem();
    }

    private _evictMem() {
        if (this.memStore.size <= CacheService.MEM_MAX) return;
        const overflow = this.memStore.size - CacheService.MEM_MAX;
        let removed = 0;
        
        // 1. Evict expired entries first
        const now = Date.now();
        for (const [key, entry] of this.memStore.entries()) {
            if (now >= entry.expiresAt) {
                this.memStore.delete(key);
                removed++;
                if (removed >= overflow) return;
            }
        }
        
        // 2. If still over limit, evict oldest entries (FIFO via Map keys order)
        for (const key of this.memStore.keys()) {
            this.memStore.delete(key);
            removed++;
            if (removed >= overflow) break;
        }
    }
}

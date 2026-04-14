import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';

interface MemEntry<T> {
    data: T;
    expiresAt: number;
}

/**
 * Redis-backed TTL cache with thundering-herd (in-flight dedup) protection.
 * Falls back to in-process Map when Redis is unavailable.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
    private readonly logger = new Logger(CacheService.name);
    private redis: Redis | null = null;
    private useRedis = false;

    /** Fallback in-memory store used when Redis is down */
    private memStore = new Map<string, MemEntry<any>>();
    private static readonly MEM_MAX = 500;

    /** Tracks in-flight fetches to prevent thundering herd (both redis + mem paths) */
    private inFlight = new Map<string, Promise<any>>();

    constructor() {
        const host = process.env.REDIS_HOST || '127.0.0.1';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        const url  = process.env.REDIS_URL;

        try {
            this.redis = url
                ? new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 })
                : new Redis({ host, port, lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });

            this.redis.on('connect', () => {
                this.useRedis = true;
                this.logger.log('Redis connected — using Redis cache');
            });
            this.redis.on('error', () => {
                if (this.useRedis) this.logger.warn('Redis error — falling back to in-memory cache');
                this.useRedis = false;
            });

            this.redis.connect().catch(() => {
                this.logger.warn('Redis not reachable at startup — using in-memory cache');
            });
        } catch {
            this.logger.warn('Redis init failed — using in-memory cache');
        }
    }

    async onModuleDestroy() {
        if (this.redis) await this.redis.quit().catch(() => {});
    }

    async get<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
        // 1. Cache hit
        const cached = await this._read<T>(key);
        if (cached !== null) return cached;

        // 2. In-flight dedup
        const existing = this.inFlight.get(key);
        if (existing) return existing as Promise<T>;

        // 3. Miss — fetch once
        const fetchPromise = fetchFn()
            .then(async (data) => {
                await this._write(key, data, ttlMs);
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
            if (this.useRedis && this.redis) {
                this.redis.keys('cache:*').then(keys => {
                    if (keys.length) this.redis!.del(...keys).catch(() => {});
                }).catch(() => {});
            }
            return;
        }
        // mem
        for (const key of this.memStore.keys()) {
            if (key.startsWith(prefix)) this.memStore.delete(key);
        }
        for (const key of this.inFlight.keys()) {
            if (key.startsWith(prefix)) this.inFlight.delete(key);
        }
        // redis
        if (this.useRedis && this.redis) {
            this.redis.keys(`cache:${prefix}*`).then(keys => {
                if (keys.length) this.redis!.del(...keys).catch(() => {});
            }).catch(() => {});
        }
    }

    /** Evict expired mem entries once daily at 12:50 (VN time). */
    @Cron('0 50 12 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.memStore.entries()) {
            if (now >= entry.expiresAt) this.memStore.delete(key);
        }
    }

    // ── private helpers ──────────────────────────────────────────────────────

    private async _read<T>(key: string): Promise<T | null> {
        if (this.useRedis && this.redis) {
            try {
                const val = await this.redis.get(`cache:${key}`);
                if (val) return JSON.parse(val) as T;
                return null;
            } catch {
                this.useRedis = false;
            }
        }
        // mem fallback
        const entry = this.memStore.get(key);
        if (entry && Date.now() < entry.expiresAt) return entry.data as T;
        if (entry) this.memStore.delete(key);
        return null;
    }

    private async _write(key: string, data: any, ttlMs: number): Promise<void> {
        if (this.useRedis && this.redis) {
            try {
                await this.redis.set(`cache:${key}`, JSON.stringify(data), 'PX', ttlMs);
                return;
            } catch {
                this.useRedis = false;
            }
        }
        // mem fallback
        this.memStore.set(key, { data, expiresAt: Date.now() + ttlMs });
        this._evictMem();
    }

    private _evictMem() {
        if (this.memStore.size <= CacheService.MEM_MAX) return;
        const overflow = this.memStore.size - CacheService.MEM_MAX;
        let removed = 0;
        // Prefer evicting already-expired entries first
        for (const [key, entry] of this.memStore.entries()) {
            if (Date.now() >= entry.expiresAt) {
                this.memStore.delete(key);
                removed++;
                if (removed >= overflow) return;
            }
        }
        // Then evict oldest
        for (const key of this.memStore.keys()) {
            this.memStore.delete(key);
            removed++;
            if (removed >= overflow) break;
        }
    }
}

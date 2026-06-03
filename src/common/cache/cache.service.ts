import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';

interface MemEntry<T> {
    data: T;
    expiresAt: number;
}

/**
 * High-performance TTL cache with Redis support and fallback to in-memory Map.
 * Protects against thundering herd with local in-flight request deduplication.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
    private readonly logger = new Logger(CacheService.name);
    private redisClient: Redis | null = null;
    private isRedisEnabled = false;

    /** In-process memory store */
    private memStore = new Map<string, MemEntry<any>>();
    private static readonly MEM_MAX = 1000; 

    /** Tracks in-flight fetches to prevent thundering herd */
    private inFlight = new Map<string, Promise<any>>();

    constructor() {
        const host = process.env.REDIS_HOST;
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        const password = process.env.REDIS_PASSWORD || undefined;
        const db = parseInt(process.env.REDIS_DB || '0', 10);

        if (host) {
            try {
                this.redisClient = new Redis({
                    host,
                    port,
                    password,
                    db,
                    maxRetriesPerRequest: 1,
                    retryStrategy: (times) => {
                        if (times > 3) {
                            this.logger.warn(`Redis connection failed ${times} times. Falling back to In-Memory mode.`);
                            this.isRedisEnabled = false;
                            return null; // Stop retrying
                        }
                        return Math.min(times * 100, 2000);
                    }
                });

                this.redisClient.on('connect', () => {
                    this.isRedisEnabled = true;
                    this.logger.log(`Redis connected successfully to ${host}:${port}`);
                });

                this.redisClient.on('error', (err) => {
                    // Suppress excessive error log if connection was already warned
                    if (this.isRedisEnabled) {
                        this.logger.error(`Redis connection error: ${err.message}`);
                    }
                    this.isRedisEnabled = false;
                });
            } catch (err: any) {
                this.logger.error(`Failed to initialize Redis client: ${err.message}`);
                this.isRedisEnabled = false;
            }
        } else {
            this.logger.log('CacheService initialized in In-Memory mode (Redis disabled).');
        }
    }

    async get<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
        // 1. Try Cache hit (Redis)
        if (this.isRedisEnabled && this.redisClient) {
            try {
                const cachedStr = await this.redisClient.get(key);
                if (cachedStr !== null) {
                    return JSON.parse(cachedStr) as T;
                }
            } catch (err: any) {
                this.logger.warn(`Redis get failed for key "${key}": ${err.message}. Falling back to memory.`);
            }
        }

        // Memory cache hit (used if Redis is disabled or as second-layer fallback)
        const cached = this._read<T>(key);
        if (cached !== null) return cached;

        // 2. In-flight request deduplication
        const existing = this.inFlight.get(key);
        if (existing) return existing as Promise<T>;

        // 3. Cache miss — fetch data once
        const fetchPromise = fetchFn()
            .then(async (data) => {
                // Write to Redis if enabled
                if (this.isRedisEnabled && this.redisClient) {
                    try {
                        const seconds = Math.max(1, Math.floor(ttlMs / 1000));
                        await this.redisClient.set(key, JSON.stringify(data), 'EX', seconds);
                    } catch (err: any) {
                        this.logger.warn(`Redis set failed for key "${key}": ${err.message}`);
                    }
                }
                // Write to memory cache
                this._write(key, data, ttlMs);
                return data;
            })
            .finally(() => this.inFlight.delete(key));

        this.inFlight.set(key, fetchPromise);
        return fetchPromise;
    }

    async invalidate(prefix?: string): Promise<void> {
        // 1. Invalidate Redis Cache
        if (this.isRedisEnabled && this.redisClient) {
            try {
                if (!prefix) {
                    await this.redisClient.flushdb();
                    this.logger.log('Redis cache cleared entirely.');
                } else {
                    const keys = await this.redisClient.keys(`${prefix}*`);
                    if (keys.length > 0) {
                        await this.redisClient.del(...keys);
                        this.logger.log(`Redis cache invalidated for prefix: ${prefix} (${keys.length} keys)`);
                    }
                }
            } catch (err: any) {
                this.logger.warn(`Redis invalidation failed: ${err.message}`);
            }
        }

        // 2. Invalidate Memory Cache
        if (!prefix) {
            this.memStore.clear();
            this.inFlight.clear();
            this.logger.log('Memory cache cleared entirely.');
            return;
        }
        
        for (const key of this.memStore.keys()) {
            if (key.startsWith(prefix)) this.memStore.delete(key);
        }
        for (const key of this.inFlight.keys()) {
            if (key.startsWith(prefix)) this.inFlight.delete(key);
        }
        this.logger.log(`Memory cache invalidated for prefix: ${prefix}`);
    }

    onModuleDestroy() {
        if (this.redisClient) {
            this.redisClient.disconnect();
            this.logger.log('Redis connection closed.');
        }
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
            this.logger.log(`Cleanup: removed ${expiredCount} expired memory entries.`);
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

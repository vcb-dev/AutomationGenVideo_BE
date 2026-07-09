import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { buildPrismaDbUrl, defaultPoolSizeForUrl } from "./build-prisma-db-url";

const MAX_CONNECT_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 3_000; // 3s → 6s → 12s → 24s → 48s

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly poolSize: number;
  private _reconnecting = false;

  /** Public flag: cron jobs MUST check this before issuing queries. */
  public isHealthy = false;

  /** Timestamp of last connection failure — used for backoff by callers. */
  public lastFailureAt = 0;

  constructor() {
    const rawUrl = process.env.DATABASE_URL || "";
    const url = buildPrismaDbUrl(rawUrl);
    const poolSize = defaultPoolSizeForUrl(rawUrl);

    super({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'development'
        ? [{ level: 'query', emit: 'event' }, { level: 'warn', emit: 'stdout' }]
        : [{ level: 'warn', emit: 'stdout' }],
    });

    this.poolSize = poolSize;

    // Trigger reconnect when the query engine panics (P1017 / "kind: Closed").
    // This prevents the entire server from going dark after a transient DB disconnect.
    this.$use(async (params, next) => {
      try {
        return await next(params);
      } catch (err: any) {
        if (
          err?.name === 'PrismaClientUnknownRequestError' &&
          typeof err?.message === 'string' &&
          err.message.includes('kind: Closed')
        ) {
          void this._scheduleReconnect();
        }
        throw err;
      }
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  /** Connect with exponential backoff — prevents circuit breaker activation on Supabase. */
  private async connectWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
      try {
        await this.$connect();
        this.isHealthy = true;
        this.lastFailureAt = 0;
        this.logger.log(`Prisma connected (pool: ${this.poolSize} connections, attempt ${attempt})`);
        return;
      } catch (err: any) {
        this.isHealthy = false;
        this.lastFailureAt = Date.now();
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Prisma connect attempt ${attempt}/${MAX_CONNECT_RETRIES} failed: ${err.message}. ` +
          `Retrying in ${delay / 1000}s...`,
        );
        if (attempt === MAX_CONNECT_RETRIES) {
          this.logger.error(
            `Prisma failed to connect after ${MAX_CONNECT_RETRIES} attempts. ` +
            `Server will start but DB queries will fail. A background reconnect will run.`,
          );
          // Schedule background reconnect instead of crashing the server
          this.markUnhealthy();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Mark connection as unhealthy and schedule reconnect. Called by middleware/interceptors on DB errors. */
  markUnhealthy(): void {
    if (!this.isHealthy && this._reconnecting) return;
    this.isHealthy = false;
    this.lastFailureAt = Date.now();
    void this._scheduleReconnect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async _scheduleReconnect(): Promise<void> {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.isHealthy = false;
    const RECONNECT_INTERVAL_MS = 30_000;
    try {
      this.logger.warn('Prisma engine connection closed — reconnecting...');
      await this.$disconnect();
      await this.$connect();
      this.isHealthy = true;
      this.lastFailureAt = 0;
      this.logger.log('Prisma reconnected successfully');
    } catch (err) {
      this.logger.error('Prisma reconnect failed', err);
      // Try again later
      setTimeout(() => {
        this._reconnecting = false;
        this.markUnhealthy();
      }, RECONNECT_INTERVAL_MS);
    } finally {
      this._reconnecting = false;
    }
  }
}

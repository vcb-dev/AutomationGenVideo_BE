import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { buildPrismaDbUrl, defaultPoolSizeForUrl } from "./build-prisma-db-url";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly poolSize: number;
  private _reconnecting = false;

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
    await this.$connect();
    this.logger.log(`Prisma connected (pool: ${this.poolSize} connections)`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async _scheduleReconnect(): Promise<void> {
    if (this._reconnecting) return;
    this._reconnecting = true;
    try {
      this.logger.warn('Prisma engine connection closed — reconnecting...');
      await this.$disconnect();
      await this.$connect();
      this.logger.log('Prisma reconnected successfully');
    } catch (err) {
      this.logger.error('Prisma reconnect failed', err);
    } finally {
      this._reconnecting = false;
    }
  }
}

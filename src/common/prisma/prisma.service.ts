import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { buildPrismaDbUrl, defaultPoolSizeForUrl } from "./build-prisma-db-url";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly poolSize: number;

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
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`Prisma connected (pool: ${this.poolSize} connections)`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

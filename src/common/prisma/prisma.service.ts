import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || '50', 10);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          // 50 connections: 100 users × ~0.3 avg concurrent queries + Lark background sync.
          // pool_timeout 30s: generous queue wait so requests don't fail under burst.
          url: process.env.DATABASE_URL + (
            process.env.DATABASE_URL?.includes('?') ?
            `&connection_limit=${POOL_SIZE}&pool_timeout=30&connect_timeout=10` :
            `?connection_limit=${POOL_SIZE}&pool_timeout=30&connect_timeout=10`
          ),
        }
      },
      log: process.env.NODE_ENV === 'development'
        ? [{ level: 'query', emit: 'event' }, { level: 'warn', emit: 'stdout' }]
        : [{ level: 'warn', emit: 'stdout' }],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`Prisma connected (pool: ${POOL_SIZE} connections)`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

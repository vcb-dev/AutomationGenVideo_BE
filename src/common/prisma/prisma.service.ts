import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

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
          // connection_limit: số connections tối đa trong pool.
          // Với 50-100 users đồng thời và ~8 parallel queries/request,
          // cần pool đủ lớn để không xếp hàng. 20 là cân bằng tốt.
          // pool_timeout: thời gian chờ lấy connection từ pool (giây).
          url: process.env.DATABASE_URL + (
            process.env.DATABASE_URL?.includes('?') ?
            '&connection_limit=20&pool_timeout=20&connect_timeout=10' :
            '?connection_limit=20&pool_timeout=20&connect_timeout=10'
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
    this.logger.log('Prisma connected (pool: 20 connections)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

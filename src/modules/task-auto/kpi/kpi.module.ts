import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { PublishedLinksModule } from '../published-links/published-links.module'
import { TaskAutoKpiService } from './kpi.service'
import { TaskAutoKpiController } from './kpi.controller'

@Module({
  imports: [PrismaModule, PublishedLinksModule],
  controllers: [TaskAutoKpiController],
  providers: [TaskAutoKpiService],
})
export class KpiModule {}

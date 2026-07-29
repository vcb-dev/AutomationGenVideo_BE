import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TaskAutoKpiService } from './kpi.service'
import { TaskAutoKpiController } from './kpi.controller'

@Module({
  imports: [PrismaModule],
  controllers: [TaskAutoKpiController],
  providers: [TaskAutoKpiService],
})
export class KpiModule {}

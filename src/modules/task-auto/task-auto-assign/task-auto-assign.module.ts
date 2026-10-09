import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { DailyPlansModule } from '../daily-plans/daily-plans.module'
import { KpiModule } from '../kpi/kpi.module'
import { TaskAutoAssignService } from './task-auto-assign.service'

@Module({
  imports: [PrismaModule, DailyPlansModule, KpiModule],
  providers: [TaskAutoAssignService],
  exports: [TaskAutoAssignService],
})
export class TaskAutoAssignModule {}

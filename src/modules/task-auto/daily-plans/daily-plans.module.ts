import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { ScraperAggregateModule } from '../../scraper-aggregate/scraper-aggregate.module'
import { TasksModule } from '../tasks/tasks.module'
import { DailyPlanBuilderService } from './daily-plan-builder.service'
import { DailyPlansController } from './daily-plans.controller'
import { DailyPlansService } from './daily-plans.service'

@Module({
  imports: [PrismaModule, TasksModule, ScraperAggregateModule],
  controllers: [DailyPlansController],
  providers: [DailyPlansService, DailyPlanBuilderService],
  exports: [DailyPlanBuilderService],
})
export class DailyPlansModule {}

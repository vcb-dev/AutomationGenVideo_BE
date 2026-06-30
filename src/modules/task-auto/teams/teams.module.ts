import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TasksModule } from '../tasks/tasks.module'
import { TaskAutoTeamsService } from './teams.service'
import { TaskAutoTeamsController } from './teams.controller'
import { ScaleDataSourceGuard } from '../../../common/guards/scale-data-source.guard'

@Module({
  imports: [PrismaModule, TasksModule],
  controllers: [TaskAutoTeamsController],
  providers: [TaskAutoTeamsService, ScaleDataSourceGuard],
})
export class TeamsModule {}

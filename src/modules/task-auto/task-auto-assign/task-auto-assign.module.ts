import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TaskAutoAssignService } from './task-auto-assign.service'

@Module({
  imports: [PrismaModule],
  providers: [TaskAutoAssignService],
  exports: [TaskAutoAssignService],
})
export class TaskAutoAssignModule {}

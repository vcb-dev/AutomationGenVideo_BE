import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TaskExportController } from './task-export.controller'
import { TaskExportService } from './task-export.service'

@Module({
  imports: [PrismaModule],
  controllers: [TaskExportController],
  providers: [TaskExportService],
})
export class TaskExportModule {}

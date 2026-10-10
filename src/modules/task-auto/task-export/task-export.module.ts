import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { FacebookOwnedPagesModule } from '../../facebook-owned-pages/facebook-owned-pages.module'
import { TaskExportController } from './task-export.controller'
import { TaskExportService } from './task-export.service'

@Module({
  imports: [PrismaModule, FacebookOwnedPagesModule],
  controllers: [TaskExportController],
  providers: [TaskExportService],
})
export class TaskExportModule {}

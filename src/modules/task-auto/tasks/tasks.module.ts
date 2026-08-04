import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { VideoModule } from '../video/video.module'
import { FacebookOwnedPagesModule } from '../../facebook-owned-pages/facebook-owned-pages.module'
import { TaskAutoTasksService } from './tasks.service'
import { TaskAutoTasksController } from './tasks.controller'
import { VideoScriptService } from './video-script.service'
import { ContentApprovalService } from './content-approval.service'
import { TaskPublishedLinkStatsService } from './task-published-link-stats.service'

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    FacebookOwnedPagesModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [TaskAutoTasksController],
  providers: [TaskAutoTasksService, VideoScriptService, ContentApprovalService, TaskPublishedLinkStatsService],
  exports: [TaskAutoTasksService],
})
export class TasksModule {}

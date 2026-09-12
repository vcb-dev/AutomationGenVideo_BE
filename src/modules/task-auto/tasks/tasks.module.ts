import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { VideoModule } from '../video/video.module'
import { FacebookOwnedPagesModule } from '../../facebook-owned-pages/facebook-owned-pages.module'
import { InstagramOwnedAccountsModule } from '../../instagram-owned-accounts/instagram-owned-accounts.module'
import { TaskAutoTasksService } from './tasks.service'
import { TaskAutoTasksController } from './tasks.controller'
import { VideoScriptService } from './video-script.service'
import { ContentApprovalService } from './content-approval.service'
import { TaskPublishedLinkStatsService } from './task-published-link-stats.service'
import { YoutubeVideoStatsService } from './youtube-video-stats.service'
import { TaskVideoMatchService } from './task-video-match.service'
import { TaskVideoMatchCronService } from './task-video-match.cron'
import { TaskAutoContentWinPushService } from './content-win-auto-push.service'

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    FacebookOwnedPagesModule,
    InstagramOwnedAccountsModule,
  ],
  controllers: [TaskAutoTasksController],
  providers: [TaskAutoTasksService, VideoScriptService, ContentApprovalService, TaskPublishedLinkStatsService, YoutubeVideoStatsService, TaskVideoMatchService, TaskVideoMatchCronService, TaskAutoContentWinPushService],
  exports: [TaskAutoTasksService],
})
export class TasksModule {}

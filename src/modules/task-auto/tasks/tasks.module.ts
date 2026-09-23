import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
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
import { LarkWebhookNotifyService } from './lark-webhook-notify.service'
import { SapoIntegrationModule } from '../../sapo-integration/sapo-integration.module'

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    FacebookOwnedPagesModule,
    InstagramOwnedAccountsModule,
    SapoIntegrationModule,
    // timeout riêng cho LarkWebhookNotifyService — bắn thông báo không chờ user, nhưng không
    // set timeout thì 1 webhook URL treo (DNS/TLS không phản hồi) sẽ giữ request/socket vô thời hạn.
    HttpModule.register({ timeout: 10000 }),
  ],
  controllers: [TaskAutoTasksController],
  providers: [TaskAutoTasksService, VideoScriptService, ContentApprovalService, TaskPublishedLinkStatsService, YoutubeVideoStatsService, TaskVideoMatchService, TaskVideoMatchCronService, TaskAutoContentWinPushService, LarkWebhookNotifyService],
  exports: [TaskAutoTasksService, LarkWebhookNotifyService],
})
export class TasksModule {}

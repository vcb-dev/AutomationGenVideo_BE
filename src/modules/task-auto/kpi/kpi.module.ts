import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { FacebookOwnedPagesModule } from '../../facebook-owned-pages/facebook-owned-pages.module'
import { InstagramOwnedAccountsModule } from '../../instagram-owned-accounts/instagram-owned-accounts.module'
import { TaskAutoKpiService } from './kpi.service'
import { TaskAutoKpiController } from './kpi.controller'
import { TaskPublishedLinkStatsService } from '../tasks/task-published-link-stats.service'
import { YoutubeVideoStatsService } from '../tasks/youtube-video-stats.service'
import { TaskAutoContentWinPushService } from '../tasks/content-win-auto-push.service'

@Module({
  imports: [PrismaModule, FacebookOwnedPagesModule, InstagramOwnedAccountsModule],
  controllers: [TaskAutoKpiController],
  // TaskPublishedLinkStatsService (+ Youtube/ContentWinPush) cần cho refreshContentWinFailStats().
  // Provide lại ở đây thay vì import TasksModule để tránh phụ thuộc chéo — không giữ state nên
  // an toàn khi có 2 instance độc lập.
  providers: [TaskAutoKpiService, TaskPublishedLinkStatsService, YoutubeVideoStatsService, TaskAutoContentWinPushService],
})
export class KpiModule {}

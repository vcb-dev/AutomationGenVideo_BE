import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { FacebookOwnedPagesModule } from '../../facebook-owned-pages/facebook-owned-pages.module'
import { InstagramOwnedAccountsModule } from '../../instagram-owned-accounts/instagram-owned-accounts.module'
import { TaskAutoContentWinPushService } from './content-win-auto-push.service'
import { TaskPublishedLinkStatsService } from './task-published-link-stats.service'
import { YoutubeVideoStatsService } from './youtube-video-stats.service'

@Module({
  imports: [
    PrismaModule,
    FacebookOwnedPagesModule,
    InstagramOwnedAccountsModule,
  ],
  providers: [
    TaskPublishedLinkStatsService,
    YoutubeVideoStatsService,
    TaskAutoContentWinPushService,
  ],
  exports: [
    TaskPublishedLinkStatsService,
    YoutubeVideoStatsService,
    TaskAutoContentWinPushService,
  ],
})
export class PublishedLinksModule {}

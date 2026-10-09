import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { VideoModule } from '../video/video.module'
import { SapoIntegrationModule } from '../../sapo-integration/sapo-integration.module'
import { ContentApprovalModule } from '../content-approval/content-approval.module'
import { PublishedLinksModule } from '../published-links/published-links.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TaskAutoTasksController } from './tasks.controller'
import { TaskAutoTasksService } from './tasks.service'

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    PublishedLinksModule,
    NotificationsModule,
    ContentApprovalModule,
    SapoIntegrationModule,
  ],
  controllers: [TaskAutoTasksController],
  providers: [TaskAutoTasksService],
  exports: [TaskAutoTasksService],
})
export class TasksModule {}

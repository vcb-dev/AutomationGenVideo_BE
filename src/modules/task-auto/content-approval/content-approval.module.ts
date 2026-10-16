import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { ContentApprovalController } from './content-approval.controller'
import { ContentApprovalService } from './content-approval.service'

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ContentApprovalController],
  providers: [ContentApprovalService],
  exports: [ContentApprovalService],
})
export class ContentApprovalModule {}

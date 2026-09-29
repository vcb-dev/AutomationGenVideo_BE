import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { LarkNotificationsModule } from '../lark-notifications/lark-notifications.module'
import { ContentApprovalController } from './content-approval.controller'
import { ContentApprovalService } from './content-approval.service'

@Module({
  imports: [PrismaModule, LarkNotificationsModule],
  controllers: [ContentApprovalController],
  providers: [ContentApprovalService],
  exports: [ContentApprovalService],
})
export class ContentApprovalModule {}

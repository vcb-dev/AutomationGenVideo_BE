import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { PublishedLinksModule } from '../published-links/published-links.module'
import { TaskVideoMatchCronService } from './task-video-match.cron'
import { TaskVideoMatchService } from './task-video-match.service'
import { VideoMatchingController } from './video-matching.controller'

@Module({
  imports: [PrismaModule, PublishedLinksModule],
  controllers: [VideoMatchingController],
  providers: [TaskVideoMatchService, TaskVideoMatchCronService],
})
export class VideoMatchingModule {}

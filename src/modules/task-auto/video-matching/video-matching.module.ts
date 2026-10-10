import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { PublishedLinksModule } from '../published-links/published-links.module'
import { TaskVideoMatchCronService } from './task-video-match.cron'
import { TaskVideoMatchAiClient, TaskVideoMatchService } from './task-video-match.service'
import { VideoMatchingController } from './video-matching.controller'

@Module({
  imports: [PrismaModule, PublishedLinksModule, HttpModule],
  controllers: [VideoMatchingController],
  providers: [TaskVideoMatchService, TaskVideoMatchCronService, TaskVideoMatchAiClient],
})
export class VideoMatchingModule {}

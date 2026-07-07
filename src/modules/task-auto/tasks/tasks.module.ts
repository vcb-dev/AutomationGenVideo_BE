import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { VideoModule } from '../video/video.module'
import { TaskAutoTasksService } from './tasks.service'
import { TaskAutoTasksController } from './tasks.controller'
import { VideoScriptService } from './video-script.service'

@Module({
  imports: [
    PrismaModule,
    VideoModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [TaskAutoTasksController],
  providers: [TaskAutoTasksService, VideoScriptService],
  exports: [TaskAutoTasksService],
})
export class TasksModule {}

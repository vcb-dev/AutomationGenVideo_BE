import { Module } from '@nestjs/common'
import { VideoModule } from '../video/video.module'
import { TaskAutoUploadController } from './upload.controller'

@Module({
  imports: [VideoModule],
  controllers: [TaskAutoUploadController],
})
export class UploadModule {}

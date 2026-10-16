import { Module } from '@nestjs/common'
import { PrismaModule } from '../../../common/prisma/prisma.module'
import { TaskAutoVideoService } from './video.service'
import { GoogleDriveStorageService } from '../../social-publishing/upload/google-drive-storage.service'
import { UploadService } from '../../social-publishing/upload/upload.service'
import { MediaLibraryService } from '../../social-publishing/upload/media-library.service'
import { TaskAutoVideoController } from './video.controller'

@Module({
  imports: [PrismaModule],
  controllers: [TaskAutoVideoController],
  providers: [
    TaskAutoVideoService,
    GoogleDriveStorageService,
    UploadService,
    MediaLibraryService,
  ],
  exports: [TaskAutoVideoService, GoogleDriveStorageService],
})
export class VideoModule {}

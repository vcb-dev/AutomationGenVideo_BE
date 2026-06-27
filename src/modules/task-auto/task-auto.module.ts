import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { PrismaModule } from '../../common/prisma/prisma.module'
import { TaskAutoController } from './task-auto.controller'
import { TaskAutoTasksService } from './task-auto-tasks.service'
import { TaskAutoTeamsService } from './task-auto-teams.service'
import { TaskAutoCatalogService } from './task-auto-catalog.service'
import { TaskAutoKpiService } from './task-auto-kpi.service'
import { TaskAutoAssignService } from './task-auto-assign/task-auto-assign.service'
import { TaskAutoVideoService } from './task-auto-video.service'
import { TaskAutoWarehouseService } from './task-auto-warehouse.service'
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service'
import { UploadService } from '../social-publishing/upload/upload.service'
import { MediaLibraryService } from '../social-publishing/upload/media-library.service'

@Module({
  imports: [
    PrismaModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [TaskAutoController],
  providers: [
    TaskAutoTasksService,
    TaskAutoTeamsService,
    TaskAutoCatalogService,
    TaskAutoKpiService,
    TaskAutoAssignService,
    TaskAutoVideoService,
    TaskAutoWarehouseService,
    GoogleDriveStorageService,
    UploadService,
    MediaLibraryService,
  ],
  exports: [TaskAutoAssignService],
})
export class TaskAutoModule {}

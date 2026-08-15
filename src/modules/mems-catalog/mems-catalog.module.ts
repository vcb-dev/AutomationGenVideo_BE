import { Module } from '@nestjs/common';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';
import { MemsCatalogController } from './mems-catalog.controller';
import { AssetPhotoService } from './asset-photo.service';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

@Module({
  controllers: [MemsCatalogController],
  providers: [MemsCatalogService, InspectionService, AssetPhotoService, GoogleDriveStorageService],
  exports: [MemsCatalogService],
})
export class MemsCatalogModule {}

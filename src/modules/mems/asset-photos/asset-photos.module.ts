import { Module } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../../common/mems/photo-url-signer.service';
import { GoogleDriveStorageService } from '../../social-publishing/upload/google-drive-storage.service';
import { AssetPhotoService } from './asset-photos.service';
import { MemsAssetPhotosController } from './asset-photos.controller';

@Module({
  controllers: [MemsAssetPhotosController],
  providers: [AssetPhotoService, GoogleDriveStorageService, MemsPhotoUrlSigner],
})
export class MemsAssetPhotosModule {}

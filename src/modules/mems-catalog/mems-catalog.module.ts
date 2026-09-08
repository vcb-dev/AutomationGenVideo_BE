import { Module } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../common/mems/photo-url-signer.service';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';
import { MemsCatalogController } from './mems-catalog.controller';
import { AssetPhotoService } from './asset-photo.service';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

@Module({
  controllers: [MemsCatalogController],
  providers: [
    MemsCatalogService,
    InspectionService,
    AssetPhotoService,
    GoogleDriveStorageService,
    // Ký và kiểm token của URL ảnh. Route phục vụ ảnh buộc phải công khai (thẻ <img> không gửi
    // được header Authorization), nên chữ ký này là cửa canh duy nhất còn lại ở đó.
    MemsPhotoUrlSigner,
  ],
  exports: [MemsCatalogService],
})
export class MemsCatalogModule {}

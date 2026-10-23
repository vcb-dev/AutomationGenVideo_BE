import { Module } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../common/mems/photo-url-signer.service';
import { MemsCatalogController } from './mems-catalog.controller';
import { MemsCatalogService } from './mems-catalog.service';

@Module({
  controllers: [MemsCatalogController],
  providers: [MemsCatalogService, MemsPhotoUrlSigner],
  exports: [MemsCatalogService],
})
export class MemsCatalogModule {}

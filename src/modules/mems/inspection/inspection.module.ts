import { Module } from '@nestjs/common';
import { MemsPhotoUrlSigner } from '../../../common/mems/photo-url-signer.service';
import { MemsInspectionController } from './inspection.controller';
import { InspectionService } from './inspection.service';

@Module({
  controllers: [MemsInspectionController],
  providers: [InspectionService, MemsPhotoUrlSigner],
})
export class MemsInspectionModule {}

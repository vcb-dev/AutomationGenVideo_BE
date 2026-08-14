import { Module } from '@nestjs/common';
import { MemsCatalogController } from './mems-catalog.controller';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

@Module({
  controllers: [MemsCatalogController],
  providers: [MemsCatalogService, InspectionService],
  exports: [MemsCatalogService],
})
export class MemsCatalogModule {}

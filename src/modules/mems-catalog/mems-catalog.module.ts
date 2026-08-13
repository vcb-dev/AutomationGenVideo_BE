import { Module } from '@nestjs/common';
import { MemsCatalogController } from './mems-catalog.controller';
import { MemsCatalogService } from './mems-catalog.service';

@Module({
  controllers: [MemsCatalogController],
  providers: [MemsCatalogService],
  exports: [MemsCatalogService],
})
export class MemsCatalogModule {}

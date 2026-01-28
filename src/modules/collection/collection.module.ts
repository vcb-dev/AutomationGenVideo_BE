import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [CollectionController],
  providers: [CollectionService],
  exports: [CollectionService],
})
export class CollectionModule {}

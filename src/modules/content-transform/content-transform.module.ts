import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ContentTransformController } from './content-transform.controller';
import { ContentTransformService } from './content-transform.service';

@Module({
  imports: [HttpModule],
  controllers: [ContentTransformController],
  providers: [ContentTransformService],
  exports: [ContentTransformService],
})
export class ContentTransformModule {}

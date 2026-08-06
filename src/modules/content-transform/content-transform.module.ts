import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ContentTransformController } from './content-transform.controller';
import { ContentTransformService } from './content-transform.service';
import { PaastAnalyzerModule } from '../paast-analyzer/paast-analyzer.module';

@Module({
  // PaastAnalyzerModule export PaastAnalyzerService — inject thẳng để chấm điểm PAAST,
  // không gọi qua HTTP nội bộ.
  imports: [HttpModule, PaastAnalyzerModule],
  controllers: [ContentTransformController],
  providers: [ContentTransformService],
  exports: [ContentTransformService],
})
export class ContentTransformModule {}

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaastAnalyzerController } from './paast-analyzer.controller';
import { PaastAnalyzerService } from './paast-analyzer.service';

@Module({
  imports: [HttpModule],
  controllers: [PaastAnalyzerController],
  providers: [PaastAnalyzerService],
  exports: [PaastAnalyzerService],
})
export class PaastAnalyzerModule {}

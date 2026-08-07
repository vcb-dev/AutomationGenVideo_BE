import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaastAnalyzerService } from './paast-analyzer.service';

// KHÔNG còn controller: các route /paast/* độc lập đã chuyển sang ai-integration.controller.ts
// (xem PaastAnalyzerService). Module này giờ chỉ export service để content-transform tái dùng.
@Module({
  imports: [HttpModule],
  providers: [PaastAnalyzerService],
  exports: [PaastAnalyzerService],
})
export class PaastAnalyzerModule {}

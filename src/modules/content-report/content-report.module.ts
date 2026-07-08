import { Module } from '@nestjs/common';
import { ContentReportController } from './content-report.controller';
import { ContentReportService } from './content-report.service';

@Module({
  controllers: [ContentReportController],
  providers: [ContentReportService],
  exports: [ContentReportService],
})
export class ContentReportModule {}

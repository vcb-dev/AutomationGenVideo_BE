import { Module } from '@nestjs/common';
import { ContentReportController } from './content-report.controller';
import { ContentReportService } from './content-report.service';
import { CacheModule } from '../../common/cache/cache.module';

@Module({
  imports: [CacheModule],
  controllers: [ContentReportController],
  providers: [ContentReportService],
  exports: [ContentReportService],
})
export class ContentReportModule {}

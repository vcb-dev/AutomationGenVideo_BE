import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramReportController } from './telegram-report.controller';
import { TelegramReportService } from './telegram-report.service';

@Module({
  imports: [ScheduleModule],
  controllers: [TelegramReportController],
  providers: [TelegramReportService],
})
export class TelegramReportModule {}

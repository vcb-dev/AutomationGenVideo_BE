import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramReportController } from './telegram-report.controller';
import { TelegramReportService } from './telegram-report.service';
import { AiIntegrationModule } from '../ai-integration/ai-integration.module';

@Module({
  imports: [ScheduleModule, AiIntegrationModule],
  controllers: [TelegramReportController],
  providers: [TelegramReportService],
})
export class TelegramReportModule {}

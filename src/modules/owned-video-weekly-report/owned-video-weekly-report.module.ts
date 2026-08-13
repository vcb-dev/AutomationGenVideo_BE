import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { FacebookOwnedPagesModule } from '../facebook-owned-pages/facebook-owned-pages.module';
import { LarkModule } from '../lark-sync/lark.module';
import { WeeklyReportController } from './weekly-report.controller';
import { WeeklyReportCronService } from './weekly-report.cron.service';
import { WeeklyReportService } from './weekly-report.service';

/**
 * Báo cáo hiệu suất 7 ngày của video kênh nội bộ, gửi về Lark.
 *
 * Mượn LarkNotifyService (gửi message) và FacebookAiClientService (làm mới chỉ số) thay vì dựng
 * lại — cả hai đã có chủ ở module khác.
 */
@Module({
  imports: [PrismaModule, ConfigModule, LarkModule, FacebookOwnedPagesModule],
  controllers: [WeeklyReportController],
  providers: [WeeklyReportService, WeeklyReportCronService],
  exports: [WeeklyReportService],
})
export class OwnedVideoWeeklyReportModule {}

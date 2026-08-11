import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

import { WeeklyReportService } from './weekly-report.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

/**
 * Gửi báo cáo hiệu suất 7 ngày lúc 09:00 giờ VN.
 *
 * Giờ này không đụng cron nào sẵn có: 05:30 gia hạn token · 06:00 import page · 06:30 backfill ·
 * 07:00 delta sync · 07:30 chấm PAAST (~12 phút) · 12:00 làm mới chỉ số toàn cục.
 *
 * Vì chạy TRƯỚC lần làm mới 12:00, service tự làm mới chỉ số cho đúng lô sắp gửi — xem
 * `WeeklyReportService.refreshBatchMetrics`.
 */
@Injectable()
export class WeeklyReportCronService {
  private readonly logger = new Logger(WeeklyReportCronService.name);
  private running = false;

  constructor(
    private readonly service: WeeklyReportService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 0 9 * * *', VN_TZ)
  async runDaily(): Promise<void> {
    // Mặc định TẮT: bật lên chỉ sau khi người dùng đọc nội dung message qua /bao-cao-tuan/run-thu
    // và duyệt. Gửi nhầm một message xấu cho cả team thì không rút lại được.
    if (this.configService.get<string>('WEEKLY_REPORT_ENABLED') !== 'true') {
      this.logger.log('[WEEKLY-REPORT] Đang tắt (WEEKLY_REPORT_ENABLED != true) — bỏ qua lượt này');
      return;
    }

    // Lượt trước chạy quá lâu thì bỏ lượt này, không chạy đè.
    if (this.running) {
      this.logger.warn('[WEEKLY-REPORT] Bỏ qua: lượt trước chưa xong');
      return;
    }
    this.running = true;

    try {
      const result = await this.service.run(false);
      this.logger.log(
        `[WEEKLY-REPORT] xét ${result.videosConsidered} video · ${result.videosAboveThreshold} đạt ngưỡng ${result.viewThreshold} · ` +
          `${result.sent ? 'đã gửi' : 'không gửi'}${result.note ? ` — ${result.note}` : ''}`,
      );
    } catch (err: any) {
      this.logger.error(`[WEEKLY-REPORT] Lỗi ngoài dự kiến: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }
}

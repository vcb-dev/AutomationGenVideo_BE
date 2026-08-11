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
    // Mặc định TẮT: bật lên chỉ sau khi người dùng đọc nội dung tin qua /bao-cao-tuan/run-thu
    // và duyệt. Gửi nhầm một tin xấu cho cả team thì không rút lại được.
    if (this.configService.get<string>('BAO_CAO_TUAN_BAT') !== 'true') {
      this.logger.log('[BAO-CAO-TUAN] Đang tắt (BAO_CAO_TUAN_BAT != true) — bỏ qua lượt này');
      return;
    }

    // Lượt trước chạy quá lâu thì bỏ lượt này, không chạy đè.
    if (this.running) {
      this.logger.warn('[BAO-CAO-TUAN] Bỏ qua: lượt trước chưa xong');
      return;
    }
    this.running = true;

    try {
      const kq = await this.service.run(false);
      this.logger.log(
        `[BAO-CAO-TUAN] xét ${kq.soVideoXet} video · ${kq.soVideoDat} đạt ngưỡng ${kq.viewThreshold} · ` +
          `${kq.daGui ? 'đã gửi' : 'không gửi'}${kq.ghiChu ? ` — ${kq.ghiChu}` : ''}`,
      );
    } catch (err: any) {
      this.logger.error(`[BAO-CAO-TUAN] Lỗi ngoài dự kiến: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }
}

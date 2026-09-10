import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SapoIntegrationService } from './sapo-integration.service';
import { vietnamDateString } from '../../utils/date.utils';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

@Injectable()
export class SapoRevenueCronService {
  private readonly logger = new Logger(SapoRevenueCronService.name);
  private isRunning = false;

  constructor(private readonly sapoService: SapoIntegrationService) {}

  /**
   * Tự động kéo và đồng bộ doanh thu Sapo lúc 02:00 AM hàng ngày (giờ Việt Nam).
   * Lấy dữ liệu của ngày hôm trước (D-1).
   */
  @Cron('0 2 * * *', VN_TZ)
  async handleDailySapoRevenueSync(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('[Sapo Cron] Tiến trình đồng bộ doanh thu trước đó vẫn đang chạy. Bỏ qua lượt này.');
      return;
    }

    if (!this.sapoService.isConfigured()) {
      this.logger.log('[Sapo Cron] Chưa cấu hình Sapo API trong .env. Bỏ qua cron đồng bộ tự động.');
      return;
    }

    this.isRunning = true;
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const targetDate = vietnamDateString(yesterday);

      this.logger.log(`[Sapo Cron] Bắt đầu tự động đồng bộ doanh thu Sapo cho ngày ${targetDate}...`);
      const result = await this.sapoService.syncDailyRevenueToDatabase(
        targetDate,
        'Tổng hợp Sapo',
        'cron@sapo.vn',
        'Hệ thống Sapo Cron',
      );
      this.logger.log(`[Sapo Cron] Kết quả đồng bộ ngày ${targetDate}: ${result.message}`);
    } catch (err: any) {
      this.logger.error(`[Sapo Cron] Lỗi khi chạy đồng bộ doanh thu tự động: ${err.message}`, err.stack);
    } finally {
      this.isRunning = false;
    }
  }
}

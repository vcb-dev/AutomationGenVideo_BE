import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KuaishouScraperService } from './kuaishou-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Nền tảng mới — cron định kỳ chạy nguyên bản trong BE (không có Celery Beat nào ở
// AI để thay thế). Chọn 9h sáng VN để không trùng giờ các cron khác (Facebook 6h/
// 6h30/7h/12h, Instagram 7h30, Douyin/Xiaohongshu 8h, YouTube 8h30).
@Injectable()
export class KuaishouScraperCronService {
  private readonly logger = new Logger(KuaishouScraperCronService.name);

  constructor(private readonly service: KuaishouScraperService) {}

  @Cron('0 0 9 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [KUAISHOU-PERIODIC] Lỗi: ${err.message}`);
    }
  }

  @Cron('0 0 14 * * *', VN_TZ)
  async cronAutoRerunKeywords(): Promise<void> {
    try {
      await this.service.autoRerunTopKeywords();
    } catch (err: any) {
      this.logger.error(`❌ [KUAISHOU-AUTO-RERUN] Lỗi: ${err.message}`);
    }
  }
}

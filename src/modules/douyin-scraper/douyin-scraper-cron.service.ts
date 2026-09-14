import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DouyinScraperService } from './douyin-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE 'douyin-periodic-profile-videos' bên AI
// (video_management.periodic_scrape_douyin_profiles, crontab(minute=0, hour=1) UTC = 8h VN).
@Injectable()
export class DouyinScraperCronService {
  private readonly logger = new Logger(DouyinScraperCronService.name);

  constructor(private readonly service: DouyinScraperService) {}

  // @Cron('0 0 8 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [DOUYIN-PERIODIC] Lỗi: ${err.message}`);
    }
  }

  // @Cron('0 30 13 * * *', VN_TZ)
  async cronAutoRerunKeywords(): Promise<void> {
    try {
      await this.service.autoRerunTopKeywords();
    } catch (err: any) {
      this.logger.error(`❌ [DOUYIN-AUTO-RERUN] Lỗi: ${err.message}`);
    }
  }
}

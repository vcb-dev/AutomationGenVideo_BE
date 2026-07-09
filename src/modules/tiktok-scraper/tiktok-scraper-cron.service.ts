import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TiktokScraperService } from './tiktok-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE 'tiktok-periodic-profile-posts' bên AI
// (video_management.periodic_scrape_tiktok_profiles, crontab(minute=30, hour=22) UTC = 5h30 VN).
@Injectable()
export class TiktokScraperCronService {
  private readonly logger = new Logger(TiktokScraperCronService.name);

  constructor(private readonly service: TiktokScraperService) {}

  @Cron('0 30 5 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [TT-PERIODIC] Lỗi: ${err.message}`);
    }
  }
}

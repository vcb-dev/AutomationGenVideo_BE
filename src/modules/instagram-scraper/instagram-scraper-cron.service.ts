import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InstagramScraperService } from './instagram-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE 'instagram-periodic-profile-reels' bên AI
// (video_management.periodic_scrape_instagram_profiles, crontab(minute=30, hour=0) UTC = 7h30 VN).
@Injectable()
export class InstagramScraperCronService {
  private readonly logger = new Logger(InstagramScraperCronService.name);

  constructor(private readonly service: InstagramScraperService) {}

  @Cron('0 30 7 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [IG-PERIODIC] Lỗi: ${err.message}`);
    }
  }
}

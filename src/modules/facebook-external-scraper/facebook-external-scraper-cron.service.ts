import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FacebookExternalScraperService } from './facebook-external-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE 'scraper-periodic-reels' bên AI
// (video_management.periodic_scrape_marked_pages, crontab(minute=0, hour=23) UTC = 6h VN).
@Injectable()
export class FacebookExternalScraperCronService {
  private readonly logger = new Logger(FacebookExternalScraperCronService.name);

  constructor(private readonly service: FacebookExternalScraperService) {}

  // @Cron('0 0 6 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [FB-EXTERNAL-PERIODIC] Lỗi: ${err.message}`);
    }
  }
}

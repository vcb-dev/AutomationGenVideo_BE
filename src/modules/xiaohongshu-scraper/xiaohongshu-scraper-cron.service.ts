import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { XiaohongshuScraperService } from './xiaohongshu-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE 'xhs-periodic-profile-videos' bên AI
// (video_management.periodic_scrape_xhs_profiles, crontab(minute=0, hour=1) UTC = 8h VN).
@Injectable()
export class XiaohongshuScraperCronService {
  private readonly logger = new Logger(XiaohongshuScraperCronService.name);

  constructor(private readonly service: XiaohongshuScraperService) {}

  @Cron('0 0 8 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [XHS-PERIODIC] Lỗi: ${err.message}`);
    }
  }
}

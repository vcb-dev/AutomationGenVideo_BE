import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { YoutubeScraperService } from './youtube-scraper.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Nền tảng mới — cron định kỳ chạy nguyên bản trong BE (không có Celery Beat nào ở
// AI để thay thế). Chọn 8h30 sáng VN để không trùng giờ các cron khác (Facebook 6h/
// 6h30/7h/12h, Instagram 7h30, Douyin/Xiaohongshu 8h).
@Injectable()
export class YoutubeScraperCronService {
  private readonly logger = new Logger(YoutubeScraperCronService.name);

  constructor(private readonly service: YoutubeScraperService) {}

  // @Cron('0 30 8 * * *', VN_TZ)
  async cronPeriodicRefresh(): Promise<void> {
    try {
      await this.service.periodicRefresh();
    } catch (err: any) {
      this.logger.error(`❌ [YT-PERIODIC] Lỗi: ${err.message}`);
    }
  }
}

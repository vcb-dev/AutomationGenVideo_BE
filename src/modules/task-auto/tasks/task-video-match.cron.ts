import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TaskVideoMatchService } from "./task-video-match.service";

const VN_TZ = { timeZone: "Asia/Ho_Chi_Minh" };

/**
 * Khớp video kênh nội bộ mới kéo về với task, chạy 07:45 VN — sau cron kéo FB (07:00) / IG
 * (07:15) và trước cron cào traffic link (`refreshMonthlyPublishedLinkStats`, 08:15) nên link
 * vừa gắn kịp được cào trong cùng buổi sáng.
 */
@Injectable()
export class TaskVideoMatchCronService {
  private readonly logger = new Logger(TaskVideoMatchCronService.name);
  private isRunning = false;

  constructor(private readonly service: TaskVideoMatchService) {}

  @Cron("0 45 7 * * *", VN_TZ)
  async cronMatchVideos(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("[VIDEO-MATCH] Bỏ qua: lượt trước chưa xong");
      return;
    }
    this.isRunning = true;
    try {
      await this.service.runDailyMatch();
    } catch (err: any) {
      this.logger.error(`❌ [VIDEO-MATCH] Lỗi: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}

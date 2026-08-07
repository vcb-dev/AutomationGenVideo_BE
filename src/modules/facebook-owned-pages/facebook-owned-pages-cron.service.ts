import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FacebookOwnedPagesService } from './facebook-owned-pages.service';
import { FacebookAiClientService } from './facebook-ai-client.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

// Thay thế CELERY_BEAT_SCHEDULE bên AI (auto_import_pages / backfill_all_pages /
// delta_sync_all_pages / refresh_recent_metrics) — cùng giờ chạy, chỉ đổi nơi thực thi
// từ Celery Beat (AI) sang @Cron (BE), khớp nguyên tắc BE sở hữu DB + điều phối.
@Injectable()
export class FacebookOwnedPagesCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FacebookOwnedPagesCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: FacebookOwnedPagesService,
    private readonly aiClient: FacebookAiClientService,
  ) {}

  // Chạy TRƯỚC import 6h: import là bước duy nhất cần User Access Token, gia hạn xong
  // mới import thì mới có tác dụng trong cùng ngày.
  @Cron('0 30 5 * * *', VN_TZ)
  async cronRefreshUserToken(): Promise<void> {
    try {
      const { status, message } = await this.aiClient.refreshUserToken();
      if (status === 'refreshed' || status === 'ok') {
        this.logger.log(`[TOKEN] ${message}`);
      } else {
        this.logger.error(`❌ [TOKEN] ${message}`);
      }
    } catch (err: any) {
      this.logger.error(`❌ [TOKEN] Không kiểm tra được token: ${err.message}`);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const pageCount = await this.prisma.video_management_managedfacebookpage.count();

    if (pageCount === 0) {
      this.logger.log('[BOOTSTRAP] Chưa có page nào — tự động import lần đầu ngay khi khởi động...');
      this.runImportPages();
      return;
    }

    const pendingBackfill = await this.prisma.video_management_managedfacebookpage.count({
      where: { is_active: true, is_backfilled: false },
    });
    if (pendingBackfill > 0) {
      this.logger.log(`[BOOTSTRAP] ${pendingBackfill} page chưa backfill — tự động backfill ngay khi khởi động...`);
      this.service.backfillAllPages(300).catch((err) => {
        this.logger.error(`[BOOTSTRAP-BACKFILL] Lỗi: ${err.message}`);
      });
    }
  }

  // GĐ0: tự phát hiện page mới (6h sáng VN)
  @Cron('0 0 6 * * *', VN_TZ)
  async cronImportPages(): Promise<void> {
    await this.runImportPages();
  }

  private async runImportPages(): Promise<void> {
    this.logger.log('═══ [IMPORT] Kiểm tra pages mới từ Facebook ═══');
    try {
      const { created, updated, newPageIds } = await this.service.importManagedPages();
      this.logger.log(`✅ [IMPORT] +${created} page mới, ~${updated} cập nhật`);

      // Có page mới → tự trigger backfill riêng cho từng page (giống backfill_single_page_task.delay cũ)
      for (const pageId of newPageIds) {
        this.service.backfillPage(pageId, 300).catch((err) => {
          this.logger.error(`[IMPORT-BACKFILL] ${pageId} thất bại: ${err.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`❌ [IMPORT] Lỗi: ${err.message}`);
    }
  }

  // GĐ1: backfill page chưa cào lịch sử (6h30 sáng VN)
  @Cron('0 30 6 * * *', VN_TZ)
  async cronBackfillAllPages(): Promise<void> {
    try {
      await this.service.backfillAllPages(300);
    } catch (err: any) {
      this.logger.error(`❌ [BACKFILL] Lỗi: ${err.message}`);
    }
  }

  // GĐ2: delta sync bài mới (7h sáng VN)
  @Cron('0 0 7 * * *', VN_TZ)
  async cronDeltaSyncAllPages(): Promise<void> {
    try {
      await this.service.deltaSyncAllPages();
    } catch (err: any) {
      this.logger.error(`❌ [DELTA] Lỗi: ${err.message}`);
    }
  }

  // GĐ3: refresh metrics video 7 ngày gần đây (12h trưa VN)
  @Cron('0 0 12 * * *', VN_TZ)
  async cronRefreshRecentMetrics(): Promise<void> {
    try {
      await this.service.refreshRecentMetrics(7);
    } catch (err: any) {
      this.logger.error(`❌ [METRICS] Lỗi: ${err.message}`);
    }
  }
}

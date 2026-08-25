import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelStatsEnrichmentService, EnrichTarget } from './channel-stats-enrichment.service';

@Injectable()
export class ChannelEnrichmentCronService {
  private readonly logger = new Logger(ChannelEnrichmentCronService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichmentService: ChannelStatsEnrichmentService,
  ) {}

  /**
   * Cronjob tự động cào làm giàu dữ liệu các kênh đang theo dõi mỗi 4 tiếng.
   * Lấy các kênh active chưa đồng bộ trong vòng 4 tiếng để tránh lặp lại request không cần thiết.
   */
  // @Cron('0 */4 * * *')
  async handlePeriodicChannelEnrichment() {
    if (this.isRunning) {
      this.logger.warn('[Cron] Đợt làm giàu dữ liệu trước vẫn đang chạy, bỏ qua lần kích hoạt này.');
      return;
    }

    this.isRunning = true;
    this.logger.log('🚀 [Cron] Bắt đầu quét & cào trước dữ liệu các kênh (Background Pre-fetching)...');

    try {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      const channelsToEnrich = await this.prisma.trackedChannel.findMany({
        where: {
          is_active: true,
          OR: [
            { last_synced_at: null },
            { last_synced_at: { lt: fourHoursAgo } },
          ],
        },
        select: {
          user_id: true,
          platform: true,
          username: true,
        },
        take: 100, // Mỗi đợt xử lý tối đa 100 kênh để tối ưu tải
      });

      if (channelsToEnrich.length === 0) {
        this.logger.log('✅ [Cron] Toàn bộ kênh đã có dữ liệu mới nhất trong vòng 4 tiếng. Không cần cào thêm.');
        return;
      }

      this.logger.log(`📊 [Cron] Tìm thấy ${channelsToEnrich.length} kênh cần làm mới dữ liệu. Bắt đầu xử lý theo lô...`);

      const targets: EnrichTarget[] = channelsToEnrich.map((c) => ({
        userId: c.user_id,
        platform: c.platform,
        username: c.username,
      }));

      const result = await this.enrichmentService.enrichBatch(targets, { concurrency: 2 });
      this.logger.log(`🎉 [Cron] Hoàn tất đợt làm giàu dữ liệu: Thành công=${result.ok}, Thất bại=${result.failed}`);
    } catch (error: any) {
      this.logger.error(`❌ [Cron] Lỗi trong quá trình quét kênh ngầm: ${error?.message || error}`, error?.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Hàm cho phép gọi thủ công toàn bộ đợt quét (dùng cho test hoặc trigger từ admin)
   */
  async triggerManualFullScan(): Promise<{ ok: number; failed: number }> {
    this.logger.log('⚡ [Manual] Kích hoạt thủ công cào dữ liệu toàn bộ kênh...');
    const channels = await this.prisma.trackedChannel.findMany({
      where: { is_active: true },
      select: { user_id: true, platform: true, username: true },
    });

    const targets: EnrichTarget[] = channels.map((c) => ({
      userId: c.user_id,
      platform: c.platform,
      username: c.username,
    }));

    return this.enrichmentService.enrichBatch(targets, { concurrency: 2 });
  }
}

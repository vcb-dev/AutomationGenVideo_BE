import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../common/prisma/prisma.service';
import { FacebookAiClientService } from '../facebook-owned-pages/facebook-ai-client.service';
import { LarkNotifyService, LarkSendError } from '../lark-sync/lark-notify.service';
import {
  DEFAULT_VIEW_THRESHOLD,
  filterByThreshold,
  filterUnfinalizedVideos,
  computeWindow,
} from './select-full-week-videos';
import { FullWeekVideo, buildMessageContent } from './build-message-content';

/**
 * Trần số TIN mỗi lượt chạy. v1 chỉ gửi cho một người nên luôn là 1 message; giữ trần ở đây để
 * khi v2 gửi riêng từng chủ kênh, một lỗi dây chuyền không biến thành trận spam vài trăm message.
 */
const MAX_MESSAGES_PER_RUN = 50;

export interface FullWeekVideoDetail extends FullWeekVideo {
  managed_page_id: bigint;
  page_access_token: string;
}

export interface RunResult {
  /** Số video tròn 7 ngày được xét trong lượt này. */
  videosConsidered: number;
  /** Trong đó bao nhiêu video đạt ngưỡng — cũng là số video được nêu trong message. */
  videosAboveThreshold: number;
  viewThreshold: number;
  /** null = không có video nào đạt ngưỡng, và như vậy KHÔNG gửi message nào. */
  messageContent: string | null;
  sent: boolean;
  note?: string;
}

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: FacebookAiClientService,
    private readonly larkNotify: LarkNotifyService,
    private readonly configService: ConfigService,
  ) {}

  /** Video đã sống đủ 7 ngày, chưa được chốt trong nhật ký, và chưa quá cũ. */
  async getFullWeekVideos(bayGio = new Date()): Promise<FullWeekVideoDetail[]> {
    const { tuNgay, denNgay } = computeWindow(bayGio);

    const rows = await this.prisma.video_management_ownedvideocontent.findMany({
      where: {
        published_at: { gte: tuNgay, lt: denNgay },
        managed_page: { is_active: true },
      },
      include: { managed_page: { select: { id: true, name: true, page_access_token: true } } },
      orderBy: { published_at: 'desc' },
    });

    const videos: FullWeekVideoDetail[] = rows.map((v) => ({
      post_id: v.post_id,
      ten_fanpage: v.managed_page.name,
      caption: v.caption,
      permalink_url: v.permalink_url,
      published_at: v.published_at,
      view_count: Number(v.view_count),
      like_count: v.like_count,
      comment_count: v.comment_count,
      share_count: v.share_count,
      managed_page_id: v.managed_page.id,
      page_access_token: v.managed_page.page_access_token,
    }));

    const log = await this.prisma.ownedVideoWeeklyNotifyLog.findMany({
      where: { post_id: { in: videos.map((v) => v.post_id) } },
      select: { post_id: true, trang_thai: true, so_lan_thu: true },
    });

    return filterUnfinalizedVideos(videos, log);
  }

  /**
   * Làm mới chỉ số cho ĐÚNG lô sắp gửi, ngay trước khi dựng message.
   *
   * Vì sao cần: cron làm mới toàn cục chạy 12:00, mà báo cáo chạy 09:00 — không làm mới riêng
   * thì số gửi đi là số của 12:00 hôm qua, cũ khoảng 21 tiếng. Lô này chỉ ~130 video, so với
   * ~1.300 video của cả cửa sổ 7 ngày, nên rẻ hơn nhiều lần việc nới cửa sổ toàn cục.
   *
   * Sau hôm nay video rớt khỏi cửa sổ 7 ngày của cron 12:00 và không bao giờ được làm mới nữa,
   * nên con số lấy ở đây đúng là con số chốt cuối cùng hệ thống có.
   *
   * Cập nhật thẳng vào `videos` (tham chiếu) để phần dựng message dùng số mới mà không phải truy vấn lại.
   */
  async refreshBatchMetrics(videos: FullWeekVideoDetail[]): Promise<void> {
    const byPage = new Map<string, FullWeekVideoDetail[]>();
    for (const v of videos) {
      const khoa = String(v.managed_page_id);
      if (!byPage.has(khoa)) byPage.set(khoa, []);
      byPage.get(khoa)!.push(v);
    }

    for (const [khoa, cuaPage] of byPage) {
      const token = cuaPage[0].page_access_token;
      if (!token) {
        this.logger.warn(`[LAM-MOI] Page ${cuaPage[0].ten_fanpage} chưa có token — dùng số cũ`);
        continue;
      }

      try {
        const { metrics } = await this.aiClient.fetchMetricsRefresh(
          token,
          cuaPage.map((v) => v.post_id),
        );

        for (const v of cuaPage) {
          const m = metrics?.[v.post_id];
          if (!m) continue;
          v.view_count = m.view_count ?? v.view_count;
          v.like_count = m.like_count ?? v.like_count;
          v.comment_count = m.comment_count ?? v.comment_count;
          v.share_count = m.share_count ?? v.share_count;

          await this.prisma.video_management_ownedvideocontent.update({
            where: { post_id: v.post_id },
            data: {
              view_count: BigInt(v.view_count),
              like_count: v.like_count,
              comment_count: v.comment_count,
              share_count: v.share_count,
              updated_at: new Date(),
            },
          });
        }
      } catch (err: any) {
        // Một fanpage hỏng không được làm chết cả lượt — số cũ vẫn tốt hơn không có báo cáo.
        this.logger.warn(`[LAM-MOI] Page ${khoa} lỗi: ${err?.message} — dùng số cũ`);
      }
    }
  }

  /**
   * @param cheDoKho true = dựng message rồi trả về, KHÔNG gửi và KHÔNG ghi nhật ký. Dùng để đọc
   *                 trước nội dung trên dữ liệu thật mà không nhắn ai.
   */
  get viewThreshold(): number {
    const aboveThreshold = Number(this.configService.get<string>('WEEKLY_REPORT_VIEW_THRESHOLD'));
    return Number.isFinite(aboveThreshold) && aboveThreshold > 0 ? aboveThreshold : DEFAULT_VIEW_THRESHOLD;
  }

  async run(cheDoKho: boolean): Promise<RunResult> {
    const viewThreshold = this.viewThreshold;
    const videos = await this.getFullWeekVideos();

    if (videos.length === 0) {
      return { videosConsidered: 0, videosAboveThreshold: 0, viewThreshold, messageContent: null, sent: false, note: 'Không có video nào tròn 7 ngày' };
    }

    // Làm mới TRƯỚC khi lọc ngưỡng: lọc trên số cũ thì video vừa chạm mốc trong đêm bị bỏ sót,
    // mà nó lại bị chốt 'duoi_nguong' ngay lượt này nên không bao giờ được báo nữa.
    await this.refreshBatchMetrics(videos);
    const { aboveThreshold, belowThreshold } = filterByThreshold(videos, viewThreshold);

    const summary = { videosConsidered: videos.length, videosAboveThreshold: aboveThreshold.length, viewThreshold };
    const messageContent = buildMessageContent(aboveThreshold, viewThreshold);

    if (cheDoKho) {
      return { ...summary, messageContent, sent: false, note: 'Chế độ khô — không gửi, không ghi nhật ký' };
    }

    // Chốt video không đạt ngưỡng dù có gửi được message hay không: chúng đã được xét ở đúng mốc
    // 7 ngày, xét lại vào ngày thứ 8 là sai yêu cầu.
    if (belowThreshold.length) {
      await this.writeNotifyLog(belowThreshold, null, 'duoi_nguong', null);
    }

    if (aboveThreshold.length === 0) {
      this.logger.log(`[WEEKLY-REPORT] ${videos.length} video tròn tuần, không cái nào đạt ${viewThreshold} view — không gửi`);
      return { ...summary, messageContent, sent: false, note: 'Không có video nào đạt ngưỡng' };
    }

    const openId = this.configService.get<string>('LARK_NOTIFY_OPEN_ID');
    if (!openId) {
      this.logger.warn('[WEEKLY-REPORT] Thiếu LARK_NOTIFY_OPEN_ID — không biết gửi cho ai');
      await this.writeNotifyLog(aboveThreshold, null, 'khong_co_nguoi_nhan', 'Thiếu LARK_NOTIFY_OPEN_ID');
      return { ...summary, messageContent, sent: false, note: 'Thiếu LARK_NOTIFY_OPEN_ID' };
    }

    // v1 gộp cả lô vào một message nên luôn là 1; trần này có ý nghĩa từ v2 trở đi.
    if (MAX_MESSAGES_PER_RUN < 1) {
      return { ...summary, messageContent, sent: false, note: 'Chạm trần số message' };
    }

    try {
      const { messageId } = await this.larkNotify.sendMessage(openId, messageContent!);
      await this.writeNotifyLog(aboveThreshold, openId, 'da_gui', null);
      this.logger.log(`[WEEKLY-REPORT] Đã gửi ${aboveThreshold.length} video vượt ngưỡng — message_id=${messageId}`);
      return { ...summary, messageContent, sent: true };
    } catch (err: any) {
      const permanent = err instanceof LarkSendError && err.permanent;
      // Lỗi chết thì đẩy so_lan_thu vượt trần luôn để không thử lại vô ích những lượt sau.
      await this.writeNotifyLog(aboveThreshold, openId, 'loi', err?.message ?? 'Lỗi không rõ', permanent);
      this.logger.error(`[WEEKLY-REPORT] Gửi hỏng: ${err?.message}`);
      return { ...summary, messageContent, sent: false, note: `Gửi hỏng: ${err?.message}` };
    }
  }

  private async writeNotifyLog(
    videos: FullWeekVideoDetail[],
    openId: string | null,
    status: string,
    loi: string | null,
    chotLuon = false,
  ): Promise<void> {
    const sentAt = status === 'da_gui' ? new Date() : null;

    for (const v of videos) {
      await this.prisma.ownedVideoWeeklyNotifyLog.upsert({
        where: { post_id: v.post_id },
        create: {
          post_id: v.post_id,
          lark_open_id: openId,
          trang_thai: status,
          so_lan_thu: chotLuon ? 99 : 1,
          loi,
          sent_at: sentAt,
        },
        update: {
          lark_open_id: openId,
          trang_thai: status,
          so_lan_thu: chotLuon ? 99 : { increment: 1 },
          loi,
          sent_at: sentAt,
        },
      });
    }
  }
}

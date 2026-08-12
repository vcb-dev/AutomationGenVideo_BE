import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnedScriptService } from './owned-script.service';

const VN_TZ = { timeZone: 'Asia/Ho_Chi_Minh' };

/**
 * Tự chấm điểm PAAST cho video kênh nội bộ, chạy nền ban đêm.
 *
 * ── CHỈ dùng đường phụ đề Facebook ──────────────────────────────────────────────
 * Đường còn lại (RapidAPI + Whisper) phủ được nhiều video hơn nhưng gói RapidAPI hiện tại
 * chỉ có 200 lượt gọi MỖI THÁNG — đo trên header thật, còn 169 lượt. Mỗi video tốn 1–4 lượt,
 * nên chạy nền hàng loạt là cháy hạn mức trong một đêm và làm hỏng luôn đường bấm tay của
 * người dùng. Vì vậy cron chỉ đi đường phụ đề: không đụng hạn mức nào, ~16 giây/video.
 *
 * Video không có phụ đề vẫn để nguyên cho người dùng bấm tay khi thực sự cần.
 *
 * ── Vì sao chạy tuần tự, không song song ────────────────────────────────────────
 * Mỗi lần chấm là 6 lượt gọi DeepSeek (5 phân loại + 1 sinh hook). Bắn song song thì vừa dễ
 * dính giới hạn tốc độ của DeepSeek, vừa tranh CPU với BE/FE/Postgres đang chạy cùng máy.
 */

/** Trần mỗi lần chạy — chặn để một đêm lỗi dây chuyền không đốt hết hạn mức LLM. */
const TRAN_MOI_LAN = { moi: 300, phuNguoc: 400 };

/** Nghỉ giữa hai video, tránh dí DeepSeek quá branches. */
const NGHI_MS = 1_000;

@Injectable()
export class OwnedPaastCronService {
  private readonly logger = new Logger(OwnedPaastCronService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly script: OwnedScriptService,
  ) {}

  /**
   * Video mới trong ngày — chạy 07:30, ngay sau khi cron cào xong lúc 07:00.
   *
   * Khối lượng thật: ~130 video mới/ngày, trong đó ~1/3 có phụ đề → khoảng 12 phút.
   */
  @Cron('0 30 7 * * *', VN_TZ)
  async scoreNewVideos(): Promise<void> {
    await this.chay('MOI', TRAN_MOI_LAN.moi, "v.published_at >= now() - interval '3 days'");
  }

  /**
   * Phủ ngược kho cũ — chạy 01:00 lúc máy rảnh nhất.
   *
   * Toàn kho 20.515 video, mỗi đêm vài trăm cái nên phải nhiều đêm mới xong. Cứ chạy đi
   * chạy lại là tự tiến vì video đã xử lý đều có bản recording (kể cả bản recording đánh dấu "không có
   * phụ đề"), truy vấn dưới tự loại chúng ra.
   */
  @Cron('0 0 1 * * *', VN_TZ)
  async phuNguoc(): Promise<void> {
    await this.chay('PHU_NGUOC', TRAN_MOI_LAN.phuNguoc, '1 = 1');
  }

  private async chay(nhan: string, tran: number, dateFilter: string): Promise<void> {
    // Hai cron có thể chồng nhau nếu lần trước chạy quá lâu — bỏ qua lần này thay vì chạy đè.
    if (this.isRunning) {
      this.logger.warn(`[${nhan}] Bỏ qua: lượt trước chưa xong`);
      return;
    }
    this.isRunning = true;

    try {
      const userId = await this.prisma.user.findFirst({
        where: { is_active: true },
        orderBy: { created_at: 'asc' },
        select: { id: true },
      });
      if (!userId) {
        this.logger.warn(`[${nhan}] Không có user nào để gán bản phân tích`);
        return;
      }

      // Chỉ lấy video CHƯA có bản recording nào — video đã chấm hoặc đã đánh dấu không có phụ đề
      // đều bị loại, nên chạy lại nhiều lần vẫn tiến chứ không giẫm chân.
      const canCham = await this.prisma.$queryRawUnsafe<{ post_id: string }[]>(`
        SELECT v.post_id
        FROM video_management_ownedvideocontent v
        JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        WHERE mp.is_active AND mp.page_access_token <> ''
          AND ${dateFilter}
          AND NOT EXISTS (
            SELECT 1 FROM owned_video_scripts s
            WHERE s.platform = 'facebook' AND s.post_id = v.post_id
          )
        ORDER BY v.published_at DESC
        LIMIT ${tran}
      `);

      if (!canCham.length) {
        this.logger.log(`[${nhan}] Không còn video nào cần chấm`);
        return;
      }

      const batDau = Date.now();
      let alreadyScored = 0;
      let khongCoKichBan = 0;
      let loi = 0;

      for (const { post_id } of canCham) {
        try {
          // `true` = chỉ phụ đề, tuyệt đối không gọi Whisper — xem recording chú đầu file.
          const kq = await this.script.scoreVideo('facebook', post_id, userId.id, true);
          if (kq.trang_thai === 'da_cham') alreadyScored++;
          else khongCoKichBan++;
        } catch (e: any) {
          loi++;
          this.logger.warn(`[${nhan}] ${post_id}: ${e?.message}`);
        }
        await new Promise((r) => setTimeout(r, NGHI_MS));
      }

      const phut = Math.round((Date.now() - batDau) / 60_000);
      this.logger.log(
        `[${nhan}] Xong ${canCham.length} video trong ${phut} phút — ` +
          `${alreadyScored} đã chấm, ${khongCoKichBan} chưa có phụ đề, ${loi} lỗi`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}

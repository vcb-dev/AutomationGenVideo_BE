import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpException } from '@nestjs/common';
import { IdPhotoBatchStatus, IdPhotoStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdPhotoService } from './id-photo.service';

/**
 * Worker NỀN xử lý "Tạo ảnh thẻ hàng loạt" (module id-photo/batch).
 *
 * ── Vì sao worker chạy trong tiến trình BE, không đẩy sang AI service như content-transform ──
 * Content-transform job (transcribe/upgrade) sống bên AI service vì mỗi lượt chạy HÀNG TRĂM
 * giây trong một request đồng bộ và đụng trần timeout của Django/edge proxy. Ghép áo id-photo
 * thì khác: mỗi lượt ~10-30s, endpoint AI `/api/ai/id-photo/merge-outfit/` đã đồng bộ sẵn và
 * an toàn dưới mọi trần. Cái đắt ở đây là phải gọi N lượt TUẦN TỰ + nghỉ giữa các lượt để
 * không dí rate limit Gemini — việc đó BE tự điều phối gọn hơn là dựng thêm 1 job cha/con nữa
 * bên AI. BE vẫn giữ đúng vai "orchestrate", từng lượt gọi Gemini vẫn qua AI service.
 *
 * ── Mô hình ──────────────────────────────────────────────────────────────────────
 *  - Hàng đợi trong RAM (`queue`) chỉ chứa batchJobId (string) — KHÔNG giữ tham chiếu sống tới
 *    bản ghi đang bị worker ghi đè (bài học từ bug progress store content-transform: đọc phải
 *    qua bản sao). Mọi trạng thái thật đọc/ghi thẳng DB.
 *  - Một vòng `drain()` duy nhất, xử lý từng batch một, trong mỗi batch xử lý từng người một
 *    theo thứ tự `created_at` của IdPhotoHistory con → TUẦN TỰ tuyệt đối, không song song.
 *  - MỖI người đi ĐỦ các bước như luồng đơn lẻ: ghép áo (Gemini) → ghép KHUNG MÀU theo
 *    `position` + dựng PDF (IdPhotoService.exportPdf, không tốn AI) → SUCCESS. Kết quả cuối là
 *    ảnh thẻ CÓ KHUNG xuất được PDF, không phải ảnh chân dung trần.
 *  - Sau mỗi người (thành công hay lỗi) bump `updated_at` của IdPhotoBatchJob = HEARTBEAT.
 *  - Restart giữa chừng → queue RAM mất → cron `reconcileStuckIdPhotoBatchJobs` phát hiện job
 *    cha/con kẹt PENDING/PROCESSING quá hạn heartbeat và đánh FAILED (giống
 *    AiIntegrationService.reconcileStuckContentTransformJobs). Người dùng dùng nút "thử lại 1
 *    người" để chạy lại từng ảnh lỗi.
 */
@Injectable()
export class IdPhotoBatchWorker {
  private readonly logger = new Logger(IdPhotoBatchWorker.name);

  /** Chỉ chứa batchJobId. queue[0] = batch đang xử lý (shift SAU khi xong) → `isTracking` phủ
   * cả batch đang chờ lẫn batch đang chạy trên instance này. */
  private readonly queue: string[] = [];
  private draining = false;

  /** Mốc lần gọi Gemini (qua AI service) gần nhất — để ép khoảng nghỉ tối thiểu giữa 2 lượt. */
  private lastGeminiCallAt = 0;

  /** Nghỉ tối thiểu giữa 2 lượt gọi Gemini. Nằm trong dải 3-5s đã chốt: đủ thưa để không dí
   * rate limit free tier, đủ ngắn để 20 người vẫn xong trong ~10-15 phút. */
  protected readonly MIN_GEMINI_GAP_MS = 4_000;

  /** Backoff khi dính rate limit (HTTP 429/503) — chờ rồi thử lại ĐÚNG người đó. Số phần tử =
   * số lần retry tối đa (3). Hết mảng mà vẫn 429 → người đó FAILED, batch chạy tiếp. */
  protected readonly RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 45_000];

  /** Job cha/con PENDING hoặc PROCESSING mà quá mốc này không có heartbeat → coi là chết cứng
   * (BE restart/crash giữa batch). 12' > thời gian xấu nhất xử lý 1 người (gọi Gemini ~75s +
   * 3 lần backoff 5+15+45s + vài lượt timeout), nên batch đang chạy thật không bao giờ chạm. */
  protected readonly STALE_MS = 12 * 60_000;

  private reconcileRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly idPhotoService: IdPhotoService,
  ) {}

  // ─── Hàng đợi ───────────────────────────────────────────────────────────────

  /** Đưa 1 batch vào hàng đợi xử lý nền. An toàn khi gọi lại nhiều lần cho cùng id (tạo batch
   * rồi bấm "thử lại" khi worker còn đang chạy chính batch đó). */
  enqueue(batchJobId: string): void {
    if (!this.queue.includes(batchJobId)) this.queue.push(batchJobId);
    void this.drain();
  }

  /** Batch này đang được instance hiện tại giữ (chờ hoặc đang chạy) — cron reconcile bỏ qua,
   * không nhầm là "chết cứng". */
  isTracking(batchJobId: string): boolean {
    return this.queue.includes(batchJobId);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const batchJobId = this.queue[0];
        let infraError = false;
        try {
          await this.processBatch(batchJobId);
        } catch (err: any) {
          // processBatch tự nuốt lỗi từng người; lọt tới đây là lỗi hạ tầng (mất kết nối DB…).
          // Để nguyên trạng thái cho cron reconcile dọn, không kẹt cả hàng đợi.
          infraError = true;
          this.logger.error(`[batch ${batchJobId}] lỗi ngoài dự kiến khi xử lý: ${err?.message}`);
        }

        // Chỉ rời batch khỏi hàng đợi khi chắc chắn không còn item PENDING: nút "thử lại 1
        // người" có thể vừa đặt lại 1 item PENDING ĐÚNG lúc processBatch đang đóng sổ, và
        // enqueue() lúc đó bị chặn vì id vẫn còn trong hàng đợi. Bỏ qua kiểm tra này nếu vừa
        // lỗi hạ tầng để không quay vòng liên tục.
        let leftover = 0;
        if (!infraError) {
          leftover = await this.prisma.idPhotoHistory.count({
            where: { batch_job_id: batchJobId, status: IdPhotoStatus.PENDING },
          });
        }
        if (leftover === 0) this.queue.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  // ─── Xử lý 1 batch ─────────────────────────────────────────────────────────

  private async processBatch(batchJobId: string): Promise<void> {
    const batch = await this.prisma.idPhotoBatchJob.findUnique({ where: { id: batchJobId } });
    if (!batch) {
      this.logger.warn(`[batch ${batchJobId}] không tìm thấy job cha — bỏ qua`);
      return;
    }

    await this.prisma.idPhotoBatchJob.update({
      where: { id: batchJobId },
      data: { status: IdPhotoBatchStatus.PROCESSING },
    });

    // Item con kẹt PROCESSING từ lần chạy trước bị cắt ngang (restart) → trả về PENDING để xử
    // lại. An toàn vì worker là NGƯỜI GHI DUY NHẤT và mỗi lúc chỉ chạy 1 item.
    await this.prisma.idPhotoHistory.updateMany({
      where: { batch_job_id: batchJobId, status: IdPhotoStatus.PROCESSING },
      data: { status: IdPhotoStatus.PENDING },
    });

    // Lặp bằng findFirst thay vì nạp cả danh sách 1 lần: tự nhặt được cả item mới được nút
    // "thử lại 1 người" đặt lại PENDING trong lúc vòng lặp đang chạy.
    for (;;) {
      const next = await this.prisma.idPhotoHistory.findFirst({
        where: { batch_job_id: batchJobId, status: IdPhotoStatus.PENDING },
        orderBy: { created_at: 'asc' },
      });
      if (!next) break;

      await this.prisma.idPhotoHistory.update({
        where: { id: next.id },
        data: { status: IdPhotoStatus.PROCESSING },
      });

      await this.processPerson(next.id, next.raw_image_data);

      // Heartbeat sau MỖI người — dù người đó thành công hay lỗi.
      await this.bumpHeartbeat(batchJobId);
    }

    // Xong toàn bộ (kể cả khi có người FAILED) → COMPLETED. FAILED chỉ dành cho job chết cứng
    // do cron reconcile đánh dấu.
    await this.prisma.idPhotoBatchJob.update({
      where: { id: batchJobId },
      data: { status: IdPhotoBatchStatus.COMPLETED },
    });
    this.logger.log(`[batch ${batchJobId}] hoàn tất`);
  }

  /**
   * Ghép áo cho 1 người, có backoff+retry khi dính rate limit. Kết thúc LUÔN đặt item con về
   * SUCCESS hoặc FAILED (không bao giờ để nguyên PENDING/PROCESSING) — nếu không vòng lặp
   * processBatch sẽ quay vô hạn.
   */
  private async processPerson(historyId: string, rawImageData: string | null): Promise<void> {
    if (!rawImageData) {
      await this.failPerson(historyId, 'Thiếu ảnh gốc để ghép áo (dữ liệu tạm đã hết hạn).');
      return;
    }

    for (let attempt = 0; attempt <= this.RATE_LIMIT_BACKOFF_MS.length; attempt++) {
      await this.enforceGeminiGap();
      try {
        const processedImageData = await this.idPhotoService.runMergeOutfitOnRawImageData(
          rawImageData,
          `batch:${historyId}`,
        );
        this.markGeminiCall();

        // Bước 1/2 — lưu ảnh đã ghép áo (chưa đổi status: chưa phải "ảnh thẻ hoàn chỉnh").
        await this.prisma.idPhotoHistory.update({
          where: { id: historyId },
          data: { processed_image_data: processedImageData, error_message: null },
        });

        // Bước 2/2 — GHÉP KHUNG MÀU theo `position` + dựng PDF 1 trang, đúng như luồng đơn lẻ
        // (IdPhotoService.exportPdf → buildPdfBuffer): validate ảnh render được vào khung + set
        // `pdf_url`. Không tốn AI. Lỗi ở đây (ảnh hỏng, thiếu font…) → người này FAILED, vì kết
        // quả cuối phải là ẢNH THẺ CÓ KHUNG xuất được PDF, không chỉ ảnh chân dung trần.
        try {
          await this.idPhotoService.exportPdf(historyId);
        } catch (pdfErr: any) {
          await this.failPerson(
            historyId,
            `Đã ghép áo nhưng dựng khung màu / PDF thất bại: ${pdfErr?.message || pdfErr}`,
          );
          return;
        }

        await this.prisma.idPhotoHistory.update({
          where: { id: historyId },
          data: { status: IdPhotoStatus.SUCCESS, error_message: null },
        });
        return;
      } catch (err: any) {
        this.markGeminiCall();
        const rateLimited = this.isRateLimited(err);
        const canRetry = attempt < this.RATE_LIMIT_BACKOFF_MS.length;

        if (rateLimited && canRetry) {
          const wait = this.RATE_LIMIT_BACKOFF_MS[attempt];
          this.logger.warn(
            `[person ${historyId}] rate limit (429/503) — chờ ${wait}ms rồi thử lại ` +
              `(lần ${attempt + 1}/${this.RATE_LIMIT_BACKOFF_MS.length})`,
          );
          await this.sleep(wait);
          continue;
        }

        const msg = this.errorMessageOf(err, rateLimited);
        await this.failPerson(historyId, msg);
        return;
      }
    }
  }

  private async failPerson(historyId: string, errorMessage: string): Promise<void> {
    await this.prisma.idPhotoHistory.update({
      where: { id: historyId },
      data: { status: IdPhotoStatus.FAILED, error_message: errorMessage.slice(0, 500) },
    });
    this.logger.warn(`[person ${historyId}] FAILED: ${errorMessage}`);
  }

  // ─── Nhịp gọi Gemini ──────────────────────────────────────────────────────

  private async enforceGeminiGap(): Promise<void> {
    const wait = this.MIN_GEMINI_GAP_MS - (Date.now() - this.lastGeminiCallAt);
    if (wait > 0) await this.sleep(wait);
  }

  private markGeminiCall(): void {
    this.lastGeminiCallAt = Date.now();
  }

  /** Tách riêng để test thay bằng no-op (không phải chờ thật vài chục giây). */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRateLimited(err: any): boolean {
    const status = err instanceof HttpException ? err.getStatus() : err?.response?.status ?? err?.status;
    // AI service map lỗi quota/rate-limit của Gemini (ResourceExhausted) sang HTTP 503; 429 là
    // trường hợp rate-limit trực tiếp. Cả hai đều nên backoff + thử lại.
    if (status === 429 || status === 503) return true;
    const text = String(err?.message ?? '').toLowerCase();
    return text.includes('quota') || text.includes('rate limit') || text.includes('hạn mức');
  }

  private errorMessageOf(err: any, rateLimited: boolean): string {
    if (rateLimited) {
      return 'AI đang quá tải / vượt hạn mức (rate limit) — đã thử lại nhiều lần không thành công.';
    }
    if (err instanceof HttpException) {
      const res = err.getResponse();
      if (typeof res === 'string') return res;
      if (res && typeof res === 'object' && 'message' in res) return String((res as any).message);
    }
    return err?.message || 'Ghép áo thất bại.';
  }

  private async bumpHeartbeat(batchJobId: string): Promise<void> {
    // Ghi lại status=PROCESSING (giá trị hiện tại) để chắc chắn có một lần ghi cột thật → Prisma
    // tự cập nhật @updatedAt. Đây chính là mốc mà cron reconcile dùng để nhận biết "còn sống".
    await this.prisma.idPhotoBatchJob.update({
      where: { id: batchJobId },
      data: { status: IdPhotoBatchStatus.PROCESSING },
    });
  }

  // ─── Cron reconcile (watchdog) ────────────────────────────────────────────

  /**
   * Dọn job cha/con kẹt vì worker chết giữa chừng (BE restart/crash) — cùng vai trò với
   * AiIntegrationService.reconcileStuckContentTransformJobs.
   *
   *  - Job cha PENDING/PROCESSING, quá `STALE_MS` không heartbeat, và KHÔNG nằm trong hàng đợi
   *    của instance này → đánh FAILED, đồng thời mọi item con còn PENDING/PROCESSING → FAILED.
   *  - Batch đang chờ / đang chạy trên instance này (isTracking) được bỏ qua: nó vẫn sống, chỉ
   *    là chưa tới lượt hoặc đang xử lý người khác.
   */
  @Cron('*/2 * * * *')
  async reconcileStuckIdPhotoBatchJobs(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      const cutoff = new Date(Date.now() - this.STALE_MS);
      const stuck = await this.prisma.idPhotoBatchJob.findMany({
        where: {
          status: { in: [IdPhotoBatchStatus.PENDING, IdPhotoBatchStatus.PROCESSING] },
          updated_at: { lt: cutoff },
        },
        select: { id: true },
      });

      const orphans = stuck.filter((b) => !this.isTracking(b.id));
      if (orphans.length === 0) return;

      this.logger.warn(`[id-photo batch reconcile] ${orphans.length} job cha kẹt quá hạn — đánh FAILED`);

      for (const { id } of orphans) {
        try {
          await this.prisma.idPhotoHistory.updateMany({
            where: {
              batch_job_id: id,
              status: { in: [IdPhotoStatus.PENDING, IdPhotoStatus.PROCESSING] },
            },
            data: {
              status: IdPhotoStatus.FAILED,
              error_message: 'Mất dấu do BE khởi động lại / treo giữa chừng. Hãy bấm "thử lại" cho từng ảnh.',
            },
          });
          await this.prisma.idPhotoBatchJob.updateMany({
            where: {
              id,
              status: { in: [IdPhotoBatchStatus.PENDING, IdPhotoBatchStatus.PROCESSING] },
            },
            data: { status: IdPhotoBatchStatus.FAILED },
          });
        } catch (err: any) {
          this.logger.error(`[id-photo batch reconcile] job ${id} lỗi: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[id-photo batch reconcile] lỗi: ${err?.message}`);
    } finally {
      this.reconcileRunning = false;
    }
  }
}

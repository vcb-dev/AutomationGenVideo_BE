import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IdPhotoBatchStatus, IdPhotoStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdPhotoService } from './id-photo.service';
import { IdPhotoBatchWorker } from './id-photo-batch.worker';
import { CreateIdPhotoBatchDto, ID_PHOTO_BATCH_MAX_PEOPLE } from './dto/create-id-photo-batch.dto';

/**
 * "Tạo ảnh thẻ hàng loạt" — tầng điều phối: tạo job cha + N item con, poll trạng thái, thử lại
 * 1 người lỗi. Việc gọi AI ghép áo tuần tự nằm ở IdPhotoBatchWorker.
 *
 * Phân quyền giữ nguyên RolesGuard trên IdPhotoController (LEADER/ADMIN) — không đổi. Không
 * giới hạn theo người tạo khi poll/thử lại, nhất quán với tab Lịch sử đơn lẻ (mọi leader/admin
 * xem chung, xem ghi chú trong IdPhotoController).
 */
@Injectable()
export class IdPhotoBatchService {
  private readonly logger = new Logger(IdPhotoBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idPhotoService: IdPhotoService,
    private readonly worker: IdPhotoBatchWorker,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // POST /id-photo/batch — tạo job, trả batchJobId NGAY, không chờ xử lý
  // ═══════════════════════════════════════════════════════════════

  async createBatch(userId: string, dto: CreateIdPhotoBatchDto) {
    const people = dto.people ?? [];

    // Chặn cứng ở BE — không tin FE đã chặn (DTO ArrayMaxSize là lớp 1, đây là lớp 2).
    if (people.length === 0) {
      throw new BadRequestException('Danh sách người tạo ảnh thẻ đang trống.');
    }
    if (people.length > ID_PHOTO_BATCH_MAX_PEOPLE) {
      throw new BadRequestException(
        `Tối đa ${ID_PHOTO_BATCH_MAX_PEOPLE} người mỗi lần tạo hàng loạt (đang gửi ${people.length}).`,
      );
    }

    // Rút hết ảnh gốc ra khỏi bộ nhớ tạm TRƯỚC khi ghi DB — nếu 1 uploadId hết hạn/sai thì
    // hỏng sớm, chưa tạo bản ghi nào. Ảnh được ghi thẳng vào item con nên worker không phụ
    // thuộc bộ nhớ tạm (vốn per-instance + TTL 30') lúc chạy nền.
    const rawImages: string[] = [];
    for (let i = 0; i < people.length; i++) {
      try {
        rawImages.push(this.idPhotoService.consumeRawImageForBatch(people[i].uploadId));
      } catch (err: any) {
        throw new BadRequestException(
          `Ảnh của người thứ ${i + 1} (${people[i].employeeName}) không dùng được: ${err?.message ?? 'uploadId không hợp lệ'}`,
        );
      }
    }

    const batch = await this.prisma.idPhotoBatchJob.create({
      data: {
        created_by: userId,
        total_count: people.length,
        status: IdPhotoBatchStatus.PENDING,
      },
    });

    // Tạo item con TUẦN TỰ (không createMany / không transaction): mỗi dòng gánh 1 ảnh gốc
    // base64 ~13MB, gộp 20 dòng vào một câu INSERT là ~260MB trong một query — sequential giữ
    // bộ nhớ trong tầm kiểm soát và GC dọn được giữa các dòng.
    try {
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        await this.prisma.idPhotoHistory.create({
          data: {
            created_by: userId,
            batch_job_id: batch.id,
            employee_name: p.employeeName.trim(),
            employee_team: p.employeeTeam.trim(),
            employee_id: p.employeeId.trim(),
            // [ĐÃ NGỪNG DÙNG] employee_title_prefix — không nhận/ghi nữa, cột để mặc định null.
            position: p.position,
            raw_image_data: rawImages[i],
            status: IdPhotoStatus.PENDING,
          },
        });
      }
    } catch (err: any) {
      this.logger.error(`[batch ${batch.id}] lỗi tạo item con: ${err?.message}`);
      await this.prisma.idPhotoBatchJob
        .update({ where: { id: batch.id }, data: { status: IdPhotoBatchStatus.FAILED } })
        .catch(() => undefined);
      throw new InternalServerErrorException('Không tạo được danh sách ảnh thẻ hàng loạt, vui lòng thử lại.');
    }

    this.worker.enqueue(batch.id);
    this.logger.log(`[batch ${batch.id}] tạo ${people.length} item con, đã đưa vào hàng đợi`);

    return { batchJobId: batch.id, totalCount: people.length, status: batch.status };
  }

  // ═══════════════════════════════════════════════════════════════
  // GET /id-photo/batch/:batchJobId — poll trạng thái job cha + từng người con
  // ═══════════════════════════════════════════════════════════════

  async getBatchStatus(batchJobId: string) {
    const batch = await this.prisma.idPhotoBatchJob.findUnique({ where: { id: batchJobId } });
    if (!batch) {
      throw new NotFoundException('Không tìm thấy job tạo ảnh thẻ hàng loạt này.');
    }

    // KHÔNG select raw_image_data/processed_image_data — mỗi field base64 vài MB, 20 người là
    // rất nặng. FE vẽ lưới chỉ cần status; muốn xem ảnh 1 người thì gọi GET /id-photo/:id.
    const items = await this.prisma.idPhotoHistory.findMany({
      where: { batch_job_id: batchJobId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        employee_name: true,
        employee_team: true,
        employee_id: true,
        // employee_title_prefix: [ĐÃ NGỪNG DÙNG] — không trả về API nữa
        position: true,
        status: true,
        error_message: true,
        pdf_url: true,
        // "Điều chỉnh vị trí ảnh trong khung tròn" — BẮT BUỘC có ở đây (không chỉ ở GET
        // /id-photo/:id): vòng poll GỌI LẠI getBatchStatus mỗi ~3.5s trong lúc batch còn chạy
        // và THAY THẾ TOÀN BỘ `batchStatus` ở FE (BulkTab#startPolling — onUpdate: setBatchStatus(r)).
        // Thiếu 3 field này thì bản vá crop vừa PATCH ở modal "Sửa thông tin thẻ" (optimistic
        // update local) sẽ bị NHỮNG TICK POLL SAU đè mất, lưới kết quả lại hiện ảnh CHƯA crop.
        crop_offset_x: true,
        crop_offset_y: true,
        crop_scale: true,
        created_at: true,
        updated_at: true,
      },
    });

    const counts = {
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
    };
    for (const it of items) {
      if (it.status === IdPhotoStatus.PENDING) counts.pending++;
      else if (it.status === IdPhotoStatus.PROCESSING) counts.processing++;
      else if (it.status === IdPhotoStatus.SUCCESS) counts.success++;
      else if (it.status === IdPhotoStatus.FAILED) counts.failed++;
    }

    return {
      id: batch.id,
      status: batch.status,
      totalCount: batch.total_count,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      counts,
      people: items,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // POST /id-photo/batch/:batchJobId/export-pdf — xuất 1 file PDF GỘP N trang
  //   (mỗi người SUCCESS 1 trang, khổ CR80). Bỏ qua người FAILED / chưa có ảnh.
  // ═══════════════════════════════════════════════════════════════

  /** Cắt sớm 1 promise DB nếu quá `ms` — trả lỗi đọc được thay vì để request treo. */
  private async withDbTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new InternalServerErrorException(`${what} (>${Math.round(ms / 1000)}s). Vui lòng thử lại.`)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async exportBatchPdf(batchJobId: string): Promise<{ buffer: Buffer; exported: number; total: number; skipped: number }> {
    const batch = await this.prisma.idPhotoBatchJob.findUnique({ where: { id: batchJobId } });
    if (!batch) {
      throw new NotFoundException('Không tìm thấy job tạo ảnh thẻ hàng loạt này.');
    }

    // Chỉ lấy người ĐÃ có ảnh thẻ hoàn chỉnh; đúng thứ tự tạo (khớp thứ tự lưới ở FE).
    // 1 findMany kéo cả cụm ảnh base64 (mỗi ảnh ~2MB) — chậm qua pooler Supabase (đo thật 5 ảnh
    // ~9MB mất 8-30s), nhưng chia nhỏ song song còn CHẬM HƠN (pooler transaction-mode thrash).
    // `withDbTimeout` cắt sớm để trả lỗi rõ + cho thử lại, không treo vô hạn.
    const rows = await this.withDbTimeout(
      this.prisma.idPhotoHistory.findMany({
        where: { batch_job_id: batchJobId, status: IdPhotoStatus.SUCCESS, processed_image_data: { not: null } },
        orderBy: { created_at: 'asc' },
        select: {
          employee_name: true,
          employee_team: true,
          employee_id: true,
          position: true,
          processed_image_data: true,
          crop_offset_x: true,
          crop_offset_y: true,
          crop_scale: true,
        },
      }),
      90_000,
      'Tải ảnh của batch từ cơ sở dữ liệu quá lâu',
    );

    if (rows.length === 0) {
      throw new BadRequestException('Chưa có ảnh thẻ nào thành công trong batch này để xuất PDF.');
    }

    const buffer = await this.idPhotoService.buildBatchPdfBuffer(rows);
    return {
      buffer,
      exported: rows.length,
      total: batch.total_count,
      skipped: Math.max(0, batch.total_count - rows.length),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // POST /id-photo/batch/:batchJobId/retry/:historyId   — chạy lại 1 người LỖI (FAILED)
  // POST /id-photo/batch/:batchJobId/remerge/:historyId — GHÉP ÁO LẠI cho 1 người đã SUCCESS
  //   (AI ghép ra ảnh không ưng ý: đỉnh đầu bị cắt… — không phải lỗi kỹ thuật). TỐN 1 lượt
  //   Gemini, FE bắt xác nhận 2 lần trước khi gọi (giống nút "Ghép áo lại" luồng đơn lẻ).
  //
  // Cả hai đi CÙNG một đường: đặt người đó về PENDING → worker tự nhặt, chạy lại ĐỦ bước
  // (ghép áo từ raw_image_data → ghép khung + exportPdf → SUCCESS). Nhờ đi qua worker nên vẫn
  // TUẦN TỰ + giữ khoảng nghỉ giữa các lượt Gemini + pdf_url được dựng lại từ ảnh MỚI, và các
  // người khác trong batch không bị đụng tới.
  // ═══════════════════════════════════════════════════════════════

  async retryPerson(batchJobId: string, historyId: string) {
    return this.requeuePerson(batchJobId, historyId, 'retry');
  }

  async remergePerson(batchJobId: string, historyId: string) {
    return this.requeuePerson(batchJobId, historyId, 'remerge');
  }

  private async requeuePerson(batchJobId: string, historyId: string, mode: 'retry' | 'remerge') {
    const batch = await this.prisma.idPhotoBatchJob.findUnique({ where: { id: batchJobId } });
    if (!batch) {
      throw new NotFoundException('Không tìm thấy job tạo ảnh thẻ hàng loạt này.');
    }

    const person = await this.prisma.idPhotoHistory.findUnique({ where: { id: historyId } });
    if (!person || person.batch_job_id !== batchJobId) {
      throw new NotFoundException('Không tìm thấy người này trong job hàng loạt.');
    }
    if (person.status === IdPhotoStatus.PENDING || person.status === IdPhotoStatus.PROCESSING) {
      throw new BadRequestException('Người này đang chờ/đang xử lý — vui lòng đợi xong đã.');
    }
    if (mode === 'retry' && person.status !== IdPhotoStatus.FAILED) {
      throw new BadRequestException('Chỉ thử lại được người đang ở trạng thái lỗi (FAILED).');
    }
    if (mode === 'remerge' && person.status !== IdPhotoStatus.SUCCESS) {
      throw new BadRequestException('Chỉ ghép áo lại được cho người đã tạo xong (SUCCESS).');
    }
    if (!person.raw_image_data) {
      throw new BadRequestException('Bản ghi này không còn ảnh gốc, không thể ghép áo lại.');
    }

    // Đặt lại người này về PENDING (xoá ảnh + pdf cũ) + kéo job cha về PROCESSING (heartbeat
    // tươi để cron reconcile không nhầm là treo), rồi đẩy job cha vào hàng đợi. Worker chỉ nhặt
    // item PENDING nên chỉ đúng người này chạy lại, các người khác giữ nguyên.
    //
    // Reset CẢ "Điều chỉnh vị trí ảnh trong khung tròn" (crop_offset_x/y/scale) về NULL: ảnh
    // ghép áo mới (retry lẫn remerge đều gọi lại Gemini) có bố cục khác ảnh cũ, giữ crop cũ dễ
    // ra kết quả sai — cùng lý do với luồng đơn lẻ, xem IdPhotoService#remergeOutfit.
    await this.prisma.idPhotoHistory.update({
      where: { id: historyId },
      data: {
        status: IdPhotoStatus.PENDING,
        error_message: null,
        processed_image_data: null,
        pdf_url: null,
        crop_offset_x: null,
        crop_offset_y: null,
        crop_scale: null,
      },
    });
    await this.prisma.idPhotoBatchJob.update({
      where: { id: batchJobId },
      data: { status: IdPhotoBatchStatus.PROCESSING },
    });

    this.worker.enqueue(batchJobId);
    this.logger.log(`[batch ${batchJobId}] ${mode} người ${historyId} → PENDING, đã đẩy worker`);

    return { batchJobId, historyId, status: IdPhotoStatus.PENDING };
  }
}

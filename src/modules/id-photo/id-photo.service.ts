import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as PDFDocument from 'pdfkit';
import { IdPhotoPosition, IdPhotoStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';
import { registerVietnameseFonts } from '../../common/pdf/pdf-fonts';
import { CreateIdPhotoDto } from './dto/create-id-photo.dto';
import { UpdateIdPhotoDto } from './dto/update-id-photo.dto';
import { IdPhotoHistoryQueryDto } from './dto/id-photo-history-query.dto';

/**
 * Ảnh gốc/ảnh đã ghép áo đi qua 3 bước upload → merge-outfit → create trước khi có 1 record
 * DB thật. Giữa các bước đó ảnh chỉ tồn tại tạm ở BE, tra bằng `uploadId` — KHÔNG gửi base64
 * qua lại nhiều lần trong body JSON (ảnh 10MB base64 ra ~13.3MB, vượt xa giới hạn body JSON
 * 2mb đặt ở main.ts cho các endpoint khác) và cũng không cần depend Google Drive/S3 chỉ để
 * làm module này chạy được — module tự chứa hoàn toàn.
 *
 * In-memory, 1 instance — cùng giả định với contentTransformRateLimitHits ở AiIntegrationService:
 * chưa cần Redis vì hiện chạy 1 instance. Nếu scale nhiều instance sau này, bước upload/merge
 * phải rơi đúng instance đã lưu buffer — cần thay bằng store dùng chung (Redis) khi đó.
 */
interface IdPhotoTempEntry {
  rawBuffer: Buffer;
  rawMimeType: string;
  rawFileName: string;
  processedBuffer?: Buffer;
  processedMimeType?: string;
  createdAt: number;
}

@Injectable()
export class IdPhotoService {
  private readonly logger = new Logger(IdPhotoService.name);
  private readonly aiServiceUrl: string;

  /** Ảnh gen bằng Gemini thường mất 10-30s; cho dư biên 90s để tránh timeout giả lúc AI service
   * tải cao — ngắn hơn nhiều so với timeout viết kịch bản (120s) vì đây chỉ 1 lượt gọi ảnh,
   * không phải LLM reasoning dài như content-transform (xem writeContentTransformWithRetry). */
  private readonly MERGE_OUTFIT_TIMEOUT_MS = 90_000;

  /** TTL cho ảnh lưu tạm giữa các bước upload/merge-outfit/create — đủ dài cho 1 lượt thao tác
   * bình thường trên form, dọn định kỳ để tránh rò rỉ bộ nhớ khi người dùng upload rồi bỏ dở. */
  private readonly TEMP_TTL_MS = 30 * 60 * 1000;

  private readonly tempStore = new Map<string, IdPhotoTempEntry>();

  /** Ánh xạ cấp bậc → màu khung khi xuất PDF — CHỈ dùng ở đây, KHÔNG lưu vào DB (xem
   * IdPhotoPosition trong schema.prisma) để đổi màu khung không cần migration.
   *
   * Thứ tự đúng do nghiệp vụ chốt: Trắng / Vàng / Xanh / Đỏ / Đen theo đúng thứ tự cấp bậc
   * liệt kê bên dưới. ĐỪNG suy ra mapping này từ dải màu trang trí trong mockup thiết kế —
   * đã từng đảo nhầm STAFF_OVER_3M ↔ LEADER vì đọc theo mockup, phải sửa lại sau khi test thật.
   * Bản sao ở FE: id-photo/components/constants.ts#POSITION_OPTIONS — sửa 1 bên phải sửa bên kia. */
  private static readonly FRAME_COLOR_BY_POSITION: Record<IdPhotoPosition, string> = {
    NEW_STAFF_1_3M: '#FFFFFF', // Trắng
    STAFF_OVER_3M: '#F5C518', // Vàng
    LEADER: '#2563EB', // Xanh
    MANAGER: '#DC2626', // Đỏ
    BOD: '#111827', // Đen
  };

  /** File ảnh nền khung thẻ theo cấp bậc. 5 file sinh từ CÙNG một ảnh gốc (biến thể navy)
   * bằng phép đổi màu xác định qua Sharp, nên hình dạng đồng bộ tuyệt đối giữa các màu.
   * Logo đã nằm sẵn trong ảnh (trắng cho 4 nền đậm, vàng cho nền sáng) — không vẽ logo riêng.
   *
   * ĐỪNG dán thêm assets/logo-vcb-*.png đè lên khung, dù ở runtime bằng doc.image hay bằng
   * cách sửa file ảnh: mỗi khung ĐÃ có sẵn đúng một logo tại x350..442, y35..121 (hệ toạ độ
   * ảnh 794×1264). card-frame-white.png từng bị dán logo-vcb-gold.png đè lên mà không xoá
   * logo trắng cũ bên dưới, lại lệch vị trí và sai tỉ lệ, nên PDF in ra hiện 2 chữ
   * "VIÊNCHIBAO" chồng nhau. Nền sáng làm logo trắng khó thấy thì cách sửa đúng là ĐỔI MÀU
   * logo ngay trong file khung, không phải thêm một lớp nữa. */
  private static readonly FRAME_FILE_BY_POSITION: Record<IdPhotoPosition, string> = {
    NEW_STAFF_1_3M: 'card-frame-white.png',
    STAFF_OVER_3M: 'card-frame-gold.png',
    LEADER: 'card-frame-navy.png',
    MANAGER: 'card-frame-red.png',
    BOD: 'card-frame-black.png',
  };

  private static readonly POSITION_LABEL: Record<IdPhotoPosition, string> = {
    NEW_STAFF_1_3M: 'Nhân viên mới (1-3 tháng)',
    STAFF_OVER_3M: 'Nhân viên chính thức',
    LEADER: 'Trưởng nhóm',
    MANAGER: 'Quản lý',
    BOD: 'Ban giám đốc',
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.aiServiceUrl = resolveAiServiceUrl(this.configService);
  }

  // ═══════════════════════════════════════════════════════════════
  // Bước 1 — upload ảnh gốc (validate JPG/PNG/10MB đã làm ở FileInterceptor trong controller)
  // ═══════════════════════════════════════════════════════════════

  uploadRawImage(file: Express.Multer.File) {
    this.sweepExpiredTempEntries();

    const uploadId = randomUUID();
    this.tempStore.set(uploadId, {
      rawBuffer: file.buffer,
      rawMimeType: file.mimetype,
      rawFileName: file.originalname,
      createdAt: Date.now(),
    });

    return {
      uploadId,
      previewImageData: this.toDataUri(file.buffer, file.mimetype),
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Bước 2 — gọi AI service (Gemini) ghép áo. KHÔNG gọi thẳng Gemini API — luôn qua Django,
  // đúng quy ước "BE chỉ orchestrate" đã dùng cho content-transform (callContentTransformAiService).
  // ═══════════════════════════════════════════════════════════════

  async mergeOutfit(uploadId: string) {
    const entry = this.getTempEntryOrThrow(uploadId);

    const processed = await this.callMergeOutfitAi(entry.rawBuffer, entry.rawMimeType, 'mergeOutfit');

    // Lưu đè vào cùng entry (giữ nguyên rawBuffer) — gia hạn createdAt để người dùng còn thời
    // gian bấm "Tạo" sau khi xem preview đã ghép áo mà không lo hết hạn giữa chừng.
    entry.processedBuffer = processed.buffer;
    entry.processedMimeType = processed.mimeType;
    entry.createdAt = Date.now();

    return {
      uploadId,
      processedImageData: this.toDataUri(processed.buffer, processed.mimeType),
    };
  }

  /**
   * Một lượt gọi AI service ghép áo. Tách riêng vì có ĐÚNG HAI nơi dùng và cả hai phải hành
   * xử giống hệt nhau (cùng timeout, cùng cách đổi lỗi HTTP): bước 2 của luồng tạo mới
   * (mergeOutfit, ảnh còn trong bộ nhớ tạm) và nút "Ghép áo lại" ở bước 4 (remergeOutfit, ảnh
   * gốc đọc từ DB). Trước đây logic này nằm inline trong mergeOutfit; nếu copy sang chỗ thứ
   * hai thì hai đường đi sẽ trôi lệch nhau theo thời gian.
   *
   * JSON body, không phải multipart — contract đã chốt với AI service (xem
   * video_management/views/id_photo_views.py#merge_outfit bên AutomationGenVideo_AI): AI
   * service gọi thẳng Gemini bằng inline base64 (không dùng Files API/polling vì ảnh chỉ
   * vài MB), nên không cần multipart form-data như transcribeContentUpload.
   */
  private async callMergeOutfitAi(
    rawBuffer: Buffer,
    rawMimeType: string,
    callerTag: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = `${this.aiServiceUrl}/api/ai/id-photo/merge-outfit/`;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            image_base64: rawBuffer.toString('base64'),
            mime_type: rawMimeType,
          },
          { timeout: this.MERGE_OUTFIT_TIMEOUT_MS },
        ),
      );

      if (!response.data?.success || !response.data?.processed_image_base64) {
        throw new HttpException(
          response.data?.error_message || 'AI service không trả về ảnh đã ghép áo',
          HttpStatus.BAD_GATEWAY,
        );
      }

      return {
        buffer: Buffer.from(response.data.processed_image_base64, 'base64'),
        // AI service luôn trả PNG (không có field mime_type riêng trong contract output) — xem
        // ghi chú trong id_photo_views.py#merge_outfit.
        mimeType: 'image/png',
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`[${callerTag}] Lỗi gọi AI service: ${err.message}`);
      const errMsg =
        err.response?.data?.error_message || err.response?.data?.error || err.message || 'Lỗi kết nối tới AI Service';
      throw new HttpException(errMsg, err.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Bước 3 — tạo record lịch sử với thông tin nhân viên nhập tay + ảnh đã ghép áo
  // ═══════════════════════════════════════════════════════════════

  async create(userId: string, dto: CreateIdPhotoDto) {
    const entry = this.getTempEntryOrThrow(dto.uploadId);
    if (!entry.processedBuffer || !entry.processedMimeType) {
      throw new BadRequestException('Ảnh này chưa được ghép áo — vui lòng gọi merge-outfit trước khi tạo bản ghi');
    }

    try {
      const history = await this.prisma.idPhotoHistory.create({
        data: {
          created_by: userId,
          employee_name: dto.employeeName.trim(),
          employee_team: dto.employeeTeam.trim(),
          employee_id: dto.employeeId.trim(),
          // Trống/chỉ khoảng trắng → lưu null để buildPdfBuffer bỏ hẳn phần tiền tố, tránh
          // in ra tên bị thừa dấu cách ở đầu.
          employee_title_prefix: dto.employeeTitlePrefix?.trim() || null,
          position: dto.position,
          raw_image_data: this.toDataUri(entry.rawBuffer, entry.rawMimeType),
          processed_image_data: this.toDataUri(entry.processedBuffer, entry.processedMimeType),
          status: IdPhotoStatus.SUCCESS,
        },
      });

      // Đã lưu vào DB — dọn bộ nhớ tạm ngay, tránh giữ ảnh 2 lần (RAM + DB) lâu hơn cần thiết.
      this.tempStore.delete(dto.uploadId);
      return history;
    } catch (err: any) {
      this.logger.error(`[create] Lỗi tạo IdPhotoHistory: ${err.message}`);
      throw new InternalServerErrorException('Không tạo được bản ghi ảnh thẻ, vui lòng thử lại');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Bước 4 — xuất PDF theo khung màu ánh xạ từ position
  //
  // KHÔNG ghi file PDF ra đĩa: comment ở streamTtsAudioFromAi (ai-integration.service.ts) đã
  // cảnh báo disk local không dùng chung được giữa nhiều instance (Railway nhiều replica,
  // không volume chung) — ghi lúc export rồi đọc lại lúc tải gần như luôn 404 nếu 2 request rơi
  // khác instance. Vì toàn bộ dữ liệu cần để dựng PDF (processed_image_data + thông tin nhân
  // viên) đã nằm sẵn trong DB, PDF được RENDER LẠI TỪ ĐẦU (deterministic) ở mỗi lần GET
  // pdf-file — export-pdf chỉ cần build thử 1 lần để báo lỗi sớm rồi lưu pdf_url là 1 route
  // cố định, không phụ thuộc instance nào ghi file.
  // ═══════════════════════════════════════════════════════════════

  async exportPdf(id: string) {
    const history = await this.findHistoryOrThrow(id);
    // Render thử ngay để trả lỗi sớm nếu processed_image_data hỏng, thay vì chỉ phát hiện lúc
    // FE tải file qua getPdfBuffer().
    await this.buildPdfBuffer(history);

    const pdfUrl = `/id-photo/${id}/pdf-file`;
    const updated = await this.prisma.idPhotoHistory.update({
      where: { id },
      data: { pdf_url: pdfUrl },
    });
    return { pdfUrl: updated.pdf_url };
  }

  async getPdfBuffer(id: string): Promise<Buffer> {
    const history = await this.findHistoryOrThrow(id);
    return this.buildPdfBuffer(history);
  }

  // ═══════════════════════════════════════════════════════════════
  // Sửa lại sau khi đã tạo (vẫn đang đứng ở bước 4) — hai đường đi TÁCH BẠCH theo chi phí:
  //
  //   update()         → sửa CHỮ (tên/team/ID/tiền tố/cấp bậc). MIỄN PHÍ, không đụng tới AI:
  //                      ảnh không đổi nên PDF chỉ cần dựng lại từ processed_image_data đã lưu.
  //   remergeOutfit()  → ghép lại ẢNH. TỐN 1 lượt Gemini, nên phải là hành động riêng người
  //                      dùng chủ động bấm, không bao giờ chạy kèm theo lúc sửa chữ.
  //
  // Trước đây bước 4 chỉ có "Xuất PDF" và "Làm lại từ đầu", nên gõ sai một chữ cũng phải làm
  // lại cả luồng và tốn oan 1 lượt Gemini — chính là lý do hai hàm này tồn tại.
  // ═══════════════════════════════════════════════════════════════

  /**
   * PATCH /id-photo/:id — sửa thông tin in trên thẻ. KHÔNG gọi lại Gemini.
   *
   * Dựng thử PDF ngay sau khi cập nhật (cùng lý do với exportPdf): báo lỗi tại chỗ nếu dữ liệu
   * mới làm hỏng bản dựng, thay vì để người dùng phát hiện lúc bấm tải file.
   */
  async update(id: string, dto: UpdateIdPhotoDto) {
    const history = await this.findHistoryOrThrow(id);

    const data: Prisma.IdPhotoHistoryUpdateInput = {};
    if (dto.employeeName !== undefined) data.employee_name = dto.employeeName.trim();
    if (dto.employeeTeam !== undefined) data.employee_team = dto.employeeTeam.trim();
    if (dto.employeeId !== undefined) data.employee_id = dto.employeeId.trim();
    // Gửi chuỗi rỗng = chủ ý XOÁ tiền tố → null, để buildPdfBuffer bỏ hẳn phần tiền tố thay vì
    // in tên thừa dấu cách ở đầu (cùng quy ước với create()).
    if (dto.employeeTitlePrefix !== undefined) data.employee_title_prefix = dto.employeeTitlePrefix.trim() || null;
    if (dto.position !== undefined) data.position = dto.position;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Không có thông tin nào được gửi lên để cập nhật');
    }

    // Dựng thử với dữ liệu SAU khi sửa trước khi ghi DB — nếu bản dựng hỏng thì bản ghi cũ
    // vẫn còn nguyên vẹn và vẫn xuất được PDF, thay vì hỏng hẳn.
    await this.buildPdfBuffer({
      employee_name: (data.employee_name as string) ?? history.employee_name,
      employee_team: (data.employee_team as string) ?? history.employee_team,
      employee_id: (data.employee_id as string) ?? history.employee_id,
      employee_title_prefix:
        dto.employeeTitlePrefix !== undefined
          ? (data.employee_title_prefix as string | null)
          : history.employee_title_prefix,
      position: (data.position as IdPhotoPosition) ?? history.position,
      processed_image_data: history.processed_image_data,
    });

    const updated = await this.prisma.idPhotoHistory.update({
      where: { id },
      data,
      // KHÔNG trả raw_image_data/processed_image_data: ảnh không đổi ở đường đi này nên FE đã
      // có sẵn để hiện preview, gửi thêm vài MB base64 về chỉ tổ nặng response.
      select: {
        id: true,
        employee_name: true,
        employee_team: true,
        employee_id: true,
        employee_title_prefix: true,
        position: true,
        status: true,
        pdf_url: true,
        updated_at: true,
      },
    });
    return updated;
  }

  /**
   * POST /id-photo/:id/remerge-outfit — ghép áo LẠI cho bản ghi đã tạo, dùng đúng ảnh gốc
   * `raw_image_data` đã lưu trong DB (không cần người dùng upload lại).
   *
   * Dành cho trường hợp ảnh Gemini trả về bị lỗi bố cục (hay gặp nhất: đỉnh đầu bị cắt) — kết
   * quả sinh ảnh vốn không ổn định, gọi lại cùng một ảnh gốc thường ra bố cục khác.
   *
   * CÓ TỐN CHI PHÍ: đúng 1 lượt Gemini mỗi lần bấm. FE bắt buộc phải cảnh báo trước khi gọi.
   *
   * Ảnh mới được ghi thẳng vào DB ở đây thay vì trả về cho FE PATCH ngược lên: ảnh base64 vài
   * MB sẽ vượt giới hạn body JSON 2mb đặt ở main.ts — cùng lý do khiến luồng upload/merge ban
   * đầu phải đi qua `uploadId` chứ không gửi base64 qua lại (xem ghi chú đầu file).
   */
  async remergeOutfit(id: string) {
    const history = await this.prisma.idPhotoHistory.findUnique({ where: { id } });
    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi ảnh thẻ');
    }
    // Khác findHistoryOrThrow: ở đây cần ẢNH GỐC chứ không cần ảnh đã ghép — bản ghi có
    // processed_image_data lỗi/null vẫn phải ghép lại được, đó chính là lý do người dùng bấm nút này.
    if (!history.raw_image_data) {
      throw new BadRequestException('Bản ghi này không còn ảnh gốc, không thể ghép áo lại');
    }

    const { buffer: rawBuffer, mimeType: rawMimeType } = this.parseDataUri(history.raw_image_data);
    const processed = await this.callMergeOutfitAi(rawBuffer, rawMimeType, 'remergeOutfit');
    const processedImageData = this.toDataUri(processed.buffer, processed.mimeType);

    // Dựng thử PDF với ảnh MỚI trước khi ghi đè — ảnh cũ (dù xấu) vẫn còn dùng được nếu ảnh
    // mới không dựng nổi thành PDF.
    await this.buildPdfBuffer({
      employee_name: history.employee_name,
      employee_team: history.employee_team,
      employee_id: history.employee_id,
      employee_title_prefix: history.employee_title_prefix,
      position: history.position,
      processed_image_data: processedImageData,
    });

    const updated = await this.prisma.idPhotoHistory.update({
      where: { id },
      data: { processed_image_data: processedImageData, status: IdPhotoStatus.SUCCESS, error_message: null },
      select: { id: true, pdf_url: true, updated_at: true },
    });

    return { ...updated, processedImageData };
  }

  // ═══════════════════════════════════════════════════════════════
  // Lịch sử — không giới hạn theo team/người tạo (guard đã chặn ở role LEADER/ADMIN rồi, xem
  // IdPhotoController), mọi leader/admin xem chung 1 danh sách.
  // ═══════════════════════════════════════════════════════════════

  async getHistory(query: IdPhotoHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.IdPhotoHistoryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.position ? { position: query.position } : {}),
      ...(query.search
        ? {
            OR: [
              { employee_name: { contains: query.search, mode: 'insensitive' } },
              { employee_id: { contains: query.search, mode: 'insensitive' } },
              { employee_team: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.idPhotoHistory.count({ where }),
      this.prisma.idPhotoHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // KHÔNG select raw_image_data/processed_image_data — mỗi field base64 có thể nặng vài
        // MB, chọn hết cho 1 danh sách phân trang sẽ rất nặng. Chi tiết ảnh xem riêng qua PDF.
        select: {
          id: true,
          created_by: true,
          employee_name: true,
          employee_team: true,
          employee_id: true,
          employee_title_prefix: true,
          position: true,
          status: true,
          error_message: true,
          pdf_url: true,
          created_at: true,
          updated_at: true,
          createdByUser: { select: { id: true, full_name: true, email: true } },
        },
      }),
    ]);

    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Chi tiết MỘT bản ghi — phục vụ modal "Xem chi tiết" ở tab Lịch sử.
   *
   * Khác getHistory ở đúng một chỗ: CÓ kèm processed_image_data, để FE dựng lại khung thẻ ngay
   * trong modal thay vì phải tải PDF về mới nhìn được (mỗi lần tải là thêm một lượt BE render
   * PDF). Vẫn KHÔNG trả raw_image_data — ảnh gốc tới 10MB, base64 hoá thành ~13MB, mà modal
   * không dùng đến nó.
   *
   * CỐ Ý không dùng findHistoryOrThrow: hàm đó chặn luôn bản ghi chưa có ảnh ghép, trong khi
   * đúng những bản ghi FAILED ấy mới là thứ người dùng cần mở ra để đọc error_message.
   */
  async getDetail(id: string) {
    const history = await this.prisma.idPhotoHistory.findUnique({
      where: { id },
      select: {
        id: true,
        created_by: true,
        employee_name: true,
        employee_team: true,
        employee_id: true,
        employee_title_prefix: true,
        position: true,
        status: true,
        error_message: true,
        pdf_url: true,
        processed_image_data: true,
        created_at: true,
        updated_at: true,
        createdByUser: { select: { id: true, full_name: true, email: true } },
      },
    });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi ảnh thẻ');
    }
    return history;
  }

  /**
   * Xoá hẳn một bản ghi. HARD delete có chủ đích: schema không có cột soft-delete, và mục đích
   * chính của nút xoá là GIẢI PHÓNG dung lượng — mỗi bản ghi giữ 2 ảnh base64 trong cột Text
   * (riêng ảnh gốc đã tới 10MB), đánh dấu xoá mềm thì dung lượng vẫn nằm nguyên đó.
   *
   * Phân quyền HẸP HƠN phần xem: tab Lịch sử cho LEADER xem mọi bản ghi (không giới hạn team,
   * xem ghi chú ở IdPhotoController), nhưng xoá là thao tác không hoàn tác được nên LEADER chỉ
   * xoá được bản ghi do chính mình tạo; ADMIN xoá được tất cả để còn dọn dữ liệu rác.
   */
  async remove(id: string, actor: { id: string; roles?: UserRole[] }) {
    const history = await this.prisma.idPhotoHistory.findUnique({
      where: { id },
      select: { id: true, created_by: true, employee_name: true },
    });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi ảnh thẻ');
    }

    const isAdmin = actor.roles?.includes(UserRole.ADMIN) ?? false;
    if (!isAdmin && history.created_by !== actor.id) {
      throw new ForbiddenException('Bạn chỉ xoá được ảnh thẻ do chính mình tạo');
    }

    await this.prisma.idPhotoHistory.delete({ where: { id } });
    this.logger.log(`Đã xoá bản ghi ảnh thẻ ${id} (${history.employee_name}) — người xoá: ${actor.id}`);

    return { id, deleted: true };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async findHistoryOrThrow(id: string) {
    const history = await this.prisma.idPhotoHistory.findUnique({ where: { id } });
    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi ảnh thẻ');
    }
    if (!history.processed_image_data) {
      throw new BadRequestException('Bản ghi này chưa có ảnh đã ghép áo, không thể xuất PDF');
    }
    return history;
  }

  private getTempEntryOrThrow(uploadId: string): IdPhotoTempEntry {
    this.sweepExpiredTempEntries();
    const entry = this.tempStore.get(uploadId);
    if (!entry) {
      throw new BadRequestException(
        'Không tìm thấy ảnh tạm ứng với uploadId này — có thể đã hết hạn (30 phút) hoặc chưa upload, vui lòng upload lại',
      );
    }
    return entry;
  }

  private sweepExpiredTempEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.tempStore) {
      if (now - entry.createdAt > this.TEMP_TTL_MS) {
        this.tempStore.delete(key);
      }
    }
  }

  private toDataUri(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  /**
   * Font Unicode cho PDF ảnh thẻ — đọc file đã commit sẵn trong `assets/fonts/`, KHÔNG dò
   * font của hệ điều hành nữa (image production `node:20-alpine` không có font nào, nên bản
   * cũ luôn rơi về Helvetica và tên có dấu như "Nguyễn" in ra ký tự rác). Thiếu file font thì
   * ném lỗi luôn thay vì xuất PDF sai âm thầm — chi tiết ở common/pdf/pdf-fonts.ts.
   */
  private resolvePdfFonts(doc: any): { regular: string; bold: string } {
    return registerVietnameseFonts(doc);
  }

  /** Ảnh nền khung thẻ theo cấp bậc (assets/card-frame-*.png). Thiếu file thì trả null và
   * buildPdfBuffer tự lùi về nền phẳng — vẫn ra PDF đọc được thay vì ném lỗi. */
  private resolveFramePath(position: IdPhotoPosition): string | null {
    const p = path.join(process.cwd(), 'assets', IdPhotoService.FRAME_FILE_BY_POSITION[position]);
    if (fs.existsSync(p)) return p;
    this.logger.warn(`Không tìm thấy ảnh khung tại ${p} — PDF ảnh thẻ sẽ dùng nền phẳng`);
    return null;
  }

  /**
   * Toạ độ các phần tử đặt ĐÈ lên ảnh nền, trong hệ 420×669 của trang PDF.
   *
   * Đo bằng script quét pixel trên chính file `card-frame-navy.png` sau khi crop (794×1264),
   * rồi nhân hệ số 420/794 — KHÔNG ước lượng bằng mắt. Khung tròn thực tế hơi bầu dục
   * (rx=161, ry=168 px ảnh) nên lấy bán kính theo cạnh NGẮN để ảnh chân dung nằm trọn bên trong.
   *
   * Bản trước dựng toàn bộ khung bằng bezier (hằng số CARD_GEOMETRY, đã bỏ) — nay khung là ảnh
   * PNG thật nên không còn sai số hình học; xem lịch sử git nếu cần đối chiếu bản cũ.
   *
   * BẢN SAO Ở FE: ExportStep.tsx#CARD_LAYOUT — sửa 1 bên phải sửa bên kia.
   */
  static readonly CARD_LAYOUT = {
    circleCx: 209.2,
    circleCy: 183.3,
    circleR: 85.2,
    /** Y bắt đầu dòng họ tên (đáy khung tròn ở 271.9, đỉnh cụm sao ở 508.9 — text nằm giữa). */
    nameY: 392,
    nameFontSize: 30,
    teamIdY: 458,
    teamIdFontSize: 17,
    /** Cụm 6 sao đã có sẵn trong ảnh nền; text tuyệt đối không được tràn xuống dưới mốc này. */
    starTopY: 508.9,
  };

  private parseDataUri(dataUri: string): { buffer: Buffer; mimeType: string } {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUri);
    if (!match) {
      throw new InternalServerErrorException('Dữ liệu ảnh lưu trong hệ thống bị sai định dạng');
    }
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }

  /**
   * Vẽ 1 trang PDF theo ĐÚNG bố cục thẻ nhân viên thật của công ty (mẫu thẻ khung vàng):
   *
   *   ┌──────────────────┐  nền = màu cấp bậc (FRAME_COLOR_BY_POSITION)
   *   │   [logo sen]     │  vùng TRẮNG hình khiên: 2 cạnh thẳng đứng, đáy bo cung tròn
   *   │   ( ảnh tròn )   │  ảnh chân dung cắt tròn, nằm trong khiên
   *   │   HỌ VÀ TÊN      │  chữ trắng, in hoa, đậm
   *   │ Team: x  ID: y   │  chữ trắng, CÙNG một dòng như mẫu thật
   *   │   ☆ ☆ ☆ ☆        │  6 sao rỗng: 4 trên + 2 dưới (placeholder cố định)
   *   │    ☆ ☆           │
   *   └──────────────────┘  cung tròn trắng ở đáy
   *
   * Khác bản trước (bố cục tạm theo mockup Stitch): trước đây chỉ là khung viền chữ nhật +
   * ảnh vuông + 3 dòng chữ đen trên nền trắng, không có logo/khiên/sao và không thể hiện
   * được màu cấp bậc.
   */
  private buildPdfBuffer(history: {
    employee_name: string;
    employee_team: string;
    employee_id: string;
    employee_title_prefix?: string | null;
    position: IdPhotoPosition;
    processed_image_data: string | null;
  }): Promise<Buffer> {
    const { buffer: imageBuffer } = this.parseDataUri(history.processed_image_data!);
    const bgColor = IdPhotoService.FRAME_COLOR_BY_POSITION[history.position];
    // Thẻ nền Trắng: chữ trắng trên nền trắng sẽ mất hút — đổi sang chữ tối và thêm viền ngoài.
    const isLightBg = bgColor.toUpperCase() === '#FFFFFF';
    const textColor = isLightBg ? '#1F2937' : '#FFFFFF';

    return new Promise((resolve, reject) => {
      try {
        // Tỉ lệ thẻ nhựa CR80 dựng đứng (54 × 86 mm) — in ra đúng khổ thẻ thật.
        const W = 420;
        const H = 669;
        const doc = new (PDFDocument as any)({ size: [W, H], margin: 0 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { regular, bold } = this.resolvePdfFonts(doc);

        const L = IdPhotoService.CARD_LAYOUT;

        // ── Nền thẻ = ẢNH KHUNG THẬT phủ kín trang ────────────────────────────
        // Thay cho bản trước dựng khung bằng bezier: ảnh đã có sẵn dải ruy băng, đường cong
        // lõm, logo và 6 sao nên không còn sai số hình học, và 5 màu đồng bộ tuyệt đối.
        // Lót nền trắng trước: ảnh khung có 4 góc bo TRONG SUỐT, không lót thì 4 góc PDF bị
        // rỗng (khi in hoặc xem trên nền tối sẽ lộ ra), thay vì trắng như thẻ thật.
        doc.rect(0, 0, W, H).fill('#FFFFFF');

        const framePath = this.resolveFramePath(history.position);
        if (framePath) {
          doc.image(framePath, 0, 0, { width: W, height: H });
        } else {
          // Thiếu file khung thì vẫn phải ra được PDF đọc được — nền phẳng theo màu cấp bậc.
          doc.rect(0, 0, W, H).fill(bgColor);
        }

        // ── Ảnh chân dung cắt tròn, đặt đúng khung tròn rỗng của ảnh nền ──────
        doc.save();
        doc.circle(L.circleCx, L.circleCy, L.circleR).clip();
        // cover: lấp đầy hình tròn, không méo ảnh
        doc.image(imageBuffer, L.circleCx - L.circleR, L.circleCy - L.circleR, {
          cover: [L.circleR * 2, L.circleR * 2],
          align: 'center',
          valign: 'center',
        });
        doc.restore();

        // ── Họ tên: in hoa, đậm, căn giữa. Có tiền tố chức danh thì ghép "HĐ. TÊN" ──
        const prefix = (history.employee_title_prefix || '').trim();
        const displayName = `${prefix ? prefix + ' ' : ''}${(history.employee_name || '').trim()}`.toUpperCase();
        const textW = W - 48;
        // Auto-scale: thu nhỏ dần cho tới khi tên vừa ĐÚNG 1 dòng, tránh tên dài xuống dòng
        // và đè lên dòng Team/ID hoặc cụm sao có sẵn trong ảnh nền.
        let nameSize = L.nameFontSize;
        doc.font(bold);
        while (nameSize > 14 && doc.fontSize(nameSize).widthOfString(displayName) > textW) {
          nameSize -= 1;
        }
        doc.fontSize(nameSize).fillColor(textColor);
        doc.text(displayName, 24, L.nameY, { width: textW, align: 'center', lineBreak: false });

        // ── Team + ID trên CÙNG một dòng (đúng mẫu thật) ──────────────────────
        const teamIdText = `Team: ${history.employee_team}    ID: ${history.employee_id}`;
        let teamSize = L.teamIdFontSize;
        doc.font(regular);
        while (teamSize > 10 && doc.fontSize(teamSize).widthOfString(teamIdText) > textW) {
          teamSize -= 1;
        }
        doc.fontSize(teamSize).fillColor(textColor);
        doc.text(teamIdText, 24, L.teamIdY, { width: textW, align: 'center', lineBreak: false });

        // 6 sao KHÔNG vẽ ở đây nữa — đã có sẵn trong ảnh nền (bắt đầu từ y≈L.starTopY).

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

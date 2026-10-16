import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom } from 'rxjs';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';
import { ProductImageGenerationsService } from './product-image-generations.service';
import { ProductImageTrainingArchiveService } from './product-image-training-archive.service';
import { HELD_WIDTH_CM_MAX, HELD_WIDTH_CM_MIN } from './dto/held-auto.dto';
import { AiFormFields, aiImage, buildAiForm } from './product-image-ai-form.util';
import {
  AiUsage,
  CUTOUT_FAILED_FREE,
  GENERATION_STATUS,
  GenerationCost,
  HELD_SWAP_FAILED_FREE,
  PRODUCT_IMAGE_MODE,
  ProductImageMode,
  UNKNOWN_COST,
  USD_VND_RATE_ENV,
  aiUsageOf,
  attachAiUsage,
  costFromAiUsage,
  tryParseUsdVndRate,
  usageFromAxiosError,
} from './product-image-cost.util';

/**
 * Kết quả bước nhận diện SP khi tách nền (AI service trả về) — model tự huấn luyện chạy trên AI, 0đ.
 * "skipped": model chưa chắc nên chưa cắt phần dính liền túi — FE cảnh báo có thể còn dính giá đỡ/đạo cụ.
 */
export type CutoutDetection =
  | { status: 'applied'; source: 'model'; props_removed: number; model_reasons?: string[] }
  | { status: 'skipped'; source: 'model'; reason: string; model_reasons?: string[] };

export interface ProductImageUser {
  id: string;
  email?: string | null;
}

/**
 * Tạo ảnh cho sản phẩm MỚI chưa về hàng (media chưa chụp được) — 2 chế độ:
 *
 * - Ghép background (0đ): AI service tách nền ảnh SP bằng rembg, trả PNG trong suốt; FE tự dán
 *   lên ảnh phòng bằng canvas để người dùng kéo/thu phóng và xem trước đúng ảnh xuất ra.
 * - Chị Nhạm cầm SP (tính phí Gemini mỗi lượt): AI service đưa ảnh chị Nhạm đang cầm SP cũ +
 *   ảnh SP mới cho Gemini thay SP.
 * - Đặt SP vào cảnh (tính phí Gemini mỗi lượt, tab "Tạo hàng loạt"): Gemini tự tách SP, đặt lên
 *   ảnh cảnh, khớp ánh sáng/phối cảnh — không phải chỉnh tay từng ảnh.
 *
 * BE chỉ orchestrate như ảnh thẻ: nhận file từ FE rồi chuyển tiếp dạng file multipart sang AI service, không lưu
 * ảnh. Mỗi lượt (thành công hay hỏng) được ghi vào product_image_generations kèm token/chi phí
 * AI báo về — nguồn của tab Chi phí. Không gọi thẳng Gemini — luồng bắt buộc FE → BE → AI.
 */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);

  /** Lần tách nền đầu tiên của mỗi worker AI phải nạp model rembg (và tự tải về nếu image chưa
   * có sẵn) nên cho dư 120s; các lần sau chỉ vài giây. */
  static readonly CUTOUT_TIMEOUT_MS = 120_000;

  /** Mọi chế độ Gemini. Cùng mốc ảnh thẻ (IdPhotoService.MERGE_OUTFIT_TIMEOUT_MS): AI service tự
   * cắt lượt Gemini ở 75s (product_image_views.HELD_PRODUCT_TIMEOUT_SECONDS) để kịp trả lỗi rõ
   * trước mốc này. */
  static readonly HELD_PRODUCT_TIMEOUT_MS = 90_000;

  /** Đổi SP 0đ: AI tách nền SP mới (rembg) rồi chạy model người cầm SP + MobileSAM + LaMa trên CPU — đo ~10s/ảnh,
   * lần đầu mỗi worker còn nạp ~300MB model nên cho dư như tách nền nhưng dài hơn. */
  static readonly HELD_SWAP_TIMEOUT_MS = 180_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly generations: ProductImageGenerationsService,
    /** Lưu ảnh gốc người dùng thả vào để sau này duyệt nhãn rồi cho model nhận diện túi học (chạy nền, không chờ). */
    @Optional() private readonly trainingArchive?: ProductImageTrainingArchiveService,
  ) {}

  /**
   * Tách nền: AI chạy rembg rồi model nhận diện tự huấn luyện để chỉ giữ đúng SP (bỏ giá trưng bày, đạo
   * cụ) — toàn bộ trên AI service, 0đ; `usage` mang tên model đó với 0đ để tab Chi phí vẫn đếm lượt.
   */
  async cutout(file: Express.Multer.File, user: ProductImageUser) {
    // Tên file người dùng thả (thường có mã SP + cm, vd TX018-25-...) — đặt tên ảnh lưu để duyệt nhãn dễ tra.
    void this.trainingArchive?.archive(file, { source: 'cutout', productName: file?.originalname?.replace(/\.[^.]+$/, '') });
    const startedAt = Date.now();
    let data: {
      cutout_image_base64: string;
      width: number;
      height: number;
      usage?: AiUsage;
      detection?: CutoutDetection;
      body_box?: [number, number, number, number] | null;
      quality_warnings?: string[];
    };
    try {
      // Tách nền 0đ, chạy lại không tốn gì → cho thử lại một lần khi kết nối keep-alive bị AI đóng ngang.
      data = await this.callAi('cutout/', { image: aiImage(file), mime_type: file.mimetype },
        ProductImageService.CUTOUT_TIMEOUT_MS, user, { retryConnectionReset: true });
      if (!data.cutout_image_base64) {
        throw attachAiUsage(new HttpException('AI service không trả về ảnh đã tách nền', HttpStatus.BAD_GATEWAY), data.usage);
      }
    } catch (err: any) {
      await this.generations.record({
        userId: user.id, mode: PRODUCT_IMAGE_MODE.CUTOUT, status: GENERATION_STATUS.FAILED,
        ...costFromAiUsage(aiUsageOf(err), CUTOUT_FAILED_FREE), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }
    const cost = costFromAiUsage(data.usage, UNKNOWN_COST);
    await this.generations.record({
      userId: user.id, mode: PRODUCT_IMAGE_MODE.CUTOUT, status: GENERATION_STATUS.SUCCESS,
      ...cost, durationMs: Date.now() - startedAt,
    });
    return {
      imageData: `data:image/png;base64,${data.cutout_image_base64}`,
      width: data.width,
      height: data.height,
      cost: this.costView(cost),
      /** Model đã lọc đạo cụ chưa — "skipped" (model chưa chắc) thì FE cảnh báo ảnh có thể còn dính giá đỡ. */
      detection: data.detection ?? null,
      /** Khung thân SP [x0, y0, x1, y1] trong ảnh tách nền — FE canh cỡ/đáy theo thân túi, không theo dây/quai. */
      bodyBox: data.body_box ?? null,
      /** Ảnh gốc không đủ làm ảnh thương mại (túi bị cắt ở mép, túi quá nhỏ) — FE báo cạnh ảnh, vẫn ghép. */
      qualityWarnings: Array.isArray(data.quality_warnings) ? data.quality_warnings.filter((w) => typeof w === 'string') : [],
    };
  }

  async heldProduct(
    personImage: Express.Multer.File | undefined,
    productImage: Express.Multer.File | undefined,
    input: { note?: string; productName?: string },
    user: ProductImageUser,
  ) {
    // Kiểm hết đầu vào TRƯỚC khi gọi AI — thiếu gì thì báo ngay, không tốn lượt Gemini nào.
    if (!personImage) {
      throw new BadRequestException('Thiếu ảnh chị Nhạm đang cầm sản phẩm (personImage)');
    }
    if (!productImage) {
      throw new BadRequestException('Thiếu ảnh sản phẩm mới (productImage)');
    }
    const productName = requireProductName(input.productName);

    return this.generateWithGemini(PRODUCT_IMAGE_MODE.HELD_PRODUCT, 'held-product/', {
      person_image: aiImage(personImage),
      person_mime_type: personImage.mimetype,
      product_image: aiImage(productImage),
      product_mime_type: productImage.mimetype,
      note: input.note?.trim() || undefined,
    }, productName, user);
  }

  /**
   * Chị Nhạm cầm SP — ĐỔI SP 0đ: AI service tách nền SP mới, tìm SP cũ + bàn tay bằng model người cầm SP tự huấn
   * luyện, xoá SP cũ (LaMa), đặt SP mới vào tay và dán tay lên trên. Không gọi Gemini; mỗi lượt vẫn ghi nhật ký
   * (HELD_SWAP, 0đ) để tab Chi phí đếm lượt. Chạy lại không tốn gì → tự thử lại một lần khi kết nối bị AI đóng ngang.
   */
  async heldSwap(
    personImage: Express.Multer.File | undefined,
    productImage: Express.Multer.File | undefined,
    input: { productName?: string },
    user: ProductImageUser,
  ) {
    if (!personImage) {
      throw new BadRequestException('Thiếu ảnh chị Nhạm đang cầm sản phẩm (personImage)');
    }
    if (!productImage) {
      throw new BadRequestException('Thiếu ảnh sản phẩm mới (productImage)');
    }
    const productName = requireProductName(input.productName);
    void this.trainingArchive?.archive(productImage, { source: 'held-swap', productName });
    const startedAt = Date.now();
    let data: {
      image_base64: string;
      mime_type: string;
      usage?: AiUsage;
      info?: { hands?: number; strap_kept?: boolean; warnings?: string[] };
    };
    try {
      data = await this.callAi('held-swap/', {
        person_image: aiImage(personImage),
        person_mime_type: personImage.mimetype,
        product_image: aiImage(productImage),
        product_mime_type: productImage.mimetype,
      }, ProductImageService.HELD_SWAP_TIMEOUT_MS, user, { retryConnectionReset: true });
      if (!data.image_base64 || !data.mime_type) {
        throw attachAiUsage(new HttpException('AI service không trả về ảnh đã đổi sản phẩm', HttpStatus.BAD_GATEWAY), data.usage);
      }
    } catch (err: any) {
      await this.generations.record({
        userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: GENERATION_STATUS.FAILED, productName,
        ...costFromAiUsage(aiUsageOf(err), HELD_SWAP_FAILED_FREE), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }
    const cost = costFromAiUsage(data.usage, UNKNOWN_COST);
    await this.generations.record({
      userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: GENERATION_STATUS.SUCCESS, productName,
      ...cost, durationMs: Date.now() - startedAt,
    });
    return {
      imageData: `data:${data.mime_type};base64,${data.image_base64}`,
      mimeType: data.mime_type,
      cost: this.costView(cost),
      /** Số bàn tay model thấy + có giữ đoạn dây đeo cũ không + cảnh báo (vd không thấy tay) — FE hiện để soát ảnh. */
      info: {
        hands: data.info?.hands ?? null,
        strapKept: data.info?.strap_kept ?? false,
        warnings: data.info?.warnings ?? [],
      },
    };
  }

  /**
   * Chị Nhạm cầm SP — TỰ CHỌN TƯ THẾ 0đ: chỉ cần ảnh SP mới. AI service tách nền SP, chấm điểm các tư thế chị Nhạm dựng
   * sẵn (thư viện tư thế trên AI) theo dáng SP rồi ghép vào vài tư thế hợp nhất — người dùng chọn ảnh ưng nhất. Một lượt
   * ghi MỘT dòng HELD_SWAP 0đ (cùng việc đổi SP chị Nhạm, tab Chi phí đếm chung). Chạy lại không tốn gì → tự thử lại
   * một lần khi kết nối bị AI đóng ngang.
   */
  async heldAuto(
    productImage: Express.Multer.File | undefined,
    input: { productName?: string; widthCm?: number },
    user: ProductImageUser,
  ) {
    if (!productImage) {
      throw new BadRequestException('Thiếu ảnh sản phẩm mới (productImage)');
    }
    const productName = requireProductName(input.productName);
    // Cỡ thật của túi — AI lấy bàn tay chị Nhạm làm thước để túi ghép đúng cỡ (DTO đã kiểm, kiểm lại cho lời gọi trực tiếp).
    const widthCm = Number(input.widthCm);
    if (!Number.isFinite(widthCm) || widthCm < HELD_WIDTH_CM_MIN || widthCm > HELD_WIDTH_CM_MAX) {
      throw new BadRequestException(`Nhập bề ngang túi (cm, ${HELD_WIDTH_CM_MIN}–${HELD_WIDTH_CM_MAX}) — cần để ghép túi đúng cỡ vào tay chị Nhạm`);
    }
    void this.trainingArchive?.archive(productImage, { source: 'held-auto', productName });
    const startedAt = Date.now();
    let data: {
      usage?: AiUsage;
      candidates?: {
        image_base64: string;
        mime_type: string;
        info?: { pose_id?: string; score?: number; hands?: number; warnings?: string[] };
      }[];
    };
    try {
      data = await this.callAi('held-auto/', {
        product_image: aiImage(productImage),
        product_mime_type: productImage.mimetype,
        width_cm: String(widthCm),
      }, ProductImageService.HELD_SWAP_TIMEOUT_MS, user, { retryConnectionReset: true });
      if (!data.candidates?.length || data.candidates.some((c) => !c.image_base64 || !c.mime_type)) {
        throw attachAiUsage(new HttpException('AI service không trả về ảnh ghép nào', HttpStatus.BAD_GATEWAY), data.usage);
      }
    } catch (err: any) {
      await this.generations.record({
        userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: GENERATION_STATUS.FAILED, productName,
        ...costFromAiUsage(aiUsageOf(err), HELD_SWAP_FAILED_FREE), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }
    const cost = costFromAiUsage(data.usage, UNKNOWN_COST);
    await this.generations.record({
      userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_SWAP, status: GENERATION_STATUS.SUCCESS, productName,
      ...cost, durationMs: Date.now() - startedAt,
    });
    return {
      cost: this.costView(cost),
      /** Tư thế hợp nhất trước — FE cho chọn ảnh ưng nhất để tải về. */
      candidates: data.candidates.map((c) => ({
        imageData: `data:${c.mime_type};base64,${c.image_base64}`,
        mimeType: c.mime_type,
        poseId: c.info?.pose_id ?? null,
        info: { hands: c.info?.hands ?? null, warnings: c.info?.warnings ?? [] },
      })),
    };
  }

  /**
   * Đặt SP vào ảnh cảnh (tab "Tạo hàng loạt") — FE gọi lần lượt từng SP với cùng một ảnh cảnh, mỗi
   * lượt là một request ngắn như chế độ chị Nhạm nên không cần hàng đợi phía BE, và mỗi lượt được
   * ghi chi phí riêng.
   */
  async scenePlacement(
    productImage: Express.Multer.File | undefined,
    sceneImage: Express.Multer.File | undefined,
    input: { note?: string; productName?: string },
    user: ProductImageUser,
  ) {
    if (!productImage) {
      throw new BadRequestException('Thiếu ảnh sản phẩm (productImage)');
    }
    if (!sceneImage) {
      throw new BadRequestException('Thiếu ảnh cảnh để đặt sản phẩm vào (sceneImage)');
    }
    const productName = requireProductName(input.productName);

    return this.generateWithGemini(PRODUCT_IMAGE_MODE.SCENE_PLACEMENT, 'scene-placement/', {
      product_image: aiImage(productImage),
      product_mime_type: productImage.mimetype,
      scene_image: aiImage(sceneImage),
      scene_mime_type: sceneImage.mimetype,
      note: input.note?.trim() || undefined,
    }, productName, user);
  }

  /** Một lượt Gemini tạo ảnh: gọi AI, ghi nhật ký chi phí (kể cả lượt hỏng), quy ra VNĐ cho FE. */
  private async generateWithGemini(
    mode: ProductImageMode,
    path: string,
    body: AiFormFields,
    productName: string,
    user: ProductImageUser,
  ) {
    const startedAt = Date.now();
    let data: { image_base64: string; mime_type: string; usage?: AiUsage };
    try {
      data = await this.callAi(path, body, ProductImageService.HELD_PRODUCT_TIMEOUT_MS, user);
      if (!data.image_base64 || !data.mime_type) {
        throw attachAiUsage(new HttpException('AI service không trả về ảnh đã tạo', HttpStatus.BAD_GATEWAY), data.usage);
      }
    } catch (err: any) {
      // Lượt hỏng vẫn có thể đã tốn tiền (Gemini chạy xong nhưng không trả ảnh) — ghi đủ để thống kê.
      await this.generations.record({
        userId: user.id, mode, status: GENERATION_STATUS.FAILED, productName,
        ...costFromAiUsage(aiUsageOf(err), UNKNOWN_COST), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }

    const cost = costFromAiUsage(data.usage, UNKNOWN_COST);
    const generationId = await this.generations.record({
      userId: user.id, mode, status: GENERATION_STATUS.SUCCESS, productName,
      ...cost, durationMs: Date.now() - startedAt,
    });
    return {
      imageData: `data:${data.mime_type};base64,${data.image_base64}`,
      mimeType: data.mime_type,
      /** null khi ghi nhật ký hỏng — FE ẩn nút "Đạt" của ảnh này. */
      generationId,
      cost: this.costView(cost),
    };
  }

  /** Tiền một lượt cho FE. Thiếu tỷ giá không được làm hỏng lượt đã trả tiền — chỉ chưa quy ra VNĐ, kèm lý do. */
  private costView(cost: GenerationCost) {
    const { rate, note: rateNote } = tryParseUsdVndRate(this.configService.get<string>(USD_VND_RATE_ENV));
    return {
      usd: cost.cost_usd,
      vnd: cost.cost_usd !== null && rate !== null ? Math.round(cost.cost_usd * rate) : null,
      note: cost.cost_note ?? (cost.cost_usd !== null && rate === null ? rateNote : null),
    };
  }

  /**
   * Một lượt gọi AI service. Token ký theo ĐÚNG người bấm (không dùng danh tính 'be-system'
   * chung) — cùng lý do transcribeAiAuthHeaders: FE xác thực bằng cookie nên không có header
   * Authorization nào để chuyển tiếp, và AI service cần biết ai tiêu tiền Gemini.
   */
  private async callAi<T>(
    path: string,
    body: AiFormFields,
    timeoutMs: number,
    user: ProductImageUser,
    options: { retryConnectionReset?: boolean } = {},
  ): Promise<T> {
    // Đọc lúc dùng: thiếu AI_SERVICE_URL thì chỉ tính năng này báo lỗi, kèm tên biến.
    let aiServiceUrl: string;
    try {
      aiServiceUrl = resolveAiServiceUrl(this.configService);
    } catch (err: any) {
      throw attachAiUsage(new InternalServerErrorException(err.message), {
        cost_usd: 0,
        cost_note: 'Chưa gọi AI service (thiếu cấu hình) — không tính phí.',
      });
    }
    const url = `${aiServiceUrl}/api/ai/product-image/${path}`;
    const token = this.jwtService.sign({ sub: user.id, email: user.email ?? undefined });
    const startedAt = Date.now();
    const post = () => {
      // Ảnh đi dạng file multipart (xem product-image-ai-form.util.ts); dựng form mới mỗi lần vì stream chỉ đọc được một lần.
      const form = buildAiForm(body);
      return firstValueFrom(
        this.httpService.post(url, form, {
          timeout: timeoutMs,
          headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
          // Ảnh gửi đi vài MB, ảnh trả về dạng base64 trong JSON — bỏ trần mặc định của axios cho chắc.
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
    };
    try {
      let response;
      try {
        response = await post();
      } catch (err: any) {
        if (!options.retryConnectionReset || !isConnectionReset(err)) throw err;
        this.logger.warn(`[${path}] user=${user.id} kết nối tới AI bị đóng ngang (${err?.message}) — thử lại một lần`);
        response = await post();
      }
      if (!response.data?.success) {
        throw attachAiUsage(
          new HttpException(response.data?.error_message || 'AI service báo lỗi không rõ lý do', HttpStatus.BAD_GATEWAY),
          response.data?.usage,
        );
      }
      this.logger.log(`[${path}] user=${user.id} xong sau ${Date.now() - startedAt}ms`);
      return response.data as T;
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `[${path}] user=${user.id} lỗi sau ${Date.now() - startedAt}ms: ` +
          `${err?.message ?? `HTTP ${err?.response?.status}`}`,
      );
      throw attachAiUsage(toAiHttpException(err, timeoutMs), usageFromAxiosError(err));
    }
  }
}

/**
 * Kết nối tới AI service bị đóng trước khi có phản hồi (ECONNRESET / "socket hang up"): gunicorn đóng kết
 * nối keep-alive rảnh đúng lúc BE dùng lại nó — đo 10/10: lỗi sau 15ms, AI không hề nhận request. Chỉ lượt
 * không tính phí (tách nền) mới tự thử lại; lượt Gemini không chắc AI chưa xử lý nên không tự gửi lại.
 */
export function isConnectionReset(err: any): boolean {
  return !err?.response && (err?.code === 'ECONNRESET' || /socket hang up/i.test(err?.message ?? ''));
}

/** Tên SP bắt buộc ở mọi chế độ Gemini — tab Chi phí đếm lượt/tiền theo từng sản phẩm. */
function requireProductName(raw: string | undefined): string {
  const productName = raw?.trim();
  if (!productName) {
    throw new BadRequestException('Nhập tên sản phẩm — dùng để thống kê chi phí theo từng sản phẩm');
  }
  return productName;
}

/**
 * Đổi lỗi axios khi gọi AI service thành lỗi HTTP trả cho FE.
 *
 * 401/403 từ AI service là lỗi cấu hình máy chủ (JWT_SECRET hai bên lệch nhau), KHÔNG phải người
 * dùng hết phiên — trả nguyên 401/403 thì FE hiểu nhầm thành mất đăng nhập, nên đổi sang 502.
 */
export function toAiHttpException(err: any, timeoutMs: number): HttpException {
  const status: number | undefined = err?.response?.status;
  const aiMessage: string | undefined = err?.response?.data?.error_message || err?.response?.data?.detail;

  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message ?? '')) {
    return new HttpException(
      `AI service xử lý quá ${Math.round(timeoutMs / 1000)}s, vui lòng thử lại.`,
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
  if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
    return new HttpException(
      `AI service từ chối xác thực (${status}${aiMessage ? `: ${aiMessage}` : ''}) — kiểm JWT_SECRET ` +
        'của BE và AI service có khớp nhau.',
      HttpStatus.BAD_GATEWAY,
    );
  }
  if (status === HttpStatus.NOT_FOUND) {
    // Trang 404 của Django là HTML, không có error_message — gần như luôn do AI service chưa
    // deploy bản có endpoint này. Trả 404 thì FE tưởng chính route BE không tồn tại.
    return new HttpException(
      'AI service chưa có endpoint tạo ảnh sản phẩm (404) — AI service đã deploy bản mới chưa?',
      HttpStatus.BAD_GATEWAY,
    );
  }
  if (status) {
    return new HttpException(aiMessage || `AI service trả lỗi ${status}`, status);
  }
  return new HttpException(
    `Không kết nối được AI service: ${err?.message ?? 'lỗi không rõ'}`,
    HttpStatus.BAD_GATEWAY,
  );
}

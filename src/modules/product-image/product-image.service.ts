import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom } from 'rxjs';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';
import { ProductImageGenerationsService } from './product-image-generations.service';
import {
  AiUsage,
  GENERATION_STATUS,
  PRODUCT_IMAGE_MODE,
  UNKNOWN_COST,
  USD_VND_RATE_ENV,
  aiUsageOf,
  attachAiUsage,
  costFromAiUsage,
  freeCost,
  tryParseUsdVndRate,
  usageFromAxiosError,
} from './product-image-cost.util';

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
 *
 * BE chỉ orchestrate như ảnh thẻ: nhận file từ FE rồi chuyển base64 sang AI service, không lưu
 * ảnh. Mỗi lượt (thành công hay hỏng) được ghi vào product_image_generations kèm token/chi phí
 * AI báo về — nguồn của tab Chi phí. Không gọi thẳng Gemini — luồng bắt buộc FE → BE → AI.
 */
@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);

  /** Lần tách nền đầu tiên của mỗi worker AI phải nạp model rembg (và tự tải về nếu image chưa
   * có sẵn) nên cho dư 120s; các lần sau chỉ vài giây. */
  static readonly CUTOUT_TIMEOUT_MS = 120_000;

  /** Cùng mốc ảnh thẻ (IdPhotoService.MERGE_OUTFIT_TIMEOUT_MS): AI service tự cắt lượt Gemini ở
   * 75s (product_image_views.HELD_PRODUCT_TIMEOUT_SECONDS) để kịp trả lỗi rõ trước mốc này. */
  static readonly HELD_PRODUCT_TIMEOUT_MS = 90_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly generations: ProductImageGenerationsService,
  ) {}

  async cutout(file: Express.Multer.File, user: ProductImageUser) {
    const startedAt = Date.now();
    let data: { cutout_image_base64: string; width: number; height: number; model?: string };
    try {
      data = await this.callAi('cutout/', { image_base64: file.buffer.toString('base64'), mime_type: file.mimetype },
        ProductImageService.CUTOUT_TIMEOUT_MS, user);
      if (!data.cutout_image_base64) {
        throw new HttpException('AI service không trả về ảnh đã tách nền', HttpStatus.BAD_GATEWAY);
      }
    } catch (err: any) {
      await this.generations.record({
        userId: user.id, mode: PRODUCT_IMAGE_MODE.CUTOUT, status: GENERATION_STATUS.FAILED,
        ...freeCost(null), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }
    await this.generations.record({
      userId: user.id, mode: PRODUCT_IMAGE_MODE.CUTOUT, status: GENERATION_STATUS.SUCCESS,
      ...freeCost(data.model), durationMs: Date.now() - startedAt,
    });
    return {
      imageData: `data:image/png;base64,${data.cutout_image_base64}`,
      width: data.width,
      height: data.height,
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
    const productName = input.productName?.trim();
    if (!productName) {
      throw new BadRequestException('Nhập tên sản phẩm — dùng để thống kê chi phí theo từng sản phẩm');
    }

    const startedAt = Date.now();
    let data: { image_base64: string; mime_type: string; usage?: AiUsage };
    try {
      data = await this.callAi('held-product/', {
        person_image_base64: personImage.buffer.toString('base64'),
        person_mime_type: personImage.mimetype,
        product_image_base64: productImage.buffer.toString('base64'),
        product_mime_type: productImage.mimetype,
        note: input.note?.trim() || undefined,
      }, ProductImageService.HELD_PRODUCT_TIMEOUT_MS, user);
      if (!data.image_base64 || !data.mime_type) {
        throw attachAiUsage(new HttpException('AI service không trả về ảnh đã tạo', HttpStatus.BAD_GATEWAY), data.usage);
      }
    } catch (err: any) {
      // Lượt hỏng vẫn có thể đã tốn tiền (Gemini chạy xong nhưng không trả ảnh) — ghi đủ để thống kê.
      await this.generations.record({
        userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_PRODUCT, status: GENERATION_STATUS.FAILED, productName,
        ...costFromAiUsage(aiUsageOf(err), UNKNOWN_COST), errorMessage: err?.message, durationMs: Date.now() - startedAt,
      });
      throw err;
    }

    const cost = costFromAiUsage(data.usage, UNKNOWN_COST);
    const generationId = await this.generations.record({
      userId: user.id, mode: PRODUCT_IMAGE_MODE.HELD_PRODUCT, status: GENERATION_STATUS.SUCCESS, productName,
      ...cost, durationMs: Date.now() - startedAt,
    });
    // Thiếu tỷ giá không được làm hỏng lượt đã trả tiền — chỉ chưa quy ra VNĐ, kèm lý do.
    const { rate, note: rateNote } = tryParseUsdVndRate(this.configService.get<string>(USD_VND_RATE_ENV));
    return {
      imageData: `data:${data.mime_type};base64,${data.image_base64}`,
      mimeType: data.mime_type,
      /** null khi ghi nhật ký hỏng — FE ẩn nút "Đạt" của ảnh này. */
      generationId,
      cost: {
        usd: cost.cost_usd,
        vnd: cost.cost_usd !== null && rate !== null ? Math.round(cost.cost_usd * rate) : null,
        note: cost.cost_note ?? (cost.cost_usd !== null && rate === null ? rateNote : null),
      },
    };
  }

  /**
   * Một lượt gọi AI service. Token ký theo ĐÚNG người bấm (không dùng danh tính 'be-system'
   * chung) — cùng lý do transcribeAiAuthHeaders: FE xác thực bằng cookie nên không có header
   * Authorization nào để chuyển tiếp, và AI service cần biết ai tiêu tiền Gemini.
   */
  private async callAi<T>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    user: ProductImageUser,
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
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout: timeoutMs,
          headers: { Authorization: `Bearer ${token}` },
          // Ảnh trả về dạng base64 trong JSON, vài MB — bỏ trần mặc định của axios cho chắc.
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
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

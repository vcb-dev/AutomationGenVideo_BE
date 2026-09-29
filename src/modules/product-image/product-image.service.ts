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
 * gì (chưa có lịch sử). Không gọi thẳng Gemini — luồng bắt buộc FE → BE → AI.
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
  ) {}

  async cutout(file: Express.Multer.File, user: ProductImageUser) {
    const data = await this.callAi<{ cutout_image_base64: string; width: number; height: number }>(
      'cutout/',
      { image_base64: file.buffer.toString('base64'), mime_type: file.mimetype },
      ProductImageService.CUTOUT_TIMEOUT_MS,
      user,
    );
    if (!data.cutout_image_base64) {
      throw new HttpException('AI service không trả về ảnh đã tách nền', HttpStatus.BAD_GATEWAY);
    }
    return {
      imageData: `data:image/png;base64,${data.cutout_image_base64}`,
      width: data.width,
      height: data.height,
    };
  }

  async heldProduct(
    personImage: Express.Multer.File | undefined,
    productImage: Express.Multer.File | undefined,
    note: string | undefined,
    user: ProductImageUser,
  ) {
    if (!personImage) {
      throw new BadRequestException('Thiếu ảnh chị Nhạm đang cầm sản phẩm (personImage)');
    }
    if (!productImage) {
      throw new BadRequestException('Thiếu ảnh sản phẩm mới (productImage)');
    }
    const data = await this.callAi<{ image_base64: string; mime_type: string }>(
      'held-product/',
      {
        person_image_base64: personImage.buffer.toString('base64'),
        person_mime_type: personImage.mimetype,
        product_image_base64: productImage.buffer.toString('base64'),
        product_mime_type: productImage.mimetype,
        note: note?.trim() || undefined,
      },
      ProductImageService.HELD_PRODUCT_TIMEOUT_MS,
      user,
    );
    if (!data.image_base64 || !data.mime_type) {
      throw new HttpException('AI service không trả về ảnh đã tạo', HttpStatus.BAD_GATEWAY);
    }
    return {
      imageData: `data:${data.mime_type};base64,${data.image_base64}`,
      mimeType: data.mime_type,
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
      throw new InternalServerErrorException(err.message);
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
        throw new HttpException(
          response.data?.error_message || 'AI service báo lỗi không rõ lý do',
          HttpStatus.BAD_GATEWAY,
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
      throw toAiHttpException(err, timeoutMs);
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

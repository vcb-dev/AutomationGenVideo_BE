import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { TransformStatus } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AnalyzeContentDto } from "../dto/paast-analyze.dto";
import { HistoryQueryDto } from "../dto/paast-history-query.dto";

/** Một tiêu chí PAAST đang `miss` — dùng làm input cho upgradeAnalysis(). */
interface MissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

/**
 * PAAST — chấm điểm content theo khung PAAST (5 lớp x 6 tiêu chí). Tách khỏi
 * AiIntegrationService để file service chính gọn hơn; AiIntegrationController
 * và AiIntegrationModule không đổi — AiIntegrationService giữ nguyên các method
 * cũ và delegate sang đây.
 */
@Injectable()
export class PaastService {
  private readonly logger = new Logger(PaastService.name);
  private readonly aiServiceUrl: string;

  // Timeout cho /analyze — 1 lệnh Django orchestrate 5 lệnh DeepSeek song song (mỗi lệnh có
  // trần + tự thử lại riêng), thường xong trong ~9-15s/lệnh nên 60s luôn dư dả trong thực tế.
  private readonly PAAST_ANALYZE_TIMEOUT_MS = 60_000;

  // /analyze-v2 sinh thêm 16 hook (1 lệnh LLM riêng, đo thật ~14s) ngoài 5 lệnh phân loại.
  private readonly PAAST_ANALYZE_V2_TIMEOUT_MS = 150_000;

  // Timeout cho /upgrade — Django cần đủ ngân sách cho 2 lượt LLM NỐI TIẾP bên trong (viết bản
  // nâng cấp RỒI chấm lại từ đầu, chia theo tỷ lệ 40% viết / 60% chấm — xem
  // PaastAnalysisService.upgrade). 90s cũ luôn hỏng: viết là lệnh reasoning-enabled +
  // max_tokens=16000, thực tế cần tới ~60s (đối chiếu log lịch sử: 100% lượt nâng cấp PAAST hỏng
  // trong nhiều ngày, luôn dừng ở ~40s = write_budget khi ngân sách ngoài chỉ 90s). Content-
  // transform đã gặp & sửa ĐÚNG bug này cho luồng nâng cấp song song của nó
  // (CONTENT_TRANSFORM_UPGRADE_TIMEOUT_MS = 420_000, xem ai-integration.service.ts) — dùng lại
  // đúng mốc đó ở đây thay vì đoán số mới.
  private readonly PAAST_UPGRADE_TIMEOUT_MS = 420_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      "AI_SERVICE_URL",
      "http://localhost:8000",
    );
  }

  /**
   * Tìm bản phân tích PAAST gần nhất khớp ĐÚNG nội dung này (nếu có) — để FE tránh gọi phân tích lại
   * khi content không đổi, kể cả sau khi user reload trang (cache trong React state bị mất khi remount,
   * nhưng bản ghi trong DB thì còn).
   *
   * Cố ý KHÔNG lọc theo user: kết quả chấm PAAST chỉ phụ thuộc nội dung, nên editor chấm xong thì
   * leader mở cùng content phải thấy lại kết quả đó thay vì tốn 1 lần gọi LLM chấm lại.
   */
  async findLatestByContent(content: string) {
    return this.prisma.paastAnalysisHistory.findFirst({
      where: { input_text: content, status: TransformStatus.SUCCESS },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Phân tích content theo khung PAAST (5 lớp x 6 tiêu chí), tính điểm 0-100, lưu lịch sử.
   */
  async analyzeContent(userId: string, dto: AnalyzeContentDto) {
    const history = await this.prisma.paastAnalysisHistory.create({
      data: {
        user_id: userId,
        input_text: dto.content,
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze/`,
          {
            content: dto.content,
            // Gửi đúng ngân sách THẬT của BE — thiếu field này Django tự đoán bằng
            // DEFAULT_ANALYZE_TIMEOUT_S=120s, thừa hơn hẳn 60s BE thực sự chờ.
            timeout_seconds: Math.floor(this.PAAST_ANALYZE_TIMEOUT_MS / 1000),
          },
          { timeout: this.PAAST_ANALYZE_TIMEOUT_MS },
        ),
      );

      const { layers, total_score, verdict, cta_warning } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: { layers, cta_warning, verdict },
          total_score: total_score,
          status: TransformStatus.SUCCESS,
          model_used: "deepseek-chat",
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST content: ${error.message}`);
      const errMsg =
        error.response?.data?.error ||
        error.message ||
        "Lỗi không xác định trong quá trình phân tích";

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Phân tích PAAST BẢN 2 — dùng cho video kênh nội bộ.
   *
   * Khác bản 1: không có thang điểm 0–100 (chỉ đếm element + kết luận đạt/chưa) và có thêm
   * 16 hook gợi ý. Vẫn lưu chung bảng `paast_analysis_histories` vì cột `analysis_result` là
   * JSON tự do; `total_score` để null — đó chính là dấu hiệu phân biệt bản 2 với bản 1, cùng
   * với khoá `phien_ban` nằm trong JSON.
   *
   * Cố ý KHÔNG đụng analyzeContent() bản 1: task-auto đang chạy trên nó.
   */
  async analyzeContentV2(userId: string, content: string) {
    const history = await this.prisma.paastAnalysisHistory.create({
      data: {
        user_id: userId,
        input_text: content,
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze-v2/`,
          {
            content,
            timeout_seconds: Math.floor(this.PAAST_ANALYZE_V2_TIMEOUT_MS / 1000),
          },
          { timeout: this.PAAST_ANALYZE_V2_TIMEOUT_MS },
        ),
      );

      const { verdict, layers, ctaWarning, phien_ban } = response.data;
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: {
            phien_ban: phien_ban ?? 2,
            verdict,
            layers,
            ctaWarning,
          },
          status: TransformStatus.SUCCESS,
          model_used: "deepseek-chat",
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST v2: ${error.message}`);
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message:
            error.response?.data?.error ||
            error.message ||
            "Lỗi không xác định",
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Trích các tiêu chí đang `miss` từ 1 bản phân tích đã lưu (loại tiêu chí `na` của Stick
   * — không thể "nâng cấp" phần cần production bằng cách sửa text, business doc §11.2).
   */
  private extractMissingElements(analysisResult: any): MissingElement[] {
    const layers = analysisResult?.layers || {};
    const missing: MissingElement[] = [];
    const criteriaLayers: Array<[string, string]> = [
      ["action", "criteria"],
      ["acknowledge", "criteria"],
      ["stick", "criteria"],
      ["trust", "criteria"],
    ];

    for (const [layerKey, field] of criteriaLayers) {
      const criteria = layers[layerKey]?.[field] || [];
      for (const c of criteria) {
        if (c.status === "miss") {
          missing.push({
            layer: layerKey,
            criterion: c.code,
            suggestion: c.evidence || "",
          });
        }
      }
    }
    return missing;
  }

  /**
   * Nâng cấp content dựa trên bản phân tích đã lưu, lưu kết quả thành 1 record lịch sử mới
   * liên kết `upgraded_from_id` về bản gốc — không giả định điểm chắc chắn tăng
   * (business doc §11.1: luôn tính lại điểm toàn bộ sau khi nâng cấp).
   */
  async upgradeAnalysis(userId: string, analysisId: string) {
    const original = await this.prisma.paastAnalysisHistory.findUnique({
      where: { id: analysisId },
    });

    if (!original) {
      throw new NotFoundException("Không tìm thấy bản phân tích PAAST này");
    }
    if (
      original.status !== TransformStatus.SUCCESS ||
      !original.analysis_result
    ) {
      throw new BadRequestException(
        "Bản phân tích này chưa hoàn tất hoặc không có kết quả để nâng cấp",
      );
    }

    const missingElements = this.extractMissingElements(
      original.analysis_result,
    );

    const history = await this.prisma.paastAnalysisHistory.create({
      data: {
        user_id: userId,
        input_text: original.input_text,
        status: TransformStatus.PENDING,
        upgraded_from_id: original.id,
      },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/upgrade/`,
          {
            original_content: original.input_text,
            missing_elements: missingElements,
            timeout_seconds: Math.floor(this.PAAST_UPGRADE_TIMEOUT_MS / 1000),
          },
          { timeout: this.PAAST_UPGRADE_TIMEOUT_MS },
        ),
      );

      const { upgraded, changes_added, new_analysis } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          input_text: upgraded,
          analysis_result: {
            layers: new_analysis.layers,
            cta_warning: new_analysis.cta_warning,
            verdict: new_analysis.verdict,
            changes_added,
          },
          total_score: new_analysis.total_score,
          status: TransformStatus.SUCCESS,
          model_used: "deepseek-chat",
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to upgrade PAAST content: ${error.message}`);
      const errMsg =
        error.response?.data?.error ||
        error.message ||
        "Lỗi không xác định trong quá trình nâng cấp";

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  async getPaastUserHistory(userId: string, query: HistoryQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };
    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.paastAnalysisHistory.count({ where }),
      this.prisma.paastAnalysisHistory.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  async getPaastHistoryDetail(id: string, userId: string) {
    const history = await this.prisma.paastAnalysisHistory.findUnique({
      where: { id },
    });

    if (!history) {
      throw new NotFoundException("Không tìm thấy bản ghi lịch sử");
    }
    if (history.user_id !== userId) {
      throw new NotFoundException("Không tìm thấy bản ghi lịch sử");
    }

    return history;
  }
}

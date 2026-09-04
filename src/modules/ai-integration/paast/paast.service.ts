import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { TransformStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveAiServiceUrl } from '../../../common/config/ai-service-url';
import { AnalyzeContentDto } from '../dto/paast-analyze.dto';
import { HistoryQueryDto } from '../dto/paast-history-query.dto';
import { PAAST_LOGIC_VERSION } from '../interfaces/paast-analysis.interface';
import { extractMissingElements } from './paast-missing-elements.util';

/**
 * Chấm content theo khung PAAST (5 lớp × 6 tiêu chí): gọi AI service (Django) rồi lưu lịch sử
 * vào `paast_analysis_histories`. Provider @Global nên inject được ở mọi nơi.
 */
@Injectable()
export class PaastService {
  private readonly logger = new Logger(PaastService.name);
  private readonly aiServiceUrl: string;

  // /upgrade chạy 2 lượt LLM nối tiếp trong Django.
  private readonly PAAST_UPGRADE_TIMEOUT_MS = 420_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.aiServiceUrl = resolveAiServiceUrl(this.configService);
  }

  /**
   * Bản phân tích gần nhất khớp ĐÚNG nội dung này — để FE khỏi chấm lại content không đổi.
   * KHÔNG lọc theo user (kết quả chỉ phụ thuộc nội dung); chỉ nhận bản khớp `PAAST_LOGIC_VERSION`.
   */
  async findLatestByContent(content: string) {
    const candidates = await this.prisma.paastAnalysisHistory.findMany({
      where: { input_text: content, status: TransformStatus.SUCCESS },
      orderBy: { created_at: 'desc' },
      take: 5,
    });

    return (
      candidates.find((c) => (c.analysis_result as any)?.logic_version === PAAST_LOGIC_VERSION) || null
    );
  }

  /**
   * Nội dung để chấm: ưu tiên `content`; nếu chỉ có `fileUrl` (link Google Docs) thì nhờ AI
   * service trích text ra. Luồng phía sau không cần biết tới file.
   */
  async resolvePaastContent(dto: AnalyzeContentDto): Promise<string> {
    const direct = dto.content?.trim();
    if (direct) return direct;

    const fileUrl = dto.fileUrl?.trim();
    if (!fileUrl) {
      throw new BadRequestException('Cần truyền content hoặc fileUrl để chấm điểm');
    }

    let text = '';
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/extract-text/`,
          { file_url: fileUrl },
          { timeout: 30000 },
        ),
      );
      text = (response.data?.text || '').trim();
    } catch (error: any) {
      const msg =
        error.response?.data?.error ||
        'Không đọc được nội dung từ file. Kiểm tra quyền chia sẻ của link (đặt "Bất kỳ ai có đường liên kết" — Người xem) hoặc dán nội dung trực tiếp.';
      throw new BadRequestException(msg);
    }

    if (text.length < 100) {
      throw new BadRequestException(
        'Nội dung đọc được từ file quá ngắn (cần ít nhất 100 ký tự) — có thể file là bản scan/ảnh không có chữ. Hãy dán nội dung trực tiếp.',
      );
    }
    return text;
  }

  /** Chấm PAAST (điểm 0-100), lưu lịch sử. */
  async analyzeContent(userId: string, dto: AnalyzeContentDto) {
    const content = await this.resolvePaastContent(dto);
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
          `${this.aiServiceUrl}/api/ai/paast/analyze/`,
          { content },
          { timeout: 60000 },
        ),
      );

      const { layers, video_realism, total_score, score_band, verdict, cta_warning } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: { layers, video_realism, cta_warning, verdict, score_band, logic_version: PAAST_LOGIC_VERSION },
          total_score: total_score,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST content: ${error.message}`);
      const errMsg = error.response?.data?.error || error.message || 'Lỗi không xác định trong quá trình phân tích';

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
   * PAAST bản 2 cho video nội bộ: không thang điểm (chỉ đếm element + đạt/chưa), thêm 16 hook.
   * Lưu chung bảng — `total_score` null là dấu hiệu phân biệt bản 1. Không đụng analyzeContent()
   * vì task-auto đang chạy trên đó.
   */
  async analyzeContentV2(userId: string, content: string) {
    const history = await this.prisma.paastAnalysisHistory.create({
      data: { user_id: userId, input_text: content, status: TransformStatus.PENDING },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze-v2/`,
          { content },
          // Sinh 16 hook là 1 lệnh LLM riêng (~14s) nên 60s của bản 1 quá sát.
          { timeout: 150000 },
        ),
      );

      const { verdict, layers, ctaWarning, phien_ban } = response.data;
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          analysis_result: { phien_ban: phien_ban ?? 2, verdict, layers, ctaWarning },
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: Date.now() - startTime,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to analyze PAAST v2: ${error.message}`);
      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: error.response?.data?.error || error.message || 'Lỗi không xác định',
          duration_ms: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Nâng cấp content từ 1 bản phân tích đã lưu; tạo record mới link `upgraded_from_id`, luôn
   * tính lại điểm toàn bộ (business doc §11.1).
   */
  async upgradeAnalysis(userId: string, analysisId: string) {
    const original = await this.prisma.paastAnalysisHistory.findUnique({ where: { id: analysisId } });

    if (!original) {
      throw new NotFoundException('Không tìm thấy bản phân tích PAAST này');
    }
    if (original.status !== TransformStatus.SUCCESS || !original.analysis_result) {
      throw new BadRequestException('Bản phân tích này chưa hoàn tất hoặc không có kết quả để nâng cấp');
    }

    const missingElements = extractMissingElements(original.analysis_result);

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
            // Django mặc định 120s nếu thiếu field này.
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
            video_realism: new_analysis.video_realism,
            cta_warning: new_analysis.cta_warning,
            verdict: new_analysis.verdict,
            score_band: new_analysis.score_band,
            logic_version: PAAST_LOGIC_VERSION,
            changes_added,
          },
          total_score: new_analysis.total_score,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: durationMs,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to upgrade PAAST content: ${error.message}`);
      const errMsg = error.response?.data?.error || error.message || 'Lỗi không xác định trong quá trình nâng cấp';

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
        orderBy: { created_at: 'desc' },
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
    const history = await this.prisma.paastAnalysisHistory.findUnique({ where: { id } });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }
    if (history.user_id !== userId) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }

    return history;
  }
}

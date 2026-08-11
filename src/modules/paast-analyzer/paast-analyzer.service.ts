import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyzeContentDto, HistoryQueryDto } from './dto';
import { TransformStatus } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface MissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

/**
 * PaastAnalyzerService — điều phối gọi AI service (Django) để phân tích/nâng cấp
 * content theo khung PAAST, và lưu lịch sử. Module export service này để các
 * module NestJS khác trong hệ thống có thể `imports: [PaastAnalyzerModule]` rồi
 * inject thẳng service, tái dùng logic chấm điểm mà không phải gọi qua HTTP nội bộ.
 */
@Injectable()
export class PaastAnalyzerService {
  private readonly logger = new Logger(PaastAnalyzerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get aiServiceUrl(): string {
    return this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
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
      orderBy: { created_at: 'desc' },
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
          { content: dto.content },
          { timeout: 60000 },
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
      data: { user_id: userId, input_text: content, status: TransformStatus.PENDING },
    });

    const startTime = Date.now();
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/ai/paast/analyze-v2/`,
          { content },
          // Sinh 16 hook là một lệnh gọi LLM riêng ngoài 5 lệnh phân loại — đo thật mất ~14
          // giây, nên 60s của bản 1 là quá sát.
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
   * Trích các tiêu chí đang `miss` từ 1 bản phân tích đã lưu (loại tiêu chí `na` của Stick
   * — không thể "nâng cấp" phần cần production bằng cách sửa text, business doc §11.2).
   */
  private extractMissingElements(analysisResult: any): MissingElement[] {
    const layers = analysisResult?.layers || {};
    const missing: MissingElement[] = [];
    const criteriaLayers: Array<[string, string]> = [
      ['action', 'criteria'],
      ['acknowledge', 'criteria'],
      ['stick', 'criteria'],
      ['trust', 'criteria'],
    ];

    for (const [layerKey, field] of criteriaLayers) {
      const criteria = layers[layerKey]?.[field] || [];
      for (const c of criteria) {
        if (c.status === 'miss') {
          missing.push({ layer: layerKey, criterion: c.code, suggestion: c.evidence || '' });
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
    const original = await this.prisma.paastAnalysisHistory.findUnique({ where: { id: analysisId } });

    if (!original) {
      throw new NotFoundException('Không tìm thấy bản phân tích PAAST này');
    }
    if (original.status !== TransformStatus.SUCCESS || !original.analysis_result) {
      throw new BadRequestException('Bản phân tích này chưa hoàn tất hoặc không có kết quả để nâng cấp');
    }

    const missingElements = this.extractMissingElements(original.analysis_result);

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
          { original_content: original.input_text, missing_elements: missingElements },
          { timeout: 90000 },
        ),
      );

      const { upgraded, changes_added, new_analysis } = response.data;
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          input_text: upgraded,
          analysis_result: { layers: new_analysis.layers, cta_warning: new_analysis.cta_warning, verdict: new_analysis.verdict, changes_added },
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

  async getUserHistory(userId: string, query: HistoryQueryDto) {
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

  async getHistoryDetail(id: string, userId: string) {
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

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyzeContentDto, HistoryQueryDto } from './dto';
import { TransformStatus } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  PaastAnalysisPayload,
  PaastMissingElement,
  PAAST_LOGIC_VERSION,
} from './interfaces/paast-analysis.interface';

/**
 * Timeout mặc định cho 1 lượt chấm PAAST (BE -> AI service).
 *
 * Trước đây là 60s, NHỎ HƠN cả timeout mà Django tự đặt cho lệnh gọi DeepSeek (120s hard-code)
 * — tức axios của BE luôn bung trước trong khi AI service vẫn đang chạy bình thường, và vẫn đốt
 * tiếp quota DeepSeek tới 120s dù không còn ai đọc kết quả. Đặt bằng 120s để khớp đúng ngân sách
 * mà luồng /rescore của content-transform vẫn dùng cho mỗi lần thử (xem scoreContentWithRetry);
 * Django tự trừ biên an toàn 20s trước khi gọi DeepSeek nên timeout trong luôn nhỏ hơn hẳn
 * timeout ngoài, không còn cảnh 2 mốc bằng nhau rồi tranh nhau bung trước.
 */
export const PAAST_DEFAULT_TIMEOUT_MS = 120000;

/** Ngân sách cho /upgrade: Django chạy 2 lượt LLM nối tiếp (viết rồi chấm lại) nên cần dài hơn. */
const PAAST_UPGRADE_TIMEOUT_MS = 240000;

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
   */
  async findLatestByContent(userId: string, content: string) {
    const candidates = await this.prisma.paastAnalysisHistory.findMany({
      where: { user_id: userId, input_text: content, status: TransformStatus.SUCCESS },
      orderBy: { created_at: 'desc' },
      take: 5,
    });

    // Phải khớp CẢ nội dung LẪN phiên bản logic chấm. Bản ghi chấm bằng công thức đời trước
    // (hoặc chấm từ khi chưa có cơ chế version, nên không có `logic_version`) bị coi là cache
    // miss và sẽ được chấm lại thật — không trả về điểm tính theo công thức đã lỗi thời.
    return (
      candidates.find(
        (c) => (c.analysis_result as any)?.logic_version === PAAST_LOGIC_VERSION,
      ) || null
    );
  }

  /**
   * Chấm điểm PAAST cho 1 đoạn content — CHỈ gọi AI service và trả kết quả thô, KHÔNG ghi
   * lịch sử, KHÔNG nuốt lỗi (ném ra để bên gọi tự quyết định retry/hiển thị).
   *
   * Tách riêng để các module khác (hiện tại: content-transform) tái dùng đúng logic chấm điểm
   * này mà không bị ép tạo thêm 1 bản ghi `paast_analysis_history` song song với bản ghi lịch
   * sử của chính chúng. `analyzeContent` bên dưới vẫn là đường dùng cho màn PAAST Analyzer độc
   * lập (có ghi lịch sử) và gọi lại đúng hàm này, nên 2 nơi không thể lệch nhau.
   */
  async analyzeText(content: string, timeoutMs = PAAST_DEFAULT_TIMEOUT_MS): Promise<PaastAnalysisPayload> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiServiceUrl}/api/ai/paast/analyze/`,
        // Giây, không phải ms — khớp tham số `timeout_seconds` mà view Django đọc.
        { content, timeout_seconds: Math.ceil(timeoutMs / 1000) },
        { timeout: timeoutMs },
      ),
    );

    const { layers, total_score, cta_warning } = response.data;
    return { layers, total_score, cta_warning };
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
      const { layers, total_score, cta_warning } = await this.analyzeText(dto.content);
      const durationMs = Date.now() - startTime;

      return this.prisma.paastAnalysisHistory.update({
        where: { id: history.id },
        data: {
          // `as any`: Prisma InputJsonValue đòi index signature, interface PAAST có shape cố định.
          // `logic_version` để findLatestByContent biết bản ghi này chấm bằng công thức nào.
          analysis_result: { layers, cta_warning, logic_version: PAAST_LOGIC_VERSION } as any,
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
   * Trích các tiêu chí đang `miss` từ 1 bản phân tích đã lưu (loại tiêu chí `na` của Stick
   * — không thể "nâng cấp" phần cần production bằng cách sửa text, business doc §11.2).
   */
  extractMissingElements(analysisResult: any): PaastMissingElement[] {
    const layers = analysisResult?.layers || {};
    const missing: PaastMissingElement[] = [];
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
          {
            original_content: original.input_text,
            missing_elements: missingElements,
            timeout_seconds: Math.ceil(PAAST_UPGRADE_TIMEOUT_MS / 1000),
          },
          { timeout: PAAST_UPGRADE_TIMEOUT_MS },
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
            changes_added,
            logic_version: PAAST_LOGIC_VERSION,
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

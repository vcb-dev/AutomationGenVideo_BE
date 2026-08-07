import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PaastAnalysisPayload, PaastMissingElement } from './interfaces/paast-analysis.interface';

/**
 * PaastAnalyzerService — chỉ còn phần dùng chung: gọi AI service (Django) để chấm điểm PAAST
 * và trích các tiêu chí `miss` từ 1 bản phân tích. Phần điều phối lưu lịch sử/nâng cấp cho màn
 * PAAST Analyzer độc lập đã chuyển sang AiIntegrationService (xem module `ai-integration`,
 * theo nhánh ninh) — service này giờ chỉ tồn tại để content-transform tái dùng logic chấm điểm
 * mà không phải gọi qua HTTP nội bộ (xem content-transform.service.ts).
 */
@Injectable()
export class PaastAnalyzerService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get aiServiceUrl(): string {
    return this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
  }

  /**
   * Chấm điểm PAAST cho 1 đoạn content — CHỈ gọi AI service và trả kết quả thô, KHÔNG ghi
   * lịch sử, KHÔNG nuốt lỗi (ném ra để bên gọi tự quyết định retry/hiển thị).
   *
   * Dùng bởi content-transform (luồng /rescore) để tái dùng đúng logic chấm điểm mà không bị
   * ép tạo thêm 1 bản ghi `paast_analysis_history` song song với bản ghi lịch sử của chính nó.
   */
  async analyzeText(content: string, timeoutMs: number): Promise<PaastAnalysisPayload> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiServiceUrl}/api/ai/paast/analyze/`,
        { content },
        { timeout: timeoutMs },
      ),
    );

    const { layers, total_score, cta_warning, verdict } = response.data;
    return { layers, total_score, cta_warning, verdict };
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
}

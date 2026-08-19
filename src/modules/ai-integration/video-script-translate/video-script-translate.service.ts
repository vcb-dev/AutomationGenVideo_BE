import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { catchError, firstValueFrom } from "rxjs";
import { AxiosError } from "axios";

/**
 * Dịch content/hashtags video script sang AI Service. Tách khỏi AiIntegrationService theo
 * cùng pattern với PaastService (../paast/paast.service.ts) — CHƯA được đăng ký làm provider
 * trong AiIntegrationModule. AiIntegrationService vẫn giữ nguyên bản gốc của
 * translateVideoScript(), và 3 nơi đang gọi (video-script.service.ts, catalog.service.ts,
 * ai-integration.controller.ts) vẫn gọi qua AiIntegrationService, chưa qua đây.
 */
@Injectable()
export class VideoScriptTranslateService {
  private readonly logger = new Logger(VideoScriptTranslateService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      "AI_SERVICE_URL",
      "http://localhost:8000",
    );
  }

  /**
   * Dịch lại content/hashtags hiện có (vd sau khi user sửa tay) sang một ngôn ngữ đã biết trước —
   * không đọc lại file nguồn, không sinh script mới, chỉ dịch (xem VideoScriptService.translate()).
   */
  async translateVideoScript(params: {
    content: string;
    hashtags: string[];
    language?: string;
    market?: string;
  }): Promise<any> {
    const url = `${this.aiServiceUrl}/api/task-auto/video-script/translate/`;
    this.logger.log(
      `Calling AI Service: ${url} for language=${params.language ?? "(auto từ market=" + params.market + ")"}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.httpService
          .post(url, params, {
            timeout: 120000,
          })
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.error(
                `AI Service video-script translate error: ${error.message}`,
                error.response?.data,
              );
              throw new HttpException(
                error.response?.data || "Failed to translate video script",
                error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }),
          ),
      );
      return data;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to translate video script",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

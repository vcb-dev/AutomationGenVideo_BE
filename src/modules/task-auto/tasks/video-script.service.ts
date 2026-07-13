import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AiIntegrationService } from "../../ai-integration/ai-integration.service";

export interface GenerateScriptParams {
  fileUrl?: string | null;
  scriptText?: string | null;
  contentTitle?: string | null;
  contentLine?: string | null;
  contentMarket?: string | null;
  productName?: string | null;
  productSku?: string | null;
  productPrice?: string | null;
  productMaterial?: string | null;
  productPriceSegment?: string | null;
  productLine?: string | null;
  productMarket?: string | null;
}

/** input_hash placeholder cho row được tạo từ việc user tự gõ tay (chưa từng gọi AI generate) —
 *  không phải sha256 thật nên sẽ không bao giờ trùng với hash của bất kỳ GenerateScriptParams nào,
 *  đảm bảo lần "Sinh content AI" đầu tiên sau đó luôn gọi AI thật thay vì tưởng nhầm là cache. */
const MANUAL_INPUT_HASH = "manual-edit";

export interface VideoScriptResult {
  content: string;
  hashtags: string[];
  translation?: {
    language: string;
    content: string;
    hashtags: string[];
  } | null;
}

@Injectable()
export class VideoScriptService {
  private readonly logger = new Logger(VideoScriptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  async getCached(taskId: string): Promise<VideoScriptResult | null> {
    const cached = await this.prisma.taskVideoScript.findUnique({
      where: { task_id: taskId },
    });
    if (!cached) return null;
    return {
      content: cached.content,
      hashtags: cached.hashtags,
      translation:
        (cached.translation as VideoScriptResult["translation"]) ?? null,
    };
  }

  async generate(
    taskId: string,
    params: GenerateScriptParams,
    force = false,
  ): Promise<{ script: VideoScriptResult; cached: boolean }> {
    const inputHash = this.hashParams(params);

    if (!force) {
      const existing = await this.prisma.taskVideoScript.findUnique({
        where: { task_id: taskId },
      });
      if (existing && existing.input_hash === inputHash) {
        this.logger.log(
          `Task ${taskId}: dùng lại content đã cache (input không đổi) — tiết kiệm token`,
        );
        return {
          script: {
            content: existing.content,
            hashtags: existing.hashtags,
            translation:
              (existing.translation as VideoScriptResult["translation"]) ??
              null,
          },
          cached: true,
        };
      }
    }

    const script: VideoScriptResult =
      await this.aiIntegration.generateVideoScript(params);

    await this.prisma.taskVideoScript.upsert({
      where: { task_id: taskId },
      create: {
        task_id: taskId,
        input_hash: inputHash,
        content: script.content,
        hashtags: script.hashtags,
        translation: script.translation ?? undefined,
      },
      update: {
        input_hash: inputHash,
        content: script.content,
        hashtags: script.hashtags,
        translation: script.translation ?? null,
      },
    });

    return { script, cached: false };
  }

  /**
   * Cho phép user tự gõ tay content/hashtags — kể cả khi task CHƯA từng sinh AI (upsert).
   * Nếu `dto.translation` được gửi kèm (user tự sửa tay bản dịch), merge vào — vẫn giữ
   * nguyên `language` cũ (chỉ đổi text). Nếu không gửi, `translation` giữ nguyên như cũ —
   * FE tự quyết định gọi thêm `translate()` (AI dịch lại) hay không sau khi save.
   */
  async update(
    taskId: string,
    dto: {
      content: string;
      hashtags?: string[];
      translation?: { content: string; hashtags?: string[] };
    },
  ): Promise<VideoScriptResult> {
    const existing = await this.prisma.taskVideoScript.findUnique({
      where: { task_id: taskId },
    });

    let translation = existing?.translation as VideoScriptResult["translation"];
    if (dto.translation) {
      if (!translation?.language) {
        throw new BadRequestException(
          "Task này chưa có bản dịch nào để sửa",
        );
      }
      translation = {
        language: translation.language,
        content: dto.translation.content,
        hashtags: dto.translation.hashtags ?? translation.hashtags,
      };
    }

    const updated = await this.prisma.taskVideoScript.upsert({
      where: { task_id: taskId },
      create: {
        task_id: taskId,
        input_hash: existing?.input_hash ?? MANUAL_INPUT_HASH,
        content: dto.content,
        hashtags: dto.hashtags ?? [],
        translation: dto.translation ? translation : undefined,
      },
      update: {
        content: dto.content,
        ...(dto.hashtags ? { hashtags: dto.hashtags } : {}),
        ...(dto.translation ? { translation } : {}),
      },
    });

    return {
      content: updated.content,
      hashtags: updated.hashtags,
      translation:
        (updated.translation as VideoScriptResult["translation"]) ?? null,
    };
  }

  /**
   * Dịch content/hashtags hiện tại sang ngôn ngữ đích.
   * Ưu tiên tái dùng `language` của bản dịch cũ (nếu có) để nhất quán; nếu task chưa từng có
   * bản dịch nào (vd content được gõ tay, chưa từng qua AI generate), dùng `market` truyền vào
   * để AI tự xác định ngôn ngữ phù hợp cho thị trường đó.
   */
  async translate(taskId: string, market?: string | null): Promise<VideoScriptResult> {
    const existing = await this.prisma.taskVideoScript.findUnique({
      where: { task_id: taskId },
    });
    if (!existing) {
      throw new NotFoundException("Task chưa có video script để dịch");
    }
    const currentTranslation =
      existing.translation as VideoScriptResult["translation"];
    const language = currentTranslation?.language;
    if (!language && !market) {
      throw new BadRequestException(
        "Cần biết thị trường mục tiêu để xác định ngôn ngữ cần dịch",
      );
    }

    const translated = await this.aiIntegration.translateVideoScript({
      content: existing.content,
      hashtags: existing.hashtags,
      language: language ?? undefined,
      market: language ? undefined : (market ?? undefined),
    });

    const updated = await this.prisma.taskVideoScript.update({
      where: { task_id: taskId },
      data: { translation: translated },
    });

    return {
      content: updated.content,
      hashtags: updated.hashtags,
      translation:
        (updated.translation as VideoScriptResult["translation"]) ?? null,
    };
  }

  private hashParams(params: GenerateScriptParams): string {
    const normalized = {
      fileUrl: params.fileUrl ?? null,
      scriptText: params.scriptText ?? null,
      contentTitle: params.contentTitle ?? null,
      contentLine: params.contentLine ?? null,
      contentMarket: params.contentMarket ?? null,
      productName: params.productName ?? null,
      productSku: params.productSku ?? null,
      productPrice: params.productPrice ?? null,
      productMaterial: params.productMaterial ?? null,
      productPriceSegment: params.productPriceSegment ?? null,
      productLine: params.productLine ?? null,
      productMarket: params.productMarket ?? null,
    };
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }
}

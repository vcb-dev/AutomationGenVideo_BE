import { Injectable, Logger } from "@nestjs/common";
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

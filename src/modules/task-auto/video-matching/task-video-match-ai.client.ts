import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  AI_DEFAULT_MIN_CONFIDENCE,
  AiMatchMode,
  AiVerdict,
} from "../../../utils/task-auto/task-video-match.util";

/**
 * Tăng khi đổi prompt/shape gửi AI service (AutomationGenVideo_AI
 * `task_video_match_judge_service.py`) để phán quyết đã cache trong `matched_by.ai` bị hỏi lại.
 */
export const AI_PROMPT_VERSION = 4;

/** Số ca mỗi request — AI service chạy song song 4 ca, trần 20 ca/request. */
const CHUNK_SIZE = 10;

export interface AiJudgeCandidate {
  task_id: string;
  title: string;
  script: string;
  product_names: string[];
  product_skus: string[];
  anchor_at: string | null;
  days_from_video: number | null;
  has_platform_link: boolean;
  linked_videos_same_platform: (string | null)[];
}

export interface AiJudgeCase {
  case_id: string;
  video: {
    platform: string;
    caption: string;
    published_at: string;
    transcript?: string | null;
  };
  candidates: AiJudgeCandidate[];
}

export interface AiJudgeResult extends AiVerdict {
  videoTopic?: string;
  taskTopic?: string;
  error?: string;
}

/**
 * Gọi AI service phân định video ↔ task cho các ca heuristic bỏ trống. Bật/tắt bằng
 * `auto_assign_settings.video_match_ai_enabled`, đọc lại mỗi lượt map. AI service có thể tắt — lỗi mạng
 * không được làm hỏng lượt map: trả `error` cho từng ca, heuristic giữ nguyên, lượt sau hỏi lại.
 */
@Injectable()
export class TaskVideoMatchAiClient {
  private readonly logger = new Logger(TaskVideoMatchAiClient.name);

  readonly minConfidence = AI_DEFAULT_MIN_CONFIDENCE;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Bật trên UI = apply (đủ tự tin thì gắn link). Lỗi đọc DB ⇒ off: thà bỏ AI còn hơn hỏng lượt map. */
  async getMode(): Promise<AiMatchMode> {
    const setting = await this.prisma.autoAssignSetting
      .findUnique({ where: { id: 1 }, select: { video_match_ai_enabled: true } })
      .catch(() => null);
    return setting?.video_match_ai_enabled ? "apply" : "off";
  }

  async judge(
    cases: AiJudgeCase[],
  ): Promise<{ model: string | null; results: Map<string, AiJudgeResult> }> {
    const results = new Map<string, AiJudgeResult>();
    const baseUrl = this.config.get<string>("AI_SERVICE_URL", "http://localhost:8000");
    let usedModel: string | null = null;

    for (let i = 0; i < cases.length; i += CHUNK_SIZE) {
      const chunk = cases.slice(i, i + CHUNK_SIZE);
      try {
        const { data } = await firstValueFrom(
          this.http.post(
            `${baseUrl}/api/task-auto/video-match/judge/`,
            { cases: chunk },
            { timeout: 180_000 },
          ),
        );
        usedModel = data?.model ?? usedModel;
        for (const row of data?.results ?? []) {
          if (!row?.case_id) continue;
          results.set(row.case_id, {
            taskId: row.error ? null : (row.task_id ?? null),
            confidence: Number(row.confidence) || 0,
            reason: row.reason,
            videoTopic: row.video_topic || undefined,
            taskTopic: row.task_topic || undefined,
            ...(row.error ? { error: String(row.error) } : {}),
          });
        }
      } catch (err: any) {
        // AI service tắt/timeout: bỏ các ca còn lại, không chờ timeout lặp lại cho từng lô.
        const message = err?.response?.data?.error || err?.message || "unknown";
        this.logger.warn(`[VIDEO-MATCH][AI] AI service lỗi: ${message}`);
        for (const c of cases.slice(i)) {
          if (!results.has(c.case_id)) {
            results.set(c.case_id, { taskId: null, confidence: 0, error: String(message) });
          }
        }
        break;
      }
    }
    return { model: usedModel, results };
  }
}

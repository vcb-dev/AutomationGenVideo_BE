import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { createHmac } from "crypto";
import { PrismaService } from "../../../common/prisma/prisma.service";

export interface ApprovalNoticeParams {
  taskId: string;
  teamName: string;
  teamWebhookUrl?: string | null;
  teamWebhookSecret?: string | null;
  personName?: string | null;
  contentTitle?: string | null;
  kind: "CONTENT" | "TASK";
}

export interface GlobalWebhookSettingView {
  webhook_url: string | null;
  webhook_secret_set: boolean;
  source: "database" | "none";
}

interface WebhookTarget {
  url: string;
  secret?: string;
}

@Injectable()
export class LarkWebhookNotifyService {
  private readonly logger = new Logger(LarkWebhookNotifyService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private async getGlobalTarget(): Promise<{ url: string | null; secret: string | null; source: GlobalWebhookSettingView["source"] }> {
    const row = await this.prisma.larkWebhookSetting.findUnique({ where: { id: 1 } }).catch(() => null);
    if (row?.webhook_url) {
      return { url: row.webhook_url, secret: row.webhook_secret, source: "database" };
    }

    return { url: null, secret: null, source: "none" };
  }

  async getGlobalSettingForDisplay(): Promise<GlobalWebhookSettingView> {
    const { url, secret, source } = await this.getGlobalTarget();
    return { webhook_url: url, webhook_secret_set: !!secret, source };
  }

  async updateGlobalSetting(
    dto: { webhook_url?: string | null; webhook_secret?: string | null },
    userId: string,
  ): Promise<GlobalWebhookSettingView> {
    await this.prisma.larkWebhookSetting.upsert({
      where: { id: 1 },
      create: { id: 1, webhook_url: dto.webhook_url ?? null, webhook_secret: dto.webhook_secret ?? null, updated_by: userId },
      update: { ...dto, updated_by: userId },
    });
    return this.getGlobalSettingForDisplay();
  }

  async sendApprovalNotice(params: ApprovalNoticeParams): Promise<void> {
    const global = await this.getGlobalTarget();

    const targets = new Map<string, string | undefined>();
    if (global.url) targets.set(global.url, global.secret || undefined);
    if (params.teamWebhookUrl) targets.set(params.teamWebhookUrl, params.teamWebhookSecret || undefined);
    if (targets.size === 0) return;

    const heading =
      params.kind === "CONTENT"
        ? "📝 Yêu cầu duyệt content mới"
        : "🎬 Task cần duyệt (video đã nộp)";
    const lines = [
      heading,
      `Team: ${params.teamName}`,
      params.contentTitle ? `Nội dung: ${params.contentTitle}` : null,
      params.personName ? `Người gửi: ${params.personName}` : null,
      `Link: ${this.taskUrl(params.taskId)}`,
    ].filter((line): line is string => !!line);

    const text = lines.join("\n");
    await Promise.all(
      [...targets.entries()].map(([url, secret]) => this.post({ url, secret }, text)),
    );
  }

  private taskUrl(taskId: string): string {
    const feUrl = (this.configService.get<string>("FRONTEND_URL") ?? "").replace(/\/$/, "");
    return `${feUrl}/dashboard/task-auto/tasks?taskId=${taskId}`;
  }

  private sign(timestamp: string, secret: string): string {
    return createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
  }

  private async post(target: WebhookTarget, text: string): Promise<void> {
    const body: Record<string, unknown> = { msg_type: "text", content: { text } };
    if (target.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      body.timestamp = timestamp;
      body.sign = this.sign(timestamp, target.secret);
    }

    try {
      const res = await firstValueFrom(this.httpService.post(target.url, body));
      if (res.data?.code && res.data.code !== 0) {
        this.logger.warn(`[lark-webhook] gửi hỏng (${this.maskUrl(target.url)}): ${res.data?.msg}`);
      }
    } catch (err: any) {
      this.logger.warn(`[lark-webhook] gọi hỏng (${this.maskUrl(target.url)}): ${err?.message}`);
    }
  }

  private maskUrl(url: string): string {
    return url.replace(/[a-f0-9-]{10,}$/i, (m) => `…${m.slice(-6)}`);
  }
}

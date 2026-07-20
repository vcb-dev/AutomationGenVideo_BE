import { ConflictException, Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { PrismaService } from "../prisma/prisma.service";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly configured: boolean;

  constructor(private prisma: PrismaService) {
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    this.configured = Boolean(subject && publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    } else {
      this.logger.warn(
        "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT chưa được cấu hình — Web Push bị vô hiệu hoá.",
      );
    }
  }

  getPublicKey(): string | undefined {
    return process.env.VAPID_PUBLIC_KEY;
  }

  // Không cho phép "chiếm" endpoint đang thuộc user khác — chỉ update khi cùng chủ,
  // create mới khi endpoint chưa tồn tại. Từ chối tường minh (409) thay vì upsert mù,
  // tránh 1 user vô tình/cố ý ghi đè quyền nhận push của người khác trên máy dùng chung.
  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string) {
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: sub.endpoint },
    });
    if (existing && existing.user_id !== userId) {
      throw new ConflictException(
        "Endpoint push này đang thuộc tài khoản khác. Hãy tắt thông báo trên trình duyệt rồi bật lại.",
      );
    }
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent,
      },
      // KHÔNG bao giờ ghi user_id ở nhánh update.
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  // Luôn scope theo userId — không tin endpoint đơn thuần từ body, tránh IDOR
  // (1 user đã login có thể đoán/nhặt endpoint của người khác rồi tắt push của họ).
  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, user_id: userId } });
  }

  // Fire-and-forget: lỗi push không được chặn nghiệp vụ chính (giống triết lý
  // `.catch(() => null)` đã có ở catalog.service.ts notifyUser).
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { user_id: userId } });
    if (subs.length === 0) return;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            this.logger.warn(`Push send failed for subscription=${sub.id}: ${err?.message}`);
          }
        }
      }),
    );
  }
}

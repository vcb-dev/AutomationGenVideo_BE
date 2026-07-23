import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService, PushSubscriptionInput } from "../../../common/push/push.service";
import { QueryNotificationDto } from "./notifications.dto";

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  async findAll(userId: string, q: QueryNotificationDto) {
    const where: any = { user_id: userId };
    if (q.unread_only) where.is_read = false;
    if (q.type) where.type = q.type;

    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          task: {
            select: {
              id: true,
              status: true,
              content: {
                select: {
                  title: true,
                  source_team_content: {
                    select: { title: true, source_editor_content: { select: { title: true } } },
                  },
                },
              },
              editor_content: { select: { title: true } },
              team_content: {
                select: { title: true, source_editor_content: { select: { title: true } } },
              },
            },
          },
        },
        orderBy: [{ created_at: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const flattened = data.map((n) => {
      if (!n.task) return n;
      const { content, editor_content, team_content, ...taskRest } = n.task as any;
      const g_tc = content?.source_team_content;
      const content_title =
        editor_content?.title ??
        team_content?.title ??
        team_content?.source_editor_content?.title ??
        content?.title ??
        g_tc?.title ??
        g_tc?.source_editor_content?.title ??
        null;
      return { ...n, task: { ...taskRest, content_title } };
    });

    return { data: flattened, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { user_id: userId, is_read: false },
    });
    return { count };
  }

  async markRead(id: string, userId: string) {
    const notif = await this.prisma.notification.findUnique({ where: { id } });
    if (!notif || notif.user_id !== userId) {
      throw new NotFoundException("Notification not found");
    }
    return this.prisma.notification.update({
      where: { id },
      data: { is_read: true },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
    return { updated: result.count };
  }

  getVapidPublicKey() {
    return { publicKey: this.push.getPublicKey() ?? null };
  }

  subscribePush(userId: string, sub: PushSubscriptionInput, userAgent?: string) {
    return this.push.subscribe(userId, sub, userAgent);
  }

  async unsubscribePush(userId: string, endpoint: string) {
    await this.push.unsubscribe(userId, endpoint);
    return { success: true };
  }
}

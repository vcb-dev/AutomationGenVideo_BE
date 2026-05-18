import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ChatHistoryService {
  constructor(private prisma: PrismaService) {}

  async getConversations(userId: string) {
    return this.prisma.chatConversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        created_at: true,
        updated_at: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async getMessages(conversationId: string, userId: string) {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conv) return null;

    return this.prisma.chatMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        dashboard: true,
        created_at: true,
      },
    });
  }

  async createConversation(userId: string, title: string) {
    // Kiểm tra user tồn tại trước để tránh foreign key crash
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User ${userId} không tồn tại — vui lòng đăng xuất và đăng nhập lại`);
    return this.prisma.chatConversation.create({
      data: { user_id: userId, title },
    });
  }

  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    dashboard?: any,
  ) {
    const [msg] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: { conversation_id: conversationId, role, content, dashboard: dashboard ?? undefined },
      }),
      this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { updated_at: new Date() },
      }),
    ]);
    return msg;
  }

  async deleteConversation(conversationId: string, userId: string) {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conv) return null;
    await this.prisma.chatConversation.delete({ where: { id: conversationId } });
    return { deleted: true };
  }

  async updateTitle(conversationId: string, userId: string, title: string) {
    return this.prisma.chatConversation.updateMany({
      where: { id: conversationId, user_id: userId },
      data: { title },
    });
  }
}

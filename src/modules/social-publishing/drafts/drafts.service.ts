import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SocialPlatform } from '@prisma/client';

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.socialDraft.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
    });
  }

  async create(userId: string, dto: {
    title?: string; message: string; mediaUrls?: string[];
    platform?: SocialPlatform; accountId?: string; pageId?: string;
  }) {
    return this.prisma.socialDraft.create({
      data: {
        user_id: userId, title: dto.title, message: dto.message,
        media_urls: dto.mediaUrls || [], platform: dto.platform,
        account_id: dto.accountId, page_id: dto.pageId,
        updated_at: new Date(),
      },
    });
  }

  async update(id: string, userId: string, dto: {
    title?: string; message?: string; mediaUrls?: string[];
    platform?: SocialPlatform; accountId?: string;
  }) {
    await this.findOne(id, userId);
    const data: any = { updated_at: new Date() };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.mediaUrls !== undefined) data.media_urls = dto.mediaUrls;
    if (dto.platform !== undefined) data.platform = dto.platform;
    if (dto.accountId !== undefined) data.account_id = dto.accountId;
    return this.prisma.socialDraft.update({ where: { id }, data });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.socialDraft.delete({ where: { id } });
  }

  private async findOne(id: string, userId: string) {
    const draft = await this.prisma.socialDraft.findFirst({ where: { id, user_id: userId } });
    if (!draft) throw new NotFoundException('Draft không tồn tại');
    return draft;
  }
}

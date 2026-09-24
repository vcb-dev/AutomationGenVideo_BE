import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = serializeBigInt(obj[key]);
    }
    return res;
  }
  return obj;
}

@Injectable()
export class ThreadsScraperReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(params: {
    search?: string;
    is_tracked?: boolean;
    is_bookmarked?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ScraperThreadsProfileWhereInput = {
      is_owned: false, // Chỉ hiển thị kênh ngoài được cào
    };

    if (params.search) {
      const q = params.search.trim();
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (params.is_tracked !== undefined) {
      where.is_tracked = params.is_tracked;
    }

    if (params.is_bookmarked !== undefined) {
      where.is_bookmarked = params.is_bookmarked;
    }

    const [total, profiles] = await Promise.all([
      this.prisma.scraperThreadsProfile.count({ where }),
      this.prisma.scraperThreadsProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ is_tracked: 'desc' }, { followers_count: 'desc' }, { created_at: 'desc' }],
        include: {
          _count: {
            select: { posts: true },
          },
        },
      }),
    ]);

    const items = profiles.map((p) => ({
      ...serializeBigInt(p),
      posts_count: p._count.posts,
    }));

    return {
      items,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async getProfileDetail(id: bigint) {
    const profile = await this.prisma.scraperThreadsProfile.findUnique({
      where: { id },
      include: {
        _count: {
          select: { posts: true },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Profile Threads với id ${id} không tồn tại`);
    }

    return {
      ...serializeBigInt(profile),
      posts_count: profile._count.posts,
    };
  }

  async getProfilePosts(
    profileId: bigint,
    params: {
      search?: string;
      media_type?: string;
      sort_by?: 'date' | 'likes' | 'views' | 'replies';
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 24));
    const skip = (page - 1) * limit;

    const where: Prisma.ScraperThreadsPostWhereInput = {
      profile_id: profileId,
    };

    if (params.search) {
      where.text = { contains: params.search.trim(), mode: 'insensitive' };
    }

    if (params.media_type && params.media_type !== 'ALL') {
      where.media_type = params.media_type;
    }

    let orderBy: Prisma.ScraperThreadsPostOrderByWithRelationInput = { date_posted: 'desc' };
    if (params.sort_by === 'likes') {
      orderBy = { likes_count: 'desc' };
    } else if (params.sort_by === 'views') {
      orderBy = { views_count: 'desc' };
    } else if (params.sort_by === 'replies') {
      orderBy = { replies_count: 'desc' };
    }

    const [total, posts] = await Promise.all([
      this.prisma.scraperThreadsPost.count({ where }),
      this.prisma.scraperThreadsPost.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
    ]);

    return {
      items: serializeBigInt(posts),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }

  async listAllPosts(params: {
    search?: string;
    media_type?: string;
    sort_by?: 'date' | 'likes' | 'views' | 'replies';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 24));
    const skip = (page - 1) * limit;

    const where: Prisma.ScraperThreadsPostWhereInput = {
      profile: {
        is_owned: false, // TUYỆT ĐỐI chỉ hiển thị bài từ kênh ngoài, loại trừ toàn bộ kênh nội bộ công ty
      },
    };

    if (params.search) {
      const q = params.search.trim();
      where.AND = [
        {
          OR: [
            { text: { contains: q, mode: 'insensitive' } },
            { profile: { username: { contains: q, mode: 'insensitive' } } },
            { profile: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    if (params.media_type && params.media_type !== 'ALL') {
      where.media_type = params.media_type;
    }

    let orderBy: Prisma.ScraperThreadsPostOrderByWithRelationInput = { date_posted: 'desc' };
    if (params.sort_by === 'likes') {
      orderBy = { likes_count: 'desc' };
    } else if (params.sort_by === 'views') {
      orderBy = { views_count: 'desc' };
    } else if (params.sort_by === 'replies') {
      orderBy = { replies_count: 'desc' };
    }

    const [total, posts] = await Promise.all([
      this.prisma.scraperThreadsPost.count({ where }),
      this.prisma.scraperThreadsPost.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          profile: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar_url: true,
              is_tracked: true,
            },
          },
        },
      }),
    ]);

    return {
      items: serializeBigInt(posts),
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    };
  }
}


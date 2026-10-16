import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { readAiServiceError } from '../../common/utils/ai-service-error.util';
import { DeleteChannelResult, buildDeleteChannelResult } from '../../common/utils/delete-channel.util';
import {
  ParsedRedditPost,
  ParsedRedditSubreddit,
  RedditAiClientService,
  RedditSearchOptions,
} from './reddit-ai-client.service';
import { serializeRedditPost, serializeRedditSubreddit } from './reddit-serialize.util';

// Reddit ở Khám phá kênh: tìm bài theo từ khoá + cào theo cộng đồng (subreddit) đã lưu. Không có
// cron (người dùng chốt 2026-10-01: chỉ cào khi bấm). AI gọi TikHub, BE là nơi duy nhất ghi DB.
@Injectable()
export class RedditScraperService {
  private readonly logger = new Logger(RedditScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: RedditAiClientService,
  ) {}

  async searchPosts(query: string, options: RedditSearchOptions) {
    const res = await this.callAi(() => this.aiClient.search(query, options));
    const posts = Array.isArray(res?.posts) ? res.posts : [];
    const saved = await this.upsertPosts(posts, null);
    this.logger.log(`[REDDIT] Từ khoá "${query}": lưu ${saved.length} bài`);
    return { query, posts: saved.map(serializeRedditPost) };
  }

  async scrapeSubreddit(name: string, options: RedditSearchOptions) {
    const res = await this.callAi(() => this.aiClient.subreddit(name, options));
    if (!res?.subreddit?.name) {
      throw new HttpException({ error: `Không tìm thấy cộng đồng r/${name} trên Reddit` }, HttpStatus.NOT_FOUND);
    }

    const subreddit = await this.upsertSubreddit(res.subreddit);
    const saved = await this.upsertPosts(Array.isArray(res.posts) ? res.posts : [], subreddit.id);
    this.logger.log(`[REDDIT] r/${subreddit.name}: lưu ${saved.length} bài`);
    return {
      subreddit: serializeRedditSubreddit({ ...subreddit, _count: { posts: await this.countPosts(subreddit.id) } }),
      posts: saved.map(serializeRedditPost),
    };
  }

  // Xoá cứng cộng đồng + bài của nó (khoá ngoại Cascade) — ĐẾM TRƯỚC khi xoá, xem delete-channel.util.
  async deleteSubreddit(id: bigint): Promise<DeleteChannelResult> {
    const subreddit = await this.prisma.scraperRedditSubreddit.findUnique({ where: { id } });
    if (!subreddit) throw new HttpException({ error: 'Không tìm thấy cộng đồng' }, HttpStatus.NOT_FOUND);

    const postsDeleted = await this.countPosts(id);
    await this.prisma.scraperRedditSubreddit.delete({ where: { id } });

    const name = subreddit.display_name || `r/${subreddit.name}`;
    this.logger.warn(`[REDDIT] Đã xoá cộng đồng "${name}" (id=${id}) kèm ${postsDeleted} bài.`);
    return buildDeleteChannelResult(id, name, postsDeleted);
  }

  private countPosts(subredditId: bigint) {
    return this.prisma.scraperRedditPost.count({ where: { subreddit_id: subredditId } });
  }

  // Lỗi AI (thiếu biến TikHub, TikHub từ chối khoá, cộng đồng không tồn tại) hiện nguyên câu AI báo.
  private async callAi<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const aiErr = readAiServiceError(err);
      if (aiErr) throw new HttpException({ error: aiErr.error }, aiErr.status);
      throw err;
    }
  }

  private upsertSubreddit(info: ParsedRedditSubreddit) {
    const data = {
      display_name: info.display_name || `r/${info.name}`,
      title: info.title || '',
      description: info.description || '',
      icon_url: info.icon_url || null,
      subscribers_count: BigInt(info.subscribers_count || 0),
      is_nsfw: Boolean(info.is_nsfw),
      last_scraped_at: new Date(),
    };
    return this.prisma.scraperRedditSubreddit.upsert({
      where: { name: info.name },
      create: { name: info.name, ...data },
      update: data,
    });
  }

  /**
   * Ghi bài theo post_id. Bài tìm theo từ khoá (subredditId = null) KHÔNG xoá liên kết cộng đồng
   * đã có, và bài cào theo cộng đồng không xoá từ khoá đã tìm ra nó trước đó.
   */
  private async upsertPosts(posts: ParsedRedditPost[], subredditId: bigint | null) {
    const saved = [];
    for (const p of posts) {
      if (!p?.post_id || !p.title) continue;
      const data = {
        subreddit_name: p.subreddit_name || '',
        title: p.title,
        text: p.text || '',
        url: p.url || '',
        link_url: p.link_url || null,
        author: p.author || '',
        author_avatar: p.author_avatar || null,
        media_type: p.media_type || 'TEXT',
        thumbnail_url: p.thumbnail_url || null,
        video_url: p.video_url || null,
        score: BigInt(p.score || 0),
        comments_count: BigInt(p.comments_count || 0),
        upvote_ratio: typeof p.upvote_ratio === 'number' ? p.upvote_ratio : null,
        is_nsfw: Boolean(p.is_nsfw),
        date_posted: new Date(p.date_posted),
        ...(subredditId ? { subreddit_id: subredditId } : {}),
        ...(p.search_keyword ? { search_keyword: p.search_keyword } : {}),
      };
      saved.push(
        await this.prisma.scraperRedditPost.upsert({
          where: { post_id: p.post_id },
          create: { post_id: p.post_id, ...data },
          update: data,
        }),
      );
    }
    return saved;
  }
}

import { ScraperRedditPost, ScraperRedditSubreddit } from '@prisma/client';

// BigInt không JSON hoá được, Date phải ra chuỗi ISO — viết rõ từng trường thay vì đệ quy chung
// (bản đệ quy kiểu serializeBigInt biến Date thành {}).

export function serializeRedditPost(p: ScraperRedditPost) {
  return {
    id: Number(p.id),
    post_id: p.post_id,
    subreddit_id: p.subreddit_id === null ? null : Number(p.subreddit_id),
    subreddit_name: p.subreddit_name,
    title: p.title,
    text: p.text,
    url: p.url,
    link_url: p.link_url,
    author: p.author,
    author_avatar: p.author_avatar,
    media_type: p.media_type,
    thumbnail_url: p.thumbnail_url,
    video_url: p.video_url,
    score: Number(p.score),
    comments_count: Number(p.comments_count),
    upvote_ratio: p.upvote_ratio,
    is_nsfw: p.is_nsfw,
    search_keyword: p.search_keyword,
    date_posted: p.date_posted.toISOString(),
    created_at: p.created_at.toISOString(),
  };
}

export function serializeRedditSubreddit(s: ScraperRedditSubreddit & { _count?: { posts: number } }) {
  return {
    id: Number(s.id),
    name: s.name,
    display_name: s.display_name,
    title: s.title,
    description: s.description,
    icon_url: s.icon_url,
    subscribers_count: Number(s.subscribers_count),
    is_nsfw: s.is_nsfw,
    posts_count: s._count?.posts ?? 0,
    last_scraped_at: s.last_scraped_at ? s.last_scraped_at.toISOString() : null,
    created_at: s.created_at.toISOString(),
  };
}

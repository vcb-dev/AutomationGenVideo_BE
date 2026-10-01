// Dữ liệu mẫu rút gọn từ hồi đáp thật của AI (TikHub Reddit, 2026-10-01) — dùng chung cho test Reddit.

export const SUBREDDIT_INFO = {
  name: 'jewelry',
  display_name: 'r/jewelry',
  title: 'JEWELRY (Jewellery)',
  description: 'Welcome to r/Jewelry!',
  icon_url: 'https://styles.redditmedia.com/icon.png',
  subscribers_count: 382636,
  is_nsfw: false,
};

export function aiPost(postId: string, extra: Record<string, unknown> = {}) {
  return {
    post_id: postId,
    title: 'My wedding ring is a Goodwill find!',
    text: 'Found it for $8...',
    url: `https://www.reddit.com/r/jewelry/comments/${postId}/x/`,
    link_url: '',
    subreddit_name: 'jewelry',
    subreddit: SUBREDDIT_INFO,
    author: 'Sleepydotexe',
    author_avatar: 'https://preview.redd.it/a.png',
    media_type: 'GALLERY',
    thumbnail_url: 'https://preview.redd.it/t.jpeg',
    video_url: '',
    score: 5444,
    comments_count: 120,
    upvote_ratio: 0.97,
    is_nsfw: false,
    date_posted: '2026-09-27T20:46:38.752000+00:00',
    search_keyword: '',
    ...extra,
  };
}

/** Prisma giả: upsert trả lại bản ghi như DB thật (BigInt, Date). */
export function buildPrisma() {
  let nextId = 1n;
  const upsertRow = ({ create, update, where }: any) => ({
    id: nextId++,
    ...create,
    ...update,
    ...where,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
  });
  return {
    scraperRedditPost: {
      upsert: jest.fn().mockImplementation(async (args: any) => ({
        subreddit_id: null,
        search_keyword: '',
        ...upsertRow(args),
      })),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    scraperRedditSubreddit: {
      upsert: jest.fn().mockImplementation(async (args: any) => ({ last_scraped_at: null, ...upsertRow(args) })),
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

export function aiError(status: number, error: string) {
  return { isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: { error } } };
}

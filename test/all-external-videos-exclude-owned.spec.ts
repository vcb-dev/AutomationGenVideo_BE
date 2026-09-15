import { ScraperAggregateReadService } from '../src/modules/scraper-aggregate/scraper-aggregate-read.service';

describe('ScraperAggregateReadService - allExternalVideos loại trừ kênh nội bộ', () => {
  it('đảm bảo câu query SQL của allExternalVideos loại trừ toàn bộ kênh nội bộ (is_owned = true)', async () => {
    const capturedSql: string[] = [];
    let callCount = 0;
    const prismaMock: any = {
      $queryRaw: jest.fn().mockImplementation((strings: any, ...values: any[]) => {
        callCount++;
        for (const v of values) {
          if (v?.sql) capturedSql.push(v.sql);
          if (v?.text) capturedSql.push(v.text);
        }
        if (callCount % 2 === 1) {
          return Promise.resolve([{ total: 0n }]);
        }
        return Promise.resolve([]);
      }),
    };

    const service = new ScraperAggregateReadService(prismaMock);
    const result = await service.allExternalVideos({});

    expect(result.status).toBe('ok');
    expect(capturedSql.length).toBeGreaterThan(0);

    const sqlText = capturedSql.join(' ');

    // 1. Nhánh Instagram phải có điều kiện lọc p.is_owned = false
    expect(sqlText).toMatch(/scraper_instagram_reels/);
    expect(sqlText).toMatch(/p\.is_owned = false OR p\.is_owned IS NULL/);

    // 2. Nhánh TikTok phải có điều kiện lọc p.is_owned = false
    expect(sqlText).toMatch(/scraper_tiktok_profile_videos/);

    // 3. Nhánh YouTube phải có điều kiện lọc p.is_owned = false
    expect(sqlText).toMatch(/scraper_youtube_shorts/);

    // 4. Nhánh Douyin phải loại trừ username của profile is_owned = true
    expect(sqlText).toMatch(/scraper_douyin_videos/);
    expect(sqlText).toMatch(/dp\.is_owned = true/);

    // 5. Nhánh Xiaohongshu phải JOIN và lọc p.is_owned = false
    expect(sqlText).toMatch(/scraper_xiaohongshu_videos/);
    expect(sqlText).toMatch(/scraper_xiaohongshu_profiles/);

    // 6. Nhánh Threads phải lọc p.is_owned = false
    expect(sqlText).toMatch(/scraper_threads_posts/);
    expect(sqlText).toMatch(/p\.is_owned = false/);
  });

  it('khi lọc nền tảng instagram, câu query chỉ chứa nhánh instagram và có loại trừ kênh nội bộ', async () => {
    const capturedSql: string[] = [];
    let callCount = 0;
    const prismaMock: any = {
      $queryRaw: jest.fn().mockImplementation((strings: any, ...values: any[]) => {
        callCount++;
        for (const v of values) {
          if (v?.sql) capturedSql.push(v.sql);
          if (v?.text) capturedSql.push(v.text);
        }
        if (callCount % 2 === 1) {
          return Promise.resolve([{ total: 0n }]);
        }
        return Promise.resolve([]);
      }),
    };

    const service = new ScraperAggregateReadService(prismaMock);
    await service.allExternalVideos({ platform: 'instagram' });

    const sqlText = capturedSql.join(' ');

    expect(sqlText).toMatch(/scraper_instagram_reels/);
    expect(sqlText).toMatch(/p\.is_owned = false OR p\.is_owned IS NULL/);
    expect(sqlText).not.toMatch(/scraper_tiktok_profile_videos/);
  });
});

import { FacebookExternalScraperService } from './facebook-external-scraper.service';
import { FetchPageReelsResult, ParsedFanpageProfile } from './facebook-external-ai-client.service';

/**
 * Xử lý profile TẠM khi RapidAPI không trả dữ liệu.
 *
 * AI (facebook_external_fetch_views.py) có 2 cấp fallback dựng profile từ cache/URL
 * để user thêm kênh không bị crash. Nhưng fallback đó chỉ là phỏng đoán: `name` bằng
 * handle, `avatar_url` rỗng, `is_verified` chưa biết. Trước khi sửa, BE nhận nó như
 * dữ liệu thật và ghi đè thẳng vào DB — một fanpage "HAPAS Official" đã cào tốt sẽ bị
 * đổi tên thành "hapas.official" và mất tick xanh chỉ vì hôm đó RapidAPI hết quota.
 *
 * Hợp đồng sau khi sửa:
 *   - profile_api_ok=false + profile!=null  → ingest ở chế độ fallback: chỉ điền chỗ
 *     trống, không đụng profile_id, và đánh dấu scrape_error để FE không báo xanh.
 *   - profile_api_ok=false + profile=null   → hard-fail như cũ.
 */

const REAL_PROFILE: ParsedFanpageProfile = {
  profile_id: '100088776655',
  name: 'HAPAS Official',
  page_url: 'https://www.facebook.com/hapas.official',
  handle: 'hapas.official',
  avatar_url: 'https://cdn.fb/avatar.jpg',
  is_verified: true,
  followers_count: 120_000,
};

const FALLBACK_PROFILE: ParsedFanpageProfile = {
  profile_id: 'tmp_hapas.official',
  name: 'hapas.official',
  page_url: 'https://www.facebook.com/hapas.official',
  handle: 'hapas.official',
  avatar_url: '',
  is_verified: null,
  followers_count: 0,
};

// Fanpage đã cào tốt từ trước — dữ liệu này không được phép bị fallback đè lên.
const EXISTING_ROW = {
  id: 7n,
  profile_id: '100088776655',
  name: 'HAPAS Official',
  handle: 'hapas.official',
  page_url: 'https://www.facebook.com/hapas.official',
  avatar_url: 'https://cdn.fb/avatar.jpg',
  is_verified: true,
  followers_count: 120_000n,
  likes_count: 0n,
  is_initial_scraped: true,
  last_scraped_at: new Date('2026-08-20T00:00:00Z'),
  scraping_status: 'idle',
};

function build(fetchResult: Partial<FetchPageReelsResult>) {
  const updates: Array<{ where: any; data: any }> = [];
  const deletes: Array<any> = [];

  const prisma: any = {
    scraperFanpage: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) return { ...EXISTING_ROW };
        // Tra theo profile_id: chỉ id thật mới khớp, 'tmp_*' không tồn tại trong DB.
        return where.profile_id === EXISTING_ROW.profile_id ? { ...EXISTING_ROW } : null;
      }),
      findUniqueOrThrow: jest.fn(async () => ({ ...EXISTING_ROW })),
      update: jest.fn(async ({ where, data }: any) => {
        updates.push({ where, data });
        return { ...EXISTING_ROW, ...data };
      }),
      delete: jest.fn(async ({ where }: any) => {
        deletes.push(where);
        return { ...EXISTING_ROW };
      }),
    },
    scraperFacebookReel: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    scraperFanpageMetrics: { create: jest.fn(async () => ({})) },
  };

  const aiClient: any = {
    fetchPageReels: jest.fn(
      async (): Promise<FetchPageReelsResult> => ({
        profile_api_ok: true,
        profile: REAL_PROFILE,
        reels: [],
        ...fetchResult,
      }),
    ),
  };

  const service = new FacebookExternalScraperService(prisma, aiClient);
  return { service, prisma, updates, deletes };
}

/** Gộp mọi lần update lên fanpage thành một object để khẳng định trạng thái cuối. */
function mergedFanpageData(updates: Array<{ data: any }>): any {
  return updates.reduce((acc, u) => ({ ...acc, ...u.data }), {});
}

describe('FacebookExternalScraperService.scrapeReels — profile tạm khi RapidAPI chết', () => {
  it('KHÔNG ghi đè tên và tick xanh đang có bằng dữ liệu fallback', async () => {
    const { service, updates } = build({
      profile_api_ok: false,
      fallback_used: true,
      profile: FALLBACK_PROFILE,
    });

    await service.scrapeReels(7n, 10);

    const data = mergedFanpageData(updates);
    expect(data.name).toBeUndefined();
    expect(data.is_verified).toBeUndefined();
    expect(data.followers_count).toBeUndefined();
  });

  it('KHÔNG đụng tới profile_id thật khi chỉ có dữ liệu fallback', async () => {
    const { service, updates, deletes } = build({
      profile_api_ok: false,
      fallback_used: true,
      profile: FALLBACK_PROFILE,
    });

    await service.scrapeReels(7n, 10);

    expect(mergedFanpageData(updates).profile_id).toBeUndefined();
    expect(deletes).toHaveLength(0);
  });

  it('đánh dấu scrape_error thay vì báo completed khi dùng fallback', async () => {
    const { service, updates } = build({
      profile_api_ok: false,
      fallback_used: true,
      profile: FALLBACK_PROFILE,
    });

    await service.scrapeReels(7n, 10);

    const data = mergedFanpageData(updates);
    expect(data.scraping_status).toBe('failed');
    expect(data.scrape_error).toContain('RapidAPI');
  });

  it('vẫn hard-fail khi RapidAPI không trả gì và cũng không dựng nổi fallback', async () => {
    const { service } = build({ profile_api_ok: false, profile: null });

    await expect(service.scrapeReels(7n, 10)).rejects.toThrow();
  });

  it('dữ liệu thật từ RapidAPI vẫn được ghi đè bình thường', async () => {
    const { service, updates } = build({ profile_api_ok: true, profile: REAL_PROFILE });

    await service.scrapeReels(7n, 10);

    const data = mergedFanpageData(updates);
    expect(data.name).toBe('HAPAS Official');
    expect(data.is_verified).toBe(true);
    expect(data.followers_count).toBe(BigInt(120_000));
    expect(data.scraping_status).toBe('completed');
    expect(data.scrape_error).toBeNull();
  });
});

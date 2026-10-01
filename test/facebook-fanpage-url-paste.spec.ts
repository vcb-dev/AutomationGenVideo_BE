import { HttpException } from '@nestjs/common';
import { FacebookExternalScraperService } from '../src/modules/facebook-external-scraper/facebook-external-scraper.service';
import { FacebookExternalScraperReadService } from '../src/modules/facebook-external-scraper/facebook-external-scraper-read.service';
import {
  cleanFacebookUrl,
  extractFacebookPageNumericId,
  extractHandleFromUrl,
  isFacebookPageHandle,
  isFacebookPageShareLink,
  resolveFacebookPageInput,
} from '../src/modules/facebook-external-scraper/facebook-url.util';
import { preferHostedImage } from '../src/common/utils/hosted-thumbnail-url.util';

/**
 * Dán link Facebook vào ô "Thêm kênh" (Khám phá kênh) phải thêm được page ở mọi dạng link
 * người dùng hay copy:
 *   - Page không có tên rút gọn: facebook.com/p/<Tên>-<id>/ — bản cũ báo "Không thể trích
 *     xuất tên page từ URL" vì path có 2 đoạn.
 *   - Copy khi đang ở tab Reels/Video của page: facebook.com/<page>/reels/ — cũng bị từ chối.
 *   - Handle "p" do AI trả cho page /p/... không được ghi vào DB (FE hiện "@p").
 *   - Avatar: cột avatar_drive_url = 'FAILED' không được thắng URL gốc (FE gọi /.../FAILED).
 */

describe('facebook-url.util — chuẩn hoá link page', () => {
  it.each([
    ['https://www.facebook.com/kazan.jewelry', 'https://www.facebook.com/kazan.jewelry/', 'kazan.jewelry'],
    ['https://www.facebook.com/kazan.jewelry/reels/', 'https://www.facebook.com/kazan.jewelry/', 'kazan.jewelry'],
    ['https://www.facebook.com/kazan.jewelry/videos/1234567890/', 'https://www.facebook.com/kazan.jewelry/', 'kazan.jewelry'],
    ['https://m.facebook.com/daychetacvangbac.vn?mibextid=ZbWKwL', 'https://www.facebook.com/daychetacvangbac.vn/', 'daychetacvangbac.vn'],
    ['facebook.com/SenninEskoJewelry/about', 'https://www.facebook.com/SenninEskoJewelry/', 'SenninEskoJewelry'],
    ['https://www.facebook.com/pg/hapas.official/posts/', 'https://www.facebook.com/hapas.official/', 'hapas.official'],
  ])('%s → page gốc có handle', (input, cleanUrl, handle) => {
    expect(cleanFacebookUrl(input)).toBe(cleanUrl);
    expect(extractHandleFromUrl(cleanFacebookUrl(input))).toBe(handle);
    expect(extractFacebookPageNumericId(cleanFacebookUrl(input))).toBe('');
  });

  it.each([
    ['https://www.facebook.com/p/iFacet-61579965066322/', 'https://www.facebook.com/p/iFacet-61579965066322/', '61579965066322'],
    ['https://www.facebook.com/p/House-of-Midas-Luxe-61565578125138/reels/', 'https://www.facebook.com/p/House-of-Midas-Luxe-61565578125138/', '61565578125138'],
    ['https://www.facebook.com/people/Wen-Huang/61590472511842/?sk=reels_tab', 'https://www.facebook.com/people/Wen-Huang/61590472511842/', '61590472511842'],
    ['https://www.facebook.com/profile.php?id=100063576820959&sk=reels_tab', 'https://www.facebook.com/profile.php?id=100063576820959', '100063576820959'],
  ])('%s → page không tên rút gọn, định danh bằng ID số', (input, cleanUrl, numericId) => {
    expect(cleanFacebookUrl(input)).toBe(cleanUrl);
    expect(extractHandleFromUrl(cleanUrl)).toBe('');
    expect(extractFacebookPageNumericId(cleanUrl)).toBe(numericId);
  });

  it.each([
    'https://www.facebook.com/watch/?v=123',
    'https://www.facebook.com/reel/1836282150691344/',
    'https://www.facebook.com/groups/123456/',
    'https://www.facebook.com/share/1AbCdEfGh/',
    'https://www.facebook.com/p/',
  ])('%s → không phải page', (input) => {
    const cleanUrl = cleanFacebookUrl(input);
    expect(extractHandleFromUrl(cleanUrl)).toBe('');
    expect(extractFacebookPageNumericId(cleanUrl)).toBe('');
  });

  it('isFacebookPageHandle loại các đoạn path cố định của Facebook', () => {
    for (const h of ['p', 'P', 'people', 'profile.php', 'share', 'watch', 'reel', 'groups', '', null, undefined]) {
      expect(isFacebookPageHandle(h as any)).toBe(false);
    }
    expect(isFacebookPageHandle('kazan.jewelry')).toBe(true);
  });

  it('isFacebookPageShareLink chỉ nhận link chia sẻ PAGE, không nhận link chia sẻ bài/reel', () => {
    expect(isFacebookPageShareLink('https://www.facebook.com/share/1AbCdEfGh/')).toBe(true);
    expect(isFacebookPageShareLink('https://www.facebook.com/share/r/1AbCdEfGh/')).toBe(false);
    expect(isFacebookPageShareLink('https://www.facebook.com/kazan.jewelry')).toBe(false);
  });

  it('resolveFacebookPageInput giữ nguyên link thường, không gọi mạng', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(resolveFacebookPageInput('https://www.facebook.com/p/iFacet-61579965066322/')).resolves.toBe(
      'https://www.facebook.com/p/iFacet-61579965066322/',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('FacebookExternalScraperService.scrapeByUrl — dán link page', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // fetchFacebookPageMeta đọc OpenGraph của page — cắt mạng, cho rơi về fallback.
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  });
  afterEach(() => fetchSpy.mockRestore());

  function buildService(existing: any = null) {
    const created: any[] = [];
    const prisma: any = {
      scraperFanpage: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: 7n, scraping_status: 'idle', is_initial_scraped: false, ...data };
          created.push(row);
          return row;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new FacebookExternalScraperService(prisma, {} as any);
    jest
      .spyOn(service as any, 'ingestReelsSyncFirst')
      .mockResolvedValue({ reels_returned: 0, created: 0, fallback_used: false });
    return { service, prisma, created };
  }

  it('link /p/<Tên>-<id>/ thêm được kênh, handle rỗng, page_url chuẩn', async () => {
    const { service, created } = buildService();
    const res = await service.scrapeByUrl('https://www.facebook.com/p/iFacet-61579965066322/reels/', 10);

    expect(res.fanpage_id).toBe(7);
    expect(created).toHaveLength(1);
    expect(created[0].handle).toBe('');
    expect(created[0].page_url).toBe('https://www.facebook.com/p/iFacet-61579965066322/');
  });

  it('link tab Reels của page có tên rút gọn thêm được kênh với đúng handle', async () => {
    const { service, created } = buildService();
    await service.scrapeByUrl('https://www.facebook.com/kazan.jewelry/reels/', 10);
    expect(created[0].handle).toBe('kazan.jewelry');
    expect(created[0].page_url).toBe('https://www.facebook.com/kazan.jewelry/');
  });

  it('page đã có (khớp profile_id = ID số trong link) thì không tạo trùng', async () => {
    const existing = { id: 26n, name: 'iFacet', is_initial_scraped: true, scraping_status: 'idle' };
    const { service, prisma } = buildService(existing);

    const res = await service.scrapeByUrl('https://www.facebook.com/profile.php?id=61579965066322', 10);

    expect(res.already_exists).toBe(true);
    expect(prisma.scraperFanpage.create).not.toHaveBeenCalled();
    const where = prisma.scraperFanpage.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { page_url: 'https://www.facebook.com/profile.php?id=61579965066322' },
        { profile_id: '61579965066322' },
      ]),
    );
  });

  it('link chia sẻ page báo lỗi rõ cách sửa, không tạo kênh rác', async () => {
    const { service, prisma } = buildService();
    const err = await service.scrapeByUrl('https://www.facebook.com/share/1AbCdEfGh/', 10).catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().error).toContain('copy URL trên thanh địa chỉ');
    expect(prisma.scraperFanpage.create).not.toHaveBeenCalled();
  });

  it('link không phải page (watch/reel) báo 400 thay vì tạo kênh "watch"', async () => {
    const { service, prisma } = buildService();
    for (const url of ['https://www.facebook.com/watch/?v=123', 'https://www.facebook.com/reel/1836282150691344/']) {
      const err = await service.scrapeByUrl(url, 10).catch((e) => e);
      expect(err.getStatus()).toBe(400);
    }
    expect(prisma.scraperFanpage.create).not.toHaveBeenCalled();
  });
});

describe('FacebookExternalScraperService.applyFanpageUpdate — handle từ AI', () => {
  function buildService(current: any) {
    const prisma: any = {
      scraperFanpage: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => (where.id ? current : null)),
        update: jest.fn().mockResolvedValue({ id: current.id }),
        delete: jest.fn(),
      },
    };
    return { service: new FacebookExternalScraperService(prisma, {} as any), prisma };
  }

  const profile = {
    profile_id: '405898282610977',
    name: 'House of Midas Luxe',
    page_url: 'https://www.facebook.com/p/House-of-Midas-Luxe-61565578125138/',
    handle: 'p',
    avatar_url: 'https://cdn.fb/a.jpg',
    is_verified: null,
    followers_count: 53700,
  };

  it('không ghi handle "p" khi cập nhật bằng dữ liệu thật', async () => {
    const { service, prisma } = buildService({ id: 30n, profile_id: '405898282610977', handle: '' });
    await (service as any).applyFanpageUpdate(30n, profile);
    const data = prisma.scraperFanpage.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('handle');
    expect(data.name).toBe('House of Midas Luxe');
  });

  it('không ghi handle "p" khi cập nhật bằng profile tạm', async () => {
    const { service, prisma } = buildService({ id: 30n, profile_id: 'tmp_1', handle: '', name: '', avatar_url: null, followers_count: 0n });
    await (service as any).applyFanpageUpdate(30n, profile, true);
    const data = prisma.scraperFanpage.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('handle');
  });

  it('vẫn ghi handle thật', async () => {
    const { service, prisma } = buildService({ id: 1n, profile_id: '1', handle: '' });
    await (service as any).applyFanpageUpdate(1n, { ...profile, profile_id: '1', handle: 'kazan.jewelry' });
    expect(prisma.scraperFanpage.update.mock.calls.at(-1)[0].data.handle).toBe('kazan.jewelry');
  });
});

describe('Ảnh fanpage/reel — bỏ qua dấu FAILED của ThumbnailMigration', () => {
  it('preferHostedImage', () => {
    expect(preferHostedImage('https://res.cloudinary.com/x.jpg', 'https://fbcdn/a.jpg')).toBe('https://res.cloudinary.com/x.jpg');
    expect(preferHostedImage('FAILED', 'https://fbcdn/a.jpg')).toBe('https://fbcdn/a.jpg');
    expect(preferHostedImage(null, 'https://fbcdn/a.jpg')).toBe('https://fbcdn/a.jpg');
    expect(preferHostedImage('FAILED', 'FAILED')).toBeNull();
    expect(preferHostedImage('FAILED', null)).toBeNull();
  });

  it('API danh sách fanpage trả avatar gốc khi avatar_drive_url = FAILED', () => {
    const read = new FacebookExternalScraperReadService({} as any);
    const out = (read as any).serializeFanpage(
      {
        id: 36n,
        profile_id: '100063576820959',
        name: 'Dạy nghề chế tác vàng bạc',
        handle: 'daychetacvangbac.vn',
        avatar_url: 'https://scontent.fbcdn.net/a.jpg',
        avatar_drive_url: 'FAILED',
        followers_count: 0n,
        likes_count: 0n,
      },
      10,
    );
    expect(out.avatar_url).toBe('https://scontent.fbcdn.net/a.jpg');
  });
});

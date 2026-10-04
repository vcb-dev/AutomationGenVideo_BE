import { FacebookExternalScraperService } from '../src/modules/facebook-external-scraper/facebook-external-scraper.service';
import { isFacebookPageHandle } from '../src/modules/facebook-external-scraper/facebook-url.util';

/**
 * Page không có tên rút gọn (facebook.com/p/<Tên>-<id>/) bị AI trả handle "p" — BE ghi thẳng
 * vào DB nên Khám phá kênh hiện "@p" (6/14 fanpage local ngày 2026-10-01). BE không ghi handle
 * là đoạn path cố định của Facebook nữa; migration 20261001090000 xoá "p" đã lưu.
 */

describe('isFacebookPageHandle', () => {
  it('loại các đoạn path cố định của Facebook', () => {
    for (const h of ['p', 'P', 'people', 'profile.php', 'share', 'watch', 'reel', 'groups', '', null, undefined]) {
      expect(isFacebookPageHandle(h as any)).toBe(false);
    }
    expect(isFacebookPageHandle('kazan.jewelry')).toBe(true);
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

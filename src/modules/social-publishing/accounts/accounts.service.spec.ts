import { SocialPlatform } from '@prisma/client';
import { AccountsService } from './accounts.service';

/**
 * Hành vi CỐ Ý (xác nhận từ chủ dự án): account mặc định chia sẻ cho toàn hệ
 * thống. Khi omit isShared, cả tạo mới lẫn cập nhật đều set is_shared = true;
 * khi truyền tường minh thì tôn trọng giá trị đó.
 */
describe('AccountsService.saveAccount — is_shared default', () => {
  function build(existing: any) {
    const calls: { update?: any; create?: any } = {};
    const prisma: any = {
      socialAccount: {
        findFirst: jest.fn(async () => existing),
        update: jest.fn(async ({ data }: any) => { calls.update = data; return { id: 'a1', ...data }; }),
        create: jest.fn(async ({ data }: any) => { calls.create = data; return { id: 'a1', ...data }; }),
      },
    };
    const crypto: any = { encrypt: jest.fn(() => 'enc') };
    const instagramScraper: any = { scrapeProfile: jest.fn(async () => ({})) };
    const service = new AccountsService(prisma, crypto, instagramScraper);
    return { service, calls };
  }

  const baseData = {
    platform: SocialPlatform.FACEBOOK,
    platformId: 'pid',
    name: 'Acc',
    accessToken: 'tok',
  };

  afterEach(() => jest.clearAllMocks());

  it('defaults is_shared=true on create', async () => {
    const { service, calls } = build(null);
    try {
      await service.saveAccount('u1', { ...baseData });
      expect(calls.create.is_shared).toBe(true);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('defaults is_shared=true on update (re-save / reconnect) — by design', async () => {
    const { service, calls } = build({ id: 'a1' });
    try {
      await service.saveAccount('u1', { ...baseData });
      expect(calls.update.is_shared).toBe(true);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('respects an explicit is_shared=false', async () => {
    const { service, calls } = build({ id: 'a1' });
    try {
      await service.saveAccount('u1', { ...baseData, isShared: false });
      expect(calls.update.is_shared).toBe(false);
    } finally {
      service.onModuleDestroy();
    }
  });
});

/**
 * autoSaveFacebookPages lặp qua TẤT CẢ Page mỗi lần user resync Facebook, kể cả Page
 * đã lưu từ trước. Guard existingIgAccount đảm bảo chỉ cào profile Instagram cho account
 * MỚI kết nối lần đầu — tránh bắn hàng loạt request cào trùng mỗi lần user bấm "Đồng bộ".
 */
describe('AccountsService.saveFacebookPageAccount — auto-scrape guard', () => {
  function build(existingIgAccount: any) {
    const prisma: any = {
      socialAccount: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.platform === SocialPlatform.INSTAGRAM && where.platform_id) return existingIgAccount;
          if (where.id) return { id: where.id, user_id: where.user_id }; // findOneOwned (parent page)
          return null; // existing-check cho page account (FACEBOOK) — luôn tạo mới trong test
        }),
        update: jest.fn(async ({ data }: any) => ({ id: 'acc1', ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: 'acc1', ...data })),
      },
    };
    const crypto: any = { encrypt: jest.fn(() => 'enc') };
    const instagramScraper: any = { scrapeProfile: jest.fn(async () => ({})) };
    const service = new AccountsService(prisma, crypto, instagramScraper);
    return { service, instagramScraper };
  }

  const baseOpts = {
    parentAccountId: 'parent1',
    pageId: 'page1',
    pageName: 'Page',
    pageToken: 'tok',
    igId: 'ig123',
    igUsername: 'my_ig',
  };

  afterEach(() => jest.clearAllMocks());

  it('cào profile khi Instagram Business account là MỚI kết nối qua Facebook Page', async () => {
    const { service, instagramScraper } = build(null);
    try {
      await service.saveFacebookPageAccount('u1', baseOpts);
      expect(instagramScraper.scrapeProfile).toHaveBeenCalledWith('my_ig', true);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('KHÔNG cào lại profile khi Instagram Business account đã tồn tại (resync token)', async () => {
    const { service, instagramScraper } = build({ id: 'ig-existing' });
    try {
      await service.saveFacebookPageAccount('u1', baseOpts);
      expect(instagramScraper.scrapeProfile).not.toHaveBeenCalled();
    } finally {
      service.onModuleDestroy();
    }
  });
});

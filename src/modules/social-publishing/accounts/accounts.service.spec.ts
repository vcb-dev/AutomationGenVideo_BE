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
    const service = new AccountsService(prisma, crypto);
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

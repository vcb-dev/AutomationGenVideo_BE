/**
 * Kênh nội bộ Facebook phải gồm cả page mọi người đã kết nối ở Đăng bài MXH → Kênh.
 *
 * Sự cố 2026-10-02: admin để mọi người kết nối page ở Đăng bài MXH nhưng Kênh nội bộ chỉ hiện page
 * của tài khoản Facebook hệ thống — nút "Đồng bộ từ Facebook" chỉ hỏi /me/accounts bằng một token.
 * Dữ liệu mẫu theo đúng hình dạng bảng social_accounts thật (DB local 2026-10-02): dòng page có
 * platform_id "page_<id>", extra_data.pageId, parent_id trỏ về dòng tài khoản Facebook gốc.
 */
import { FacebookOwnedPagesService } from '../src/modules/facebook-owned-pages/facebook-owned-pages.service';
import {
  FacebookConnectedPagesService,
  facebookPageIdOf,
  importSummaryMessage,
} from '../src/modules/facebook-owned-pages/facebook-connected-pages.service';

const fbPage = (pageId: string, name: string) => ({
  page_id: pageId,
  name,
  username: '',
  category: 'Jewelry/Watches',
  avatar_url: `https://graph.facebook.com/${pageId}/picture`,
  followers_count: 1200,
  likes_count: 900,
  page_access_token_encrypted: `fernet:${pageId}`,
  raw_data: {},
});

const SYSTEM_PAGE = fbPage('101451428617627', 'HuyK - Chế Tác Trang Sức 2');
const HUUHA_PAGE_1 = fbPage('1285770797944080', 'HuyK - Thợ Đá Quý');
const HUUHA_PAGE_2 = fbPage('1200920816428189', 'HuyK - Xưởng đá quý');
const HUUHA_PERSONAL = fbPage('999000111', 'Page cá nhân chưa bật ở Đăng bài MXH');

interface SocialRow {
  id: string;
  platform_id: string;
  name: string;
  parent_id: string | null;
  access_token_enc: string;
  extra_data: unknown;
}

const root = (id: string, fbUserId: string, name: string, tokenEnc: string): SocialRow => ({
  id, platform_id: fbUserId, name, parent_id: null, access_token_enc: tokenEnc, extra_data: {},
});
const pageRow = (parentId: string, pageId: string): SocialRow => ({
  id: `row-${parentId}-${pageId}`,
  platform_id: `page_${pageId}`,
  name: '',
  parent_id: parentId,
  access_token_enc: 'enc:page-token',
  extra_data: { type: 'page', pageId, parentAccountId: parentId },
});

function setup(opts: {
  socialRows: SocialRow[];
  /** token giải mã → page AI trả về; undefined = token hệ thống */
  pagesByToken: Record<string, ReturnType<typeof fbPage>[]>;
  systemFails?: boolean;
}) {
  const created: string[] = [];
  const prisma: any = {
    socialAccount: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.parent_id) return opts.socialRows.filter((r) => r.parent_id !== null);
        return opts.socialRows.filter((r) => where.id.in.includes(r.id));
      }),
    },
    video_management_managedfacebookpage: {
      findUnique: jest.fn(async () => null),
      update: jest.fn(),
      create: jest.fn(async ({ data }: any) => { created.push(data.page_id); }),
    },
  };
  const aiClient: any = {
    fetchManagedPages: jest.fn(async (token?: string) => {
      if (token === undefined && opts.systemFails) throw new Error('Không tìm thấy FACEBOOK_ACCESS_TOKEN');
      return { pages: opts.pagesByToken[token ?? 'system'] ?? [] };
    }),
  };
  const crypto: any = {
    decrypt: jest.fn((enc: string) => {
      if (enc === 'enc:corrupt') throw new Error('Không thể giải mã token');
      return enc.replace(/^enc:/, '');
    }),
  };
  const ownedPages = new FacebookOwnedPagesService(prisma, aiClient);
  const service = new FacebookConnectedPagesService(prisma, crypto, aiClient, ownedPages);
  return { service, aiClient, crypto, created };
}

describe('Kênh nội bộ Facebook gộp page từ tài khoản kết nối ở Đăng bài MXH', () => {
  it('page người khác kết nối ở Đăng bài MXH được đưa vào Kênh nội bộ, dùng token của chính người đó', async () => {
    const { service, aiClient, created } = setup({
      socialRows: [
        root('acc-huuha', '2071700113734159', 'Hữu Hà', 'enc:huuha-user-token'),
        pageRow('acc-huuha', HUUHA_PAGE_1.page_id),
        pageRow('acc-huuha', HUUHA_PAGE_2.page_id),
      ],
      pagesByToken: { system: [SYSTEM_PAGE], 'huuha-user-token': [HUUHA_PAGE_1, HUUHA_PAGE_2] },
    });

    const result = await service.importAll();

    expect(aiClient.fetchManagedPages).toHaveBeenCalledWith('huuha-user-token');
    expect(created.sort()).toEqual([SYSTEM_PAGE.page_id, HUUHA_PAGE_1.page_id, HUUHA_PAGE_2.page_id].sort());
    expect(result).toMatchObject({ created: 3, updated: 0, connectedPages: 2, failedAccounts: [] });
    // page mới (cả hai nguồn) đều được trả về để controller/cron tự backfill
    expect(result.newPageIds).toEqual(expect.arrayContaining([HUUHA_PAGE_1.page_id, HUUHA_PAGE_2.page_id]));
  });

  it('chỉ lấy page người đó đang bật ở Đăng bài MXH, không kéo page cá nhân khác họ quản lý', async () => {
    const { service, created } = setup({
      socialRows: [root('acc-huuha', '2071700113734159', 'Hữu Hà', 'enc:huuha-user-token'), pageRow('acc-huuha', HUUHA_PAGE_1.page_id)],
      pagesByToken: { 'huuha-user-token': [HUUHA_PAGE_1, HUUHA_PERSONAL] },
    });

    await service.importAll();

    expect(created).toEqual([HUUHA_PAGE_1.page_id]);
  });

  it('page token hệ thống đã kéo thì không gọi AI lần nữa cho tài khoản đó (giữ token hệ thống)', async () => {
    const { service, aiClient } = setup({
      socialRows: [root('acc-admin', '1000', 'Nguyễn Toàn', 'enc:admin-token'), pageRow('acc-admin', SYSTEM_PAGE.page_id)],
      pagesByToken: { system: [SYSTEM_PAGE] },
    });

    const result = await service.importAll();

    expect(aiClient.fetchManagedPages).toHaveBeenCalledTimes(1);
    expect(aiClient.fetchManagedPages).toHaveBeenCalledWith(undefined);
    expect(result.connectedPages).toBe(0);
  });

  it('một tài khoản Facebook nhiều người kết nối: gọi AI theo token mới nhất, hỏng thì thử token kế', async () => {
    const { service, aiClient, created } = setup({
      socialRows: [
        // findMany roots trả theo updated_at desc — lượt kết nối mới nhất đứng trước
        root('acc-new', '555', 'Bui Duy Cuong', 'enc:corrupt'),
        root('acc-old', '555', 'Bui Duy Cuong', 'enc:old-valid-token'),
        pageRow('acc-new', HUUHA_PAGE_1.page_id),
        pageRow('acc-old', HUUHA_PAGE_1.page_id),
      ],
      pagesByToken: { 'old-valid-token': [HUUHA_PAGE_1] },
    });

    const result = await service.importAll();

    expect(aiClient.fetchManagedPages.mock.calls.filter(([t]: [string?]) => t !== undefined)).toEqual([['old-valid-token']]);
    expect(created).toEqual([HUUHA_PAGE_1.page_id]);
    expect(result.failedAccounts).toEqual([]);
  });

  it('token người kết nối đã chết → báo tên tài khoản để nhờ họ kết nối lại, không làm hỏng cả lượt', async () => {
    const { service, created } = setup({
      socialRows: [
        root('acc-huuha', '2071700113734159', 'Hữu Hà', 'enc:expired-token'),
        pageRow('acc-huuha', HUUHA_PAGE_1.page_id),
      ],
      pagesByToken: { system: [SYSTEM_PAGE] },
    });

    const result = await service.importAll();

    expect(created).toEqual([SYSTEM_PAGE.page_id]);
    expect(result.failedAccounts).toEqual(['Hữu Hà']);
    expect(importSummaryMessage(result)).toBe(
      'Đã đồng bộ xong danh sách Page (Thêm mới: 1, Cập nhật: 0). Không lấy được page của: Hữu Hà — ' +
        'nhờ họ kết nối lại Facebook ở Đăng bài MXH → Kênh',
    );
  });

  it('token hệ thống lỗi vẫn gộp được page của người khác; không gộp được gì thì báo lỗi gốc', async () => {
    const ok = setup({
      socialRows: [root('acc-huuha', '1', 'Hữu Hà', 'enc:huuha-user-token'), pageRow('acc-huuha', HUUHA_PAGE_1.page_id)],
      pagesByToken: { 'huuha-user-token': [HUUHA_PAGE_1] },
      systemFails: true,
    });
    await expect(ok.service.importAll()).resolves.toMatchObject({ created: 1, connectedPages: 1 });

    const nothing = setup({ socialRows: [], pagesByToken: {}, systemFails: true });
    await expect(nothing.service.importAll()).rejects.toThrow('Không tìm thấy FACEBOOK_ACCESS_TOKEN');
  });
});

describe('facebookPageIdOf', () => {
  it('đọc pageId từ extra_data, thiếu thì bóc tiền tố page_ của platform_id', () => {
    expect(facebookPageIdOf({ platform_id: 'page_1285770797944080', extra_data: { pageId: '1285770797944080' } })).toBe('1285770797944080');
    expect(facebookPageIdOf({ platform_id: 'page_42', extra_data: null })).toBe('42');
    expect(facebookPageIdOf({ platform_id: '2071700113734159', extra_data: {} })).toBe('');
  });
});

describe('importSummaryMessage', () => {
  it('ghi rõ bao nhiêu page đến từ tài khoản kết nối ở Đăng bài MXH', () => {
    expect(importSummaryMessage({ created: 2, updated: 111, newPageIds: [], connectedPages: 2, failedAccounts: [] })).toBe(
      'Đã đồng bộ xong danh sách Page (Thêm mới: 2, Cập nhật: 111) — gồm 2 page từ tài khoản kết nối ở Đăng bài MXH',
    );
  });
});

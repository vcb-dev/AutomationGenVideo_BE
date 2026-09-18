import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { InstagramOwnedAccountsController } from '../src/modules/instagram-owned-accounts/instagram-owned-accounts.controller';
import { ThreadsOwnedAccountsController } from '../src/modules/threads-owned-accounts/threads-owned-accounts.controller';

/**
 * Chức năng: route ĐỒNG BỘ kênh nội bộ Instagram/Threads phải chặn ở server, không chỉ ẩn nút.
 *
 * Vì sao đáng một file riêng: hai route này gọi Graph API cho từng tài khoản đã kết nối — tốn
 * quota thật và chạy nền vài phút. Trang Instagram nội bộ đã ẩn nút với MEMBER, nhưng ẩn nút chỉ
 * là trang trí: thiếu guard thì một tài khoản MEMBER bất kỳ vẫn POST thẳng vào endpoint được.
 * Trang Threads thậm chí chưa ẩn nút, nên đây là đường ngắn nhất để MEMBER kích hoạt cào dữ liệu.
 */

/** Nest lưu danh sách guard của `@UseGuards` dưới khoá metadata này trên từng phương thức. */
const GUARDS_KEY = '__guards__';

const rolesOf = (controller: any, method: string) =>
  Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);

const guardsOf = (controller: any, method: string): any[] =>
  Reflect.getMetadata(GUARDS_KEY, controller.prototype[method]) ?? [];

describe('Đồng bộ kênh nội bộ — chặn quyền ở server', () => {
  const writeRoutes: Array<[string, any, string]> = [
    ['Instagram sync', InstagramOwnedAccountsController, 'syncAll'],
    ['Threads sync', ThreadsOwnedAccountsController, 'syncAll'],
    ['Threads toggle-owned', ThreadsOwnedAccountsController, 'toggleOwned'],
  ];

  it.each(writeRoutes)('%s chỉ cho ADMIN và LEADER', (_name, controller, method) => {
    expect(guardsOf(controller, method)).toContain(RolesGuard);
    expect(rolesOf(controller, method)).toEqual([UserRole.ADMIN, UserRole.LEADER]);
  });

  it('MEMBER không nằm trong danh sách role được phép của bất kỳ route ghi nào', () => {
    for (const [, controller, method] of writeRoutes) {
      expect(rolesOf(controller, method) ?? []).not.toContain(UserRole.MEMBER);
    }
  });

  it('route ĐỌC danh sách kênh vẫn mở cho mọi người đã đăng nhập', () => {
    // Siết nhầm ở đây thì member không xem nổi kênh nội bộ của chính công ty mình.
    expect(rolesOf(InstagramOwnedAccountsController, 'getProfiles')).toBeUndefined();
    expect(rolesOf(ThreadsOwnedAccountsController, 'getProfiles')).toBeUndefined();
  });
});

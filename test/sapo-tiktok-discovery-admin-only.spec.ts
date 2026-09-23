import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { SapoIntegrationController } from '../src/modules/sapo-integration/sapo-integration.controller';

/**
 * Chức năng: chỉ Admin được quét danh sách kênh TikTok từ đơn hàng Sapo.
 *
 * Vì sao đáng một file riêng: `GET /sapo/tiktok-channels` trả về kênh trích từ đơn hàng của TOÀN
 * CÔNG TY, không phải kênh của riêng người gọi. Mở cho mọi người thì vừa lộ danh sách kênh của
 * người khác, vừa cho phép bất kỳ ai nhập chúng về — mà `syncTiktokChannels` gán
 * `owner_id = người gọi`, nên người nhập nghiễm nhiên thành chủ sở hữu kênh của đồng nghiệp.
 *
 * Ngược lại, `POST /sapo/sync-tiktok-channels` PHẢI mở cho mọi người: đó chính là đường mà nhân
 * sự tự thêm kênh TikTok của mình qua modal "Thêm thủ công". Siết nhầm chỗ này là chặn đúng cái
 * tính năng vừa dựng ra để thay thế việc đồng bộ hàng loạt.
 */

/** Nest lưu danh sách guard của `@UseGuards` dưới khoá metadata này trên từng phương thức. */
const GUARDS_KEY = '__guards__';

const rolesOf = (method: string) =>
  Reflect.getMetadata(ROLES_KEY, SapoIntegrationController.prototype[method]);

const guardsOf = (method: string): any[] =>
  Reflect.getMetadata(GUARDS_KEY, SapoIntegrationController.prototype[method]) ?? [];

describe('Kênh TikTok từ Sapo — ai được quét, ai được tự thêm', () => {
  it('quét danh sách kênh toàn công ty: CHỈ Admin', () => {
    expect(guardsOf('getTiktokChannels')).toContain(RolesGuard);
    expect(rolesOf('getTiktokChannels')).toEqual([UserRole.ADMIN]);
  });

  it('LEADER và MEMBER đều không quét được', () => {
    const allowed: UserRole[] = rolesOf('getTiktokChannels') ?? [];
    expect(allowed).not.toContain(UserRole.LEADER);
    expect(allowed).not.toContain(UserRole.MEMBER);
    expect(allowed).not.toContain(UserRole.MANAGER);
  });

  it('tự thêm kênh của mình: KHÔNG siết role, mọi người đã đăng nhập đều dùng được', () => {
    // Modal "Thêm thủ công" gửi đúng một kênh vào endpoint này.
    expect(rolesOf('syncTiktokChannels')).toBeUndefined();
    expect(guardsOf('syncTiktokChannels')).not.toContain(RolesGuard);
  });

  it('các endpoint doanh thu sẵn có không bị siết thêm ngoài ý muốn', () => {
    for (const method of ['getStatus', 'getRevenuePreview', 'syncRevenue']) {
      expect(rolesOf(method)).toBeUndefined();
    }
  });
});

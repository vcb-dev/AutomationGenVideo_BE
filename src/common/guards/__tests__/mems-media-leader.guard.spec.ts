import { ForbiddenException } from '@nestjs/common';
import { MemsMediaLeaderGuard, isMediaLeaderOrAdminUser } from '../mems-media-leader.guard';

/**
 * Cửa canh mọi thao tác quản lý kho: duyệt phiếu, gán máy, bàn giao, nhận trả, sửa danh mục.
 *
 * Kho là tài sản của bộ phận Media. `@Roles(LEADER, MANAGER, ADMIN)` một mình là chưa đủ —
 * nó cho cả leader bộ phận khác vào, mà những người đó không chịu trách nhiệm về chiếc máy nào.
 */
function contextWith(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('isMediaLeaderOrAdminUser', () => {
  it('admin luôn qua, không cần thuộc team nào', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['ADMIN'], team: null })).toBe(true);
    expect(isMediaLeaderOrAdminUser({ roles: ['ADMIN'], team: 'Team K2' })).toBe(true);
  });

  it('leader và manager của Team Media qua được', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: 'MEDIA' })).toBe(true);
    expect(isMediaLeaderOrAdminUser({ roles: ['MANAGER'], team: 'media' })).toBe(true);
  });

  it('tên team chỉ CHỨA chữ media thì KHÔNG qua', () => {
    // Tên team do người dùng đặt được, nên so khớp kiểu "có chứa" là mở sẵn đường leo lên quyền
    // quản lý kho — xoá thiết bị, duyệt phiếu, đọc nhật ký mượn của cả công ty.
    expect(isMediaLeaderOrAdminUser({ roles: ['MANAGER'], team: 'Media Chung' })).toBe(false);
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: 'Social Media' })).toBe(false);
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: 'Multimedia' })).toBe(false);
  });

  it('leader bộ phận khác KHÔNG qua', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: 'Team K1' })).toBe(false);
    expect(isMediaLeaderOrAdminUser({ roles: ['MANAGER'], team: 'Team ADS' })).toBe(false);
  });

  it('thành viên thường không qua dù đúng team', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['MEMBER'], team: 'MEDIA' })).toBe(false);
  });

  it('team ghi nhiều tên phân cách bằng dấu phẩy vẫn nhận đúng', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: 'Scale Data, Media' })).toBe(true);
  });

  it('không phân biệt hoa thường ở cả vai trò lẫn tên team', () => {
    expect(isMediaLeaderOrAdminUser({ roles: ['leader'], team: 'media' })).toBe(true);
  });

  it('thiếu dữ liệu thì mặc định là ĐÓNG, không đoán rộng ra', () => {
    // Người dùng chưa đồng bộ xong team, hoặc lời gọi quên truyền — cả hai đều phải chặn.
    // Mặc định mở thì cửa canh chỉ còn là hình thức mà không ai nhận ra.
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'], team: null })).toBe(false);
    expect(isMediaLeaderOrAdminUser({ roles: ['LEADER'] })).toBe(false);
    expect(isMediaLeaderOrAdminUser({ roles: [] })).toBe(false);
    expect(isMediaLeaderOrAdminUser(null)).toBe(false);
    expect(isMediaLeaderOrAdminUser(undefined)).toBe(false);
  });

  it('roles không phải mảng thì coi như không có quyền, không ném lỗi', () => {
    expect(isMediaLeaderOrAdminUser({ roles: 'ADMIN' as any })).toBe(false);
  });
});

describe('MemsMediaLeaderGuard', () => {
  const guard = new MemsMediaLeaderGuard();

  it('cho qua leader Team Media', () => {
    expect(guard.canActivate(contextWith({ roles: ['LEADER'], team: 'MEDIA' }))).toBe(true);
  });

  it('chặn leader bộ phận khác kèm lời giải thích, không im lặng trả false', () => {
    // Trả false thì Nest ném 403 trống trơn và người dùng tưởng hệ thống hỏng.
    expect(() =>
      guard.canActivate(contextWith({ roles: ['LEADER'], team: 'Team K1' })),
    ).toThrow(/Leader của Team Media hoặc Admin/);
  });

  it('chưa đăng nhập thì báo đúng lý do đó', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(/đăng nhập/);
  });
});

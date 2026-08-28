import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { MemsCatalogController } from '../mems-catalog.controller';

/**
 * Khai báo kho — tạo danh mục, khai model, nhập máy mới — chỉ leader và admin được làm.
 *
 * Manager điều phối công việc hằng ngày, nhưng khai một model mới hay nhập một chiếc máy vào
 * kho là chuyện tài sản: sai một dòng ở đây thì mọi phiếu mượn về sau đếm nhầm, và không có
 * bước nào phía sau bắt lại được.
 *
 * Test đọc metadata đúng cách `RolesGuard` đọc lúc chạy thật, rồi đưa qua chính guard đó —
 * không test hằng số nội bộ, nên đổi cách khai báo role mà hành vi giữ nguyên thì test vẫn đứng.
 */

/** Những phương thức khai báo kho. Thêm endpoint ghi mới thì thêm vào đây. */
const CATALOG_WRITE_METHODS = [
  'createCategory',
  'createModel',
  'createAsset',
  // Sửa và xoá còn nặng hơn thêm: thêm nhầm thì xoá đi, còn sửa nhầm serial hay xoá nhầm máy
  // thì lịch sử mượn trả của chiếc đó không còn chỗ nào đối chiếu.
  'updateAsset',
  'deleteAsset',
  'createLocation',
  'updateLocation',
  'deleteLocation',
] as const;

const reflector = new Reflector();

const rolesOf = (method: (typeof CATALOG_WRITE_METHODS)[number]): UserRole[] | undefined =>
  reflector.get<UserRole[]>(ROLES_KEY, MemsCatalogController.prototype[method]);

/** Dựng ngữ cảnh y như lúc chạy thật: guard tự đọc metadata của chính phương thức đó. */
function guardVerdict(method: (typeof CATALOG_WRITE_METHODS)[number], roles: UserRole[]): boolean {
  const ctx = {
    getHandler: () => MemsCatalogController.prototype[method],
    getClass: () => MemsCatalogController,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
  } as unknown as ExecutionContext;

  return new RolesGuard(reflector).canActivate(ctx);
}

describe('Quyền khai báo kho MEMS', () => {
  it.each(CATALOG_WRITE_METHODS)('%s chỉ mở cho leader và admin', (method) => {
    expect(rolesOf(method)).toEqual([UserRole.LEADER, UserRole.ADMIN]);
  });

  it.each(CATALOG_WRITE_METHODS)('manager không còn gọi được %s', (method) => {
    expect(guardVerdict(method, [UserRole.MANAGER])).toBe(false);
  });

  it.each(CATALOG_WRITE_METHODS)('member không gọi được %s', (method) => {
    expect(guardVerdict(method, [UserRole.MEMBER])).toBe(false);
  });

  it.each(CATALOG_WRITE_METHODS)('leader vẫn gọi được %s', (method) => {
    expect(guardVerdict(method, [UserRole.LEADER])).toBe(true);
  });

  it.each(CATALOG_WRITE_METHODS)('admin vẫn gọi được %s', (method) => {
    expect(guardVerdict(method, [UserRole.ADMIN])).toBe(true);
  });

  it('người vừa là manager vừa là leader thì vẫn qua', () => {
    // Vai trò cộng dồn, không phải loại trừ nhau — chặn theo vai trò THIẾU thì người này oan.
    expect(guardVerdict('createAsset', [UserRole.MANAGER, UserRole.LEADER])).toBe(true);
  });

  it('kiểm tra sau trả vẫn để manager làm', () => {
    // Đây là việc điều phối hằng ngày, không phải khai báo tài sản. Siết luôn cả cụm này thì
    // máy trả về nằm lại bàn kiểm tra mỗi khi leader bận.
    const inspectRoles = reflector.get<UserRole[]>(
      ROLES_KEY,
      MemsCatalogController.prototype.inspect,
    );
    expect(inspectRoles).toContain(UserRole.MANAGER);
  });
});

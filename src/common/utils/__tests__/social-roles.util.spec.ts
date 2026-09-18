import { isAdminRole, isLeaderRole, buildAccountVisibilityWhere } from '../social-roles.util';

/**
 * Ai được thấy tài khoản mạng xã hội nào.
 *
 * Quy tắc: ADMIN/MANAGER thấy toàn bộ, kèm thông tin ai đã gắn tài khoản đó. LEADER và
 * MEMBER chỉ thấy tài khoản do chính mình liên kết.
 *
 * Trước khi có test này, `findAll` lọc `user_id = mình OR is_shared = true`. Nghe thì đúng,
 * nhưng `onModuleInit` chạy một câu UPDATE ép `is_shared = true` cho MỌI tài khoản mỗi lần
 * backend khởi động (backfill một lần của commit d256984, để sót lại). Hậu quả đo trên DB:
 * 287/287 tài khoản đều được chia sẻ, 3 chủ sở hữu khác nhau, ai cũng nhìn thấy kênh của
 * tất cả — và nút tắt chia sẻ vô nghĩa vì lần restart sau lại bật lên.
 */

const CALLER = 'user-1';

describe('isAdminRole — MANAGER xếp cùng nhóm ADMIN', () => {
  it.each([['ADMIN'], ['MANAGER']])('%s là quyền nhìn toàn hệ thống', (role) => {
    expect(isAdminRole([role])).toBe(true);
  });

  it.each([['LEADER'], ['MEMBER']])('%s không phải quyền admin', (role) => {
    expect(isAdminRole([role])).toBe(false);
  });

  it('không có vai trò nào thì không phải admin', () => {
    expect(isAdminRole([])).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});

describe('isLeaderRole — LEADER thuần, không kèm quyền admin', () => {
  it('LEADER là leader', () => {
    expect(isLeaderRole(['LEADER'])).toBe(true);
  });

  it('vừa LEADER vừa ADMIN thì tính là admin, không phải leader', () => {
    // Tránh đếm hai lần ở nhánh phân quyền: admin đã thấy tất cả rồi.
    expect(isLeaderRole(['LEADER', 'ADMIN'])).toBe(false);
  });
});

describe('buildAccountVisibilityWhere', () => {
  it.each([['ADMIN'], ['MANAGER']])('%s không bị lọc theo người — thấy toàn bộ', (role) => {
    const where = buildAccountVisibilityWhere(CALLER, [role]);

    expect(where.user_id).toBeUndefined();
    expect(where.is_active).toBe(true);
  });

  it('MEMBER chỉ thấy tài khoản do chính mình liên kết', () => {
    expect(buildAccountVisibilityWhere(CALLER, ['MEMBER']).user_id).toBe(CALLER);
  });

  it('LEADER thấy tài khoản của mình VÀ của thành viên trong team', () => {
    const where = buildAccountVisibilityWhere(CALLER, ['LEADER'], ['m1', 'm2']);

    expect(where.user_id).toEqual({ in: [CALLER, 'm1', 'm2'] });
  });

  it('LEADER luôn có mặt trong danh sách, kể cả khi không nằm trong TeamMember của team mình', () => {
    const where = buildAccountVisibilityWhere(CALLER, ['LEADER'], ['m1']);

    expect((where.user_id as { in: string[] }).in).toContain(CALLER);
  });

  it('LEADER không có thành viên nào thì chỉ thấy của mình, không hoá thành thấy tất cả', () => {
    // Nhánh nguy hiểm: trả về { is_active: true } khi mảng rỗng là mở toang cả hệ thống.
    expect(buildAccountVisibilityWhere(CALLER, ['LEADER'], []).user_id).toBe(CALLER);
    expect(buildAccountVisibilityWhere(CALLER, ['LEADER'], undefined).user_id).toBe(CALLER);
    expect(buildAccountVisibilityWhere(CALLER, ['LEADER'], null).user_id).toBe(CALLER);
  });

  it('MEMBER có bị truyền nhầm danh sách thành viên cũng không thấy thêm ai', () => {
    expect(buildAccountVisibilityWhere(CALLER, ['MEMBER'], ['m1', 'm2']).user_id).toBe(CALLER);
  });

  it('vừa LEADER vừa ADMIN thì theo quyền admin — thấy toàn bộ', () => {
    expect(buildAccountVisibilityWhere(CALLER, ['LEADER', 'ADMIN'], ['m1']).user_id).toBeUndefined();
  });

  it('không trùng id khi leader cũng nằm trong danh sách thành viên', () => {
    const where = buildAccountVisibilityWhere(CALLER, ['LEADER'], [CALLER, 'm1']);

    expect((where.user_id as { in: string[] }).in).toEqual([CALLER, 'm1']);
  });

  it('không có vai trò thì coi như quyền thấp nhất', () => {
    expect(buildAccountVisibilityWhere(CALLER, []).user_id).toBe(CALLER);
    expect(buildAccountVisibilityWhere(CALLER, undefined).user_id).toBe(CALLER);
  });

  it('is_shared KHÔNG được tham gia điều kiện nhìn — đó là cửa hậu khiến ai cũng thấy của nhau', () => {
    for (const roles of [['ADMIN'], ['MANAGER'], ['LEADER'], ['MEMBER'], []]) {
      expect(JSON.stringify(buildAccountVisibilityWhere(CALLER, roles))).not.toContain('is_shared');
    }
  });
});

import { parseTeamIdFilter } from '../team-membership.util';

/**
 * parseTeamIdFilter() — parse query param `team_id` thành điều kiện Prisma. FE gửi nhiều id nối
 * dấu phẩy khi leader quản lý ≥2 team cùng lúc (xem `effectiveTeamId` ở tasks/page.tsx và
 * TaskAutoTasksService.findAll/ContentApprovalService.getMyTeamApprovals dùng hàm này).
 */
describe('parseTeamIdFilter', () => {
  it('rỗng/undefined → undefined (caller bỏ qua điều kiện team_id)', () => {
    expect(parseTeamIdFilter(undefined)).toBeUndefined();
    expect(parseTeamIdFilter('')).toBeUndefined();
  });

  it('1 id duy nhất → trả về đúng string đó (không bọc { in: [...] })', () => {
    expect(parseTeamIdFilter('team-1')).toBe('team-1');
  });

  it('nhiều id nối dấu phẩy → { in: [...] }', () => {
    expect(parseTeamIdFilter('team-1,team-2,team-3')).toEqual({
      in: ['team-1', 'team-2', 'team-3'],
    });
  });

  it('có khoảng trắng thừa quanh dấu phẩy → tự trim', () => {
    expect(parseTeamIdFilter('team-1, team-2 ,  team-3')).toEqual({
      in: ['team-1', 'team-2', 'team-3'],
    });
  });

  it('chuỗi chỉ toàn dấu phẩy/khoảng trắng → undefined, không phải mảng rỗng', () => {
    expect(parseTeamIdFilter(' , , ')).toBeUndefined();
  });
});

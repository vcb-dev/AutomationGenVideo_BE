import { getTeamMemberIdsForLeader } from '../src/common/utils/team-membership.util';

/**
 * Chức năng: Leader nhìn được kênh mạng xã hội của thành viên trong team mình.
 *
 * Vì sao đáng một file riêng: quan hệ "ai thuộc team của leader" trong repo này nằm ở HAI nơi
 * và chúng chưa bao giờ trùng khớp — bảng `TeamMember` (được ghi khi tạo/sửa nhân sự) và chuỗi
 * `User.team` (nguồn mà getTeamMembers() đang thực dùng, kèm ghi chú "team_members hiện rỗng
 * trên thực tế"). Chỉ đọc một nguồn thì có nhánh dữ liệu leader mở màn hình lên thấy thiếu
 * người mà không có lỗi gì báo ra.
 */
describe('Leader thấy kênh của thành viên trong team', () => {
  function buildDb(opts: {
    memberships?: Array<{ user_id: string }>;
    ledTeams?: Array<{ name: string }>;
    users?: Array<{ id: string; team: string | null }>;
  }) {
    return {
      teamMember: { findMany: jest.fn(async () => opts.memberships ?? []) },
      team: { findMany: jest.fn(async () => opts.ledTeams ?? []) },
      user: { findMany: jest.fn(async () => opts.users ?? []) },
    } as any;
  }

  it('lấy được thành viên từ bảng TeamMember', async () => {
    const db = buildDb({ memberships: [{ user_id: 'm1' }, { user_id: 'm2' }] });

    const ids = await getTeamMemberIdsForLeader(db, 'leader-1');

    expect(ids.sort()).toEqual(['m1', 'm2']);
  });

  it('lấy được thành viên từ chuỗi User.team khi TeamMember còn rỗng', async () => {
    const db = buildDb({
      memberships: [],
      ledTeams: [{ name: 'Team HN' }],
      users: [
        { id: 'm1', team: 'Team HN' },
        { id: 'm2', team: 'Team SG' },
        { id: 'm3', team: null },
      ],
    });

    const ids = await getTeamMemberIdsForLeader(db, 'leader-1');

    expect(ids).toEqual(['m1']);
  });

  it('gộp cả hai nguồn và không trả về id trùng', async () => {
    const db = buildDb({
      memberships: [{ user_id: 'm1' }],
      ledTeams: [{ name: 'Team HN' }],
      users: [
        { id: 'm1', team: 'Team HN' },
        { id: 'm2', team: 'Team HN' },
      ],
    });

    const ids = await getTeamMemberIdsForLeader(db, 'leader-1');

    expect(ids.sort()).toEqual(['m1', 'm2']);
  });

  it('nhân sự thuộc nhiều team (chuỗi phân cách dấu phẩy) vẫn được tính', async () => {
    const db = buildDb({
      ledTeams: [{ name: 'Team HN' }],
      users: [{ id: 'm1', team: 'Team SG, Team HN' }],
    });

    expect(await getTeamMemberIdsForLeader(db, 'leader-1')).toEqual(['m1']);
  });

  it('so khớp tên team không phân biệt hoa thường và khoảng trắng thừa', async () => {
    const db = buildDb({
      ledTeams: [{ name: '  Team HN  ' }],
      users: [{ id: 'm1', team: 'team hn' }],
    });

    expect(await getTeamMemberIdsForLeader(db, 'leader-1')).toEqual(['m1']);
  });

  it('không lãnh đạo team nào thì không thấy thêm ai — không được rơi thành thấy tất cả', async () => {
    const db = buildDb({
      memberships: [],
      ledTeams: [],
      users: [{ id: 'm1', team: 'Team HN' }],
    });

    expect(await getTeamMemberIdsForLeader(db, 'leader-1')).toEqual([]);
    // Không lãnh đạo team nào thì khỏi quét bảng user cho tốn.
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('tên team trùng một phần KHÔNG được tính là cùng team', async () => {
    // "Team HN 2" không phải "Team HN" — khớp theo substring là gộp nhầm hai team khác nhau.
    const db = buildDb({
      ledTeams: [{ name: 'Team HN' }],
      users: [{ id: 'm1', team: 'Team HN 2' }],
    });

    expect(await getTeamMemberIdsForLeader(db, 'leader-1')).toEqual([]);
  });
});

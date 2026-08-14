import { UserRole } from '@prisma/client';
import { UsersService } from '../users.service';

/**
 * `getTeamMembers` cho LEADER (ced9317): team_members hiện rỗng trên thực tế (chưa từng được
 * populate), nên nguồn sự thật thực dùng được là chuỗi User.team (có thể liệt kê nhiều team
 * cách nhau bởi dấu phẩy) so khớp với tên các Team mà caller đang lead (Team.leader_id) —
 * KHÔNG phải join qua bảng quan hệ team_members. Test này khoá phần dễ vỡ nhất: so khớp
 * không phân biệt hoa/thường, có khoảng trắng thừa, và nhiều team trong 1 chuỗi.
 */

function buildService(opts: { ledTeams: string[]; users: any[] }) {
  const prisma: any = {
    team: { findMany: jest.fn(async () => opts.ledTeams.map((name) => ({ name }))) },
    user: { findMany: jest.fn(async () => opts.users) },
  };
  const service = new UsersService(prisma, {} as any, {} as any);
  return { service, prisma };
}

describe('UsersService.getTeamMembers — LEADER', () => {
  it('không lead team nào thì trả mảng rỗng, KHÔNG query bảng user', async () => {
    const { service, prisma } = buildService({ ledTeams: [], users: [] });

    const result = await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('match tên team KHÔNG phân biệt hoa/thường và khoảng trắng thừa', async () => {
    const { service } = buildService({
      ledTeams: ['Team Alpha'],
      users: [
        { id: 'u1', team: '  team alpha  ' }, // khớp sau khi trim + lowercase
        { id: 'u2', team: 'Team Beta' }, // không khớp
      ],
    });

    const result = await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(result.map((u: any) => u.id)).toEqual(['u1']);
  });

  it('user thuộc NHIỀU team (chuỗi phân cách dấu phẩy) — khớp nếu 1 trong các team trùng', async () => {
    const { service } = buildService({
      ledTeams: ['Team Alpha'],
      users: [
        { id: 'u1', team: 'Team Beta, Team Alpha, Team Gamma' },
        { id: 'u2', team: 'Team Beta, Team Gamma' },
      ],
    });

    const result = await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(result.map((u: any) => u.id)).toEqual(['u1']);
  });

  it('lead nhiều team cùng lúc — member thuộc BẤT KỲ team nào trong số đó đều được thấy', async () => {
    const { service } = buildService({
      ledTeams: ['Team Alpha', 'Team Beta'],
      users: [
        { id: 'u1', team: 'Team Alpha' },
        { id: 'u2', team: 'Team Beta' },
        { id: 'u3', team: 'Team Gamma' },
      ],
    });

    const result = await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(result.map((u: any) => u.id).sort()).toEqual(['u1', 'u2']);
  });

  it('user chưa có team (null) thì không khớp, không throw', async () => {
    const { service } = buildService({
      ledTeams: ['Team Alpha'],
      users: [{ id: 'u1', team: null }],
    });

    const result = await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(result).toEqual([]);
  });

  it('query ứng viên đã lọc team: { not: null } ở tầng DB, không tự lọc null ở tầng app', async () => {
    const { service, prisma } = buildService({ ledTeams: ['Team Alpha'], users: [] });

    await service.getTeamMembers('leader-1', [UserRole.LEADER]);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ team: { not: null } }),
      }),
    );
  });
});

describe('UsersService.getTeamMembers — ADMIN/MANAGER vs role khác', () => {
  it('ADMIN thấy TẤT CẢ user (không lọc theo team) — không đi qua nhánh LEADER', async () => {
    const { service, prisma } = buildService({ ledTeams: [], users: [{ id: 'u1' }] });

    await service.getTeamMembers('admin-1', [UserRole.ADMIN]);

    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('role không phải ADMIN/MANAGER/LEADER thì trả mảng rỗng', async () => {
    const { service } = buildService({ ledTeams: [], users: [] });

    const result = await service.getTeamMembers('member-1', [UserRole.MEMBER]);

    expect(result).toEqual([]);
  });
});

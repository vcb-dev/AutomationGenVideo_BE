import { isContentTeamMember } from '../team-membership.util';

/**
 * isContentTeamMember() — true nếu user là member HOẶC leader của một Team có
 * team_kind = CONTENT. Dùng để phân biệt "Content Team" (chuyên sưu tầm/dịch content)
 * với team sản xuất video thường (team_kind = PRODUCTION, mặc định).
 */
describe('isContentTeamMember', () => {
  function build(opts: { membership?: any; ledTeam?: any } = {}) {
    const db: any = {
      teamMember: {
        findFirst: jest.fn(async () => (opts.membership === undefined ? null : opts.membership)),
      },
      team: {
        findFirst: jest.fn(async () => (opts.ledTeam === undefined ? null : opts.ledTeam)),
      },
    };
    return { db };
  }

  it('là thành viên thường của Content Team → true', async () => {
    const { db } = build({ membership: { id: 'tm-1' } });

    const result = await isContentTeamMember(db, 'user-1');

    expect(result).toBe(true);
    expect(db.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-1', team: { team_kind: 'CONTENT' } },
      }),
    );
  });

  it('là leader của Content Team (không phải member) → true', async () => {
    const { db } = build({ ledTeam: { id: 'team-1' } });

    const result = await isContentTeamMember(db, 'user-1');

    expect(result).toBe(true);
    expect(db.team.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leader_id: 'user-1', team_kind: 'CONTENT' },
      }),
    );
  });

  it('không phải member lẫn leader của Content Team nào → false', async () => {
    const { db } = build();

    expect(await isContentTeamMember(db, 'user-1')).toBe(false);
  });

  it('chỉ thuộc team PRODUCTION thường → false (không match team_kind=CONTENT)', async () => {
    // findFirst với filter team_kind: 'CONTENT' tự trả null nếu user chỉ ở team PRODUCTION —
    // test này khoá lại đúng field filter được truyền, không phải suy luận ở tầng JS.
    const { db } = build();

    await isContentTeamMember(db, 'user-1');

    expect(db.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ team: { team_kind: 'CONTENT' } }) }),
    );
  });
});

import { TaskAutoTeamsService } from '../teams.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * setMemberContentCreator() — đánh dấu/bỏ đánh dấu 1 thành viên là Content Creator, áp dụng cho
 * MỌI team (không chỉ team_kind=CONTENT — xem [[content-creator-per-team-member-2026-08]]).
 * LEADER chỉ được set cho team mình lead; ADMIN/MANAGER set được cho team bất kỳ.
 */
describe('TaskAutoTeamsService.setMemberContentCreator', () => {
  function notFoundError() {
    return new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  function build(opts: { team?: any; updateImpl?: () => Promise<any> } = {}) {
    const updateCalls: any[] = [];
    const prisma: any = {
      team: {
        findUnique: jest.fn(async () =>
          opts.team === undefined ? { id: 'team-1', leader_id: 'leader-1' } : opts.team,
        ),
      },
      teamMember: {
        update: jest.fn(async (args: any) => {
          updateCalls.push(args);
          if (opts.updateImpl) return opts.updateImpl();
          return { id: 'tm-1', is_content_creator: args.data.is_content_creator };
        }),
      },
    };
    const service = new TaskAutoTeamsService(prisma);
    return { service, prisma, updateCalls };
  }

  afterEach(() => jest.clearAllMocks());

  it('ADMIN đặt content creator cho team bất kỳ — không cần check leader_id', async () => {
    const { service, prisma, updateCalls } = build();

    const result = await service.setMemberContentCreator('team-1', 'user-1', true, 'admin-1', ['ADMIN']);

    expect(result.is_content_creator).toBe(true);
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
    expect(updateCalls[0].where).toEqual({ team_id_user_id: { team_id: 'team-1', user_id: 'user-1' } });
    expect(updateCalls[0].data).toEqual({ is_content_creator: true });
  });

  it('MANAGER cũng set được cho team bất kỳ', async () => {
    const { service, prisma } = build();

    await service.setMemberContentCreator('team-1', 'user-1', true, 'manager-1', ['MANAGER']);

    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('LEADER lead đúng team → set thành công', async () => {
    const { service, updateCalls } = build();

    await service.setMemberContentCreator('team-1', 'user-1', true, 'leader-1', ['LEADER']);

    expect(updateCalls).toHaveLength(1);
  });

  it('LEADER KHÔNG lead team này → ForbiddenException, không gọi update', async () => {
    const { service, updateCalls } = build({ team: { id: 'team-1', leader_id: 'someone-else' } });

    await expect(
      service.setMemberContentCreator('team-1', 'user-1', true, 'leader-1', ['LEADER']),
    ).rejects.toThrow(ForbiddenException);
    expect(updateCalls).toHaveLength(0);
  });

  it('bỏ đánh dấu (is_content_creator=false) cũng đi qua đúng luồng quyền', async () => {
    const { service, updateCalls } = build();

    const result = await service.setMemberContentCreator('team-1', 'user-1', false, 'leader-1', ['LEADER']);

    expect(result.is_content_creator).toBe(false);
    expect(updateCalls[0].data).toEqual({ is_content_creator: false });
  });

  it('user không thuộc team (P2025) → NotFoundException với thông báo rõ ràng', async () => {
    const { service } = build({
      updateImpl: async () => {
        throw notFoundError();
      },
    });

    await expect(
      service.setMemberContentCreator('team-1', 'ghost-user', true, 'admin-1', ['ADMIN']),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.setMemberContentCreator('team-1', 'ghost-user', true, 'admin-1', ['ADMIN']),
    ).rejects.toThrow(/không trong team/);
  });
});

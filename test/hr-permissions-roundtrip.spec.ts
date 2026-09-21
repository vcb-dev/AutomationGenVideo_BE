import { UserRole } from '@prisma/client';

// Các tiện ích đội nhóm chạy raw SQL thật; ở đây chỉ quan tâm tới việc dto có bị lọc quyền hay
// không, nên cho chúng trả về kết quả "leader sở hữu member này" để đi hết nhánh cần kiểm tra.
jest.mock('../src/common/utils/team-membership.util', () => ({
  getUserTeamIds: jest.fn(async () => ['team-1']),
  assignUserToTeams: jest.fn(async () => undefined),
  clearUserTeams: jest.fn(async () => undefined),
  isUserUnassigned: jest.fn(async () => false),
  isTeamLeaderOfUser: jest.fn(async () => true),
  assignUserToTeamsByName: jest.fn(async () => undefined),
  replaceUserTeamsByName: jest.fn(async () => undefined),
  TEAM_TX_OPTIONS: {},
}));

import { UsersService } from '../src/modules/users/users.service';

/**
 * Vòng đời quyền chi tiết (granular permissions) khi Admin SỬA một nhân sự đã được cấp quyền.
 *
 * Màn hình Quản lý nhân sự nạp danh sách từ /users/team-members (và /users/unassigned), rồi
 * đổ thẳng `editing.permissions` vào cây phân quyền. Nếu hai endpoint đó không trả về
 * `permissions`, cây quyền mở ra trống trơn và lần bấm "Lưu" kế tiếp gửi permissions: []
 * lên backend — xoá sạch quyền đã cấp mà không cảnh báo gì.
 */
describe('Quyền chi tiết phải sống sót qua vòng nạp danh sách → sửa → lưu', () => {
  function buildService() {
    const capturedSelects: any[] = [];

    const prisma: any = {
      user: {
        findMany: jest.fn(async ({ select }: any) => {
          capturedSelects.push(select);
          // Prisma chỉ trả về đúng các field được liệt kê trong `select`.
          // Bản ghi dưới DB: nhân sự này ĐÃ được Admin cấp quyền xem TikTok.
          const stored: any = {
            id: 'user-1',
            team: 'Team A',
            permissions: ['social:external:tiktok'],
          };
          const row: any = {};
          for (const key of Object.keys(select ?? {})) row[key] = stored[key] ?? null;
          return [row];
        }),
      },
      teamMember: { findMany: jest.fn(async () => []) },
      team: { findMany: jest.fn(async () => [{ name: 'Team A' }]) },
    };

    const service = new UsersService(prisma, {} as any, {} as any);
    return { service, prisma, capturedSelects };
  }

  it('/users/team-members phải trả về permissions cho ADMIN', async () => {
    const { service, capturedSelects } = buildService();

    const rows = await service.getTeamMembers('admin-1', [UserRole.ADMIN]);

    expect(capturedSelects[0]).toHaveProperty('permissions', true);
    expect(rows[0]).toHaveProperty('permissions');
  });

  it('/users/unassigned phải trả về permissions', async () => {
    const { service, capturedSelects } = buildService();

    const rows = await service.getUnassignedMembers();

    expect(capturedSelects[0]).toHaveProperty('permissions', true);
    expect(rows[0]).toHaveProperty('permissions');
  });

  describe('LEADER không được tự cấp quyền chi tiết (leo thang đặc quyền)', () => {
    function buildLeaderScenario() {
      const prisma: any = {
        user: {
          findUnique: jest.fn(async () => ({ id: 'member-1', roles: [UserRole.MEMBER] })),
          findMany: jest.fn(async () => []),
          create: jest.fn(async ({ data }: any) => ({ id: 'new-1', ...data })),
          update: jest.fn(async ({ data }: any) => ({ id: 'member-1', ...data })),
        },
        teamMember: { findMany: jest.fn(async () => []) },
        team: { findMany: jest.fn(async () => []) },
        $transaction: jest.fn(async (fn: any) => [await fn(prisma)]),
      };
      const service = new UsersService(prisma, {} as any, {} as any);
      return { service, prisma };
    }

    it('createHR: quyền do LEADER gửi lên bị loại bỏ trước khi ghi', async () => {
      const { service } = buildLeaderScenario();
      const capture = jest
        .spyOn(service, 'create')
        .mockResolvedValue({ id: 'new-1' } as any);

      await service.createHR('leader-1', [UserRole.LEADER], {
        email: 'member@vcbi.vn',
        full_name: 'Thành viên',
        password: 'matkhau123',
        roles: [UserRole.MEMBER],
        // Leader cố gửi thẳng payload có quyền quản trị nhân sự.
        permissions: ['portal:hr:manage', 'social:external:crawl_all'],
      } as any);

      expect(capture).toHaveBeenCalled();
      expect(capture.mock.calls[0][0].permissions).toBeUndefined();
    });

    it('updateHR: LEADER sửa member của mình cũng không set được quyền', async () => {
      const { service } = buildLeaderScenario();
      const capture = jest
        .spyOn(service, 'update')
        .mockResolvedValue({ id: 'member-1' } as any);

      const dto: any = { full_name: 'Đổi tên', permissions: ['portal:hr:manage'] };
      await service
        .updateHR('leader-1', [UserRole.LEADER], 'member-1', dto)
        .catch(() => undefined); // nhánh kiểm tra quyền sở hữu team có thể chặn trước, vẫn hợp lệ

      // Dù đi tới update() hay bị chặn sớm, payload không bao giờ được mang theo permissions.
      if (capture.mock.calls.length > 0) {
        expect(capture.mock.calls[0][1].permissions).toBeUndefined();
      }
      expect(dto.permissions).toBeUndefined();
    });

    it('ADMIN thì vẫn set được quyền bình thường', async () => {
      const { service } = buildLeaderScenario();
      const capture = jest
        .spyOn(service, 'create')
        .mockResolvedValue({ id: 'new-1' } as any);

      await service.createHR('admin-1', [UserRole.ADMIN], {
        email: 'ai-do@vcbi.vn',
        full_name: 'Ai Đó',
        password: 'matkhau123',
        roles: [UserRole.MEMBER],
        permissions: ['social:external:tiktok'],
      } as any);

      expect(capture.mock.calls[0][0].permissions).toEqual(['social:external:tiktok']);
    });
  });

  it('nhân sự đã có quyền: sửa tên rồi lưu lại không được làm rỗng permissions', async () => {
    const { service } = buildService();

    // Mô phỏng đúng cách màn hình dựng form: lấy từ bản ghi danh sách trả về.
    const fromList = (await service.getTeamMembers('admin-1', [UserRole.ADMIN]))[0] as any;
    const formPermissions: string[] = fromList.permissions ?? [];

    // Người dùng chỉ đổi họ tên, không đụng tới cây quyền -> payload gửi lên chính là mảng này.
    expect(formPermissions).not.toEqual([]);
  });
});

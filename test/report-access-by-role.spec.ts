import { LarkService } from '../src/modules/lark-sync/lark.service';

/**
 * Chức năng: ai được xem báo cáo ngày của ai.
 *
 * Vì sao đáng một file riêng: `GET /lark/user-report-details` nhận `email` NGƯỜI ĐƯỢC XEM qua
 * query string. Trước đây không hề đối chiếu với người đang đăng nhập, nên bất kỳ tài khoản nào
 * chỉ cần sửa email trên URL là đọc được nội dung báo cáo ngày (công việc, traffic, doanh thu)
 * của đồng nghiệp. Cùng lớp lỗi với `personal-history` và `user-activity`: nhận danh tính người
 * xem từ client thay vì từ JWT.
 *
 * Quy tắc đúng: chính mình → luôn được; ADMIN/MANAGER → tất cả; LEADER → chỉ người trong team
 * mình lãnh đạo; còn lại → không.
 */
describe('Quyền xem báo cáo ngày theo vai trò', () => {
  function buildService(opts?: {
    ledTeams?: Array<{ name: string }>;
    targetTeam?: string | null;
  }) {
    const prisma: any = {
      team: { findMany: jest.fn(async () => opts?.ledTeams ?? []) },
      user: { findFirst: jest.fn(async () => ({ team: opts?.targetTeam ?? null })) },
    };
    const service = Object.create(LarkService.prototype) as any;
    service.prisma = prisma;
    return { service, prisma };
  }

  const canView = (service: any, target: string, caller: any) =>
    service.canViewReportOf(target, caller);

  const member = { id: 'u-mem', email: 'member@vcbi.vn', roles: ['MEMBER'] };
  const leader = { id: 'u-lead', email: 'leader@vcbi.vn', roles: ['LEADER'] };
  const manager = { id: 'u-mgr', email: 'manager@vcbi.vn', roles: ['MANAGER'] };
  const admin = { id: 'u-adm', email: 'admin@vcbi.vn', roles: ['ADMIN'] };

  describe('MEMBER', () => {
    it('xem được báo cáo của chính mình', async () => {
      const { service } = buildService();
      expect(await canView(service, 'member@vcbi.vn', member)).toBe(true);
    });

    it('KHÔNG xem được báo cáo của đồng nghiệp — đây là lỗ hổng cũ', async () => {
      const { service } = buildService();
      expect(await canView(service, 'nguoikhac@vcbi.vn', member)).toBe(false);
    });

    it('không lách được bằng cách đổi hoa thường trong email', async () => {
      const { service } = buildService();
      expect(await canView(service, 'MEMBER@VCBI.VN', member)).toBe(true);
      expect(await canView(service, 'NguoiKhac@vcbi.vn', member)).toBe(false);
    });

    it('không lách được bằng khoảng trắng thừa', async () => {
      const { service } = buildService();
      expect(await canView(service, '  member@vcbi.vn  ', member)).toBe(true);
    });
  });

  describe('LEADER', () => {
    it('xem được người thuộc team mình lãnh đạo', async () => {
      const { service } = buildService({
        ledTeams: [{ name: 'Team K1' }],
        targetTeam: 'Team K1',
      });
      expect(await canView(service, 'thanhvien@vcbi.vn', leader)).toBe(true);
    });

    it('KHÔNG xem được người ở team khác', async () => {
      const { service } = buildService({
        ledTeams: [{ name: 'Team K1' }],
        targetTeam: 'Team K2',
      });
      expect(await canView(service, 'teamkhac@vcbi.vn', leader)).toBe(false);
    });

    it('người thuộc nhiều team, có một team của leader thì được', async () => {
      const { service } = buildService({
        ledTeams: [{ name: 'Team K1' }],
        targetTeam: 'Team K2, Team K1',
      });
      expect(await canView(service, 'nhieuteam@vcbi.vn', leader)).toBe(true);
    });

    it('tên team trùng một phần KHÔNG được tính là cùng team', async () => {
      const { service } = buildService({
        ledTeams: [{ name: 'Team K1' }],
        targetTeam: 'Team K10',
      });
      expect(await canView(service, 'gantên@vcbi.vn', leader)).toBe(false);
    });

    it('leader chưa lãnh đạo team nào thì không xem được ai ngoài mình', async () => {
      const { service } = buildService({ ledTeams: [], targetTeam: 'Team K1' });
      expect(await canView(service, 'ai-do@vcbi.vn', leader)).toBe(false);
      expect(await canView(service, 'leader@vcbi.vn', leader)).toBe(true);
    });

    it('người được xem chưa có team thì leader không xem được', async () => {
      const { service } = buildService({ ledTeams: [{ name: 'Team K1' }], targetTeam: null });
      expect(await canView(service, 'khongteam@vcbi.vn', leader)).toBe(false);
    });
  });

  describe('MANAGER và ADMIN', () => {
    it('xem được báo cáo của bất kỳ ai', async () => {
      const { service } = buildService();
      expect(await canView(service, 'bat-ky-ai@vcbi.vn', manager)).toBe(true);
      expect(await canView(service, 'bat-ky-ai@vcbi.vn', admin)).toBe(true);
    });

    it('không cần truy vấn team — tránh tốn query vô ích', async () => {
      const { service, prisma } = buildService();
      await canView(service, 'bat-ky-ai@vcbi.vn', admin);
      expect(prisma.team.findMany).not.toHaveBeenCalled();
    });
  });

  describe('Các trường hợp biên', () => {
    it('không có thông tin người gọi thì từ chối', async () => {
      const { service } = buildService();
      expect(await canView(service, 'ai-do@vcbi.vn', null)).toBe(false);
      expect(await canView(service, 'ai-do@vcbi.vn', undefined)).toBe(false);
    });

    it('người gọi không có email thì từ chối', async () => {
      const { service } = buildService();
      expect(await canView(service, 'ai-do@vcbi.vn', { id: 'x', roles: ['ADMIN'] })).toBe(false);
    });

    it('vai trò rỗng thì từ chối người khác nhưng vẫn xem được của mình', async () => {
      const { service } = buildService();
      const khongVaiTro = { id: 'u', email: 'u@vcbi.vn', roles: [] };
      expect(await canView(service, 'nguoikhac@vcbi.vn', khongVaiTro)).toBe(false);
      expect(await canView(service, 'u@vcbi.vn', khongVaiTro)).toBe(true);
    });

    it('vừa LEADER vừa ADMIN thì theo quyền admin', async () => {
      const { service, prisma } = buildService({ ledTeams: [] });
      const vuaHai = { id: 'u', email: 'u@vcbi.vn', roles: ['LEADER', 'ADMIN'] };
      expect(await canView(service, 'bat-ky-ai@vcbi.vn', vuaHai)).toBe(true);
      expect(prisma.team.findMany).not.toHaveBeenCalled();
    });
  });
});

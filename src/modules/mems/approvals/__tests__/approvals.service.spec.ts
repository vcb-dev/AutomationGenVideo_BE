import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { ApprovalService } from '../approvals.service';
import { canSign, planApprovals } from '../../../../utils/mems/approval-rules.util';
import { BorrowRequestService } from '../../borrow-requests/borrow-requests.service';
import {
  isMediaLeaderOrAdminUser,
  MemsMediaLeaderGuard,
} from '../../../../common/guards/mems-media-leader.guard';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { MemsApprovalsController } from '../approvals.controller';

describe('Duyệt và từ chối phiếu', () => {
  // Kho thiết bị là tài sản của bộ phận Media, nên người ký cấp leader phải thuộc team đó.
  const LEADER1 = { id: 'leader-1', roles: ['LEADER'], team: 'MEDIA' };
  const LEADER2 = { id: 'leader-2', roles: ['LEADER'], team: 'MEDIA' };
  const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

  function buildDeps(over: Partial<any> = {}) {
    const request = {
      id: 'req-1',
      request_code: 'REQ-20260812-014',
      owner_id: 'nguoi-muon',
      status: 'PENDING_APPROVAL',
      from_time: new Date('2026-08-12T08:00:00Z'),
      to_time: new Date('2026-08-13T18:00:00Z'),
      place: 'Studio',
      purpose: 'WORK',
      approvals: [],
      lines: [{ quantity: 1, model: { reference_price: 10_000_000 } }],
      ...over,
    };
    const tx = {
      // Khai tham số để test đọc được mock.calls[0][0] khi kiểm khoá.
      $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
      memsBorrowRequest: {
        findUnique: jest.fn(async () => request),
        findUniqueOrThrow: jest.fn(async () => request),
        update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
      },
      memsApproval: { create: jest.fn(async ({ data }: any) => data) },
      memsReservation: { updateMany: jest.fn(async () => ({ count: 2 })) },
      memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    return { prisma, tx, request };
  }

  describe('ApprovalService.decide — chống hai người ký cùng lúc', () => {
    it('khoá phiếu trước khi đọc danh sách chữ ký', async () => {
      // Không khoá thì hai người bấm Duyệt cùng khoảnh khắc sẽ cùng đọc thấy "chưa ai ký", cùng
      // tính ra cấp 1 và cùng ghi một bản ghi cấp 1. Với phiếu hai cấp, phiếu kẹt vĩnh viễn:
      // `approvedSoFar` thành 2 nên `nextStep` trả null, mọi lần ký sau đều nhận "đã đủ chữ ký"
      // trong khi phiếu vẫn PENDING_APPROVAL — mà module không có endpoint sửa hay huỷ phiếu.
      // Schema cũng không có ràng buộc duy nhất (request_id, level) để chặn giúp.
      const { prisma, tx } = buildDeps();
      await new ApprovalService(prisma).approve('req-1', LEADER1, {});

      expect(tx.$executeRawUnsafe).toHaveBeenCalled();
      expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
      expect(String(tx.$executeRawUnsafe.mock.calls[0][1])).toContain('req-1');
    });

    it('từ chối cũng đi qua cùng cái khoá đó', async () => {
      const { prisma, tx } = buildDeps();
      await new ApprovalService(prisma).reject('req-1', LEADER1, { reason: 'Trùng lịch quay' });

      expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    });
  });

  describe('ApprovalService.approve', () => {
    it('phiếu một cấp: ký xong là APPROVED và giữ chỗ chuyển sang xác nhận', async () => {
      const { prisma, tx } = buildDeps();
      const result = await new ApprovalService(prisma).approve('req-1', LEADER1, {});

      expect(result.status).toBe('APPROVED');
      expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CONFIRMED' } }),
      );
    });

    it('phiếu hai cấp: cấp một ký xong phiếu vẫn nằm chờ', async () => {
      // Mượn cho việc riêng nên cần thêm chữ ký admin; chuyển sang APPROVED sớm là bỏ qua cấp hai.
      const { prisma, tx } = buildDeps({ purpose: 'PERSONAL' });
      await new ApprovalService(prisma).approve('req-1', LEADER1, {});

      expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
      expect(tx.memsApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
      );
    });

    it('phiếu hai cấp: cấp hai ký xong mới thành APPROVED', async () => {
      const { prisma } = buildDeps({
        purpose: 'PERSONAL',
        approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
      });
      const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});

      expect(result.status).toBe('APPROVED');
    });

    it('BR-23: một người không ký được hai lần cho cùng phiếu', async () => {
      // Ký hai lần là tự mình đủ hai cấp, vô hiệu hoá toàn bộ ý nghĩa của cấp duyệt thứ hai.
      const { prisma } = buildDeps({
        approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
      });
      await expect(new ApprovalService(prisma).approve('req-1', LEADER1, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('phiếu đã duyệt rồi thì không duyệt lại được', async () => {
      const { prisma } = buildDeps({ status: 'APPROVED' });
      await expect(new ApprovalService(prisma).approve('req-1', LEADER1, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('ApprovalService.reject', () => {
    it('BR-20: lý do toàn khoảng trắng vẫn bị chặn', async () => {
      // @IsNotEmpty của DTO cho chuỗi khoảng trắng lọt qua, nên service phải tự chặn.
      const { prisma } = buildDeps();
      await expect(
        new ApprovalService(prisma).reject('req-1', LEADER1, { reason: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('BR-32: từ chối nhả giữ chỗ ngay trong cùng giao dịch', async () => {
      // Để sang lượt sau thì khoảng đó vẫn hiện là bận, người khác không xin được máy đang rảnh.
      const { prisma, tx } = buildDeps();
      const result = await new ApprovalService(prisma).reject('req-1', LEADER1, {
        reason: 'Trùng lịch dự án khác',
      });

      expect(result.status).toBe('REJECTED');
      expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'RELEASED' } }),
      );
      expect(tx.memsRequestLine.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('lý do được lưu kèm bản ghi quyết định', async () => {
      const { prisma, tx } = buildDeps();
      await new ApprovalService(prisma).reject('req-1', LEADER1, { reason: '  Hết máy  ' });

      expect(tx.memsApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ decision: 'REJECTED', reason: 'Hết máy' }),
        }),
      );
    });
  });

  describe('ApprovalService — chốt chặn vai trò', () => {
    it('người đứng tên phiếu nếu không phải Leader Media/Admin thì không tự duyệt được', async () => {
      const { prisma, tx } = buildDeps();
      await expect(
        new ApprovalService(prisma).approve(
          'req-1',
          { id: 'nguoi-muon', roles: ['LEADER'], team: 'Team K1' },
          {},
        ),
      ).rejects.toThrow(/Không tự duyệt/);
      expect(tx.memsApproval.create).not.toHaveBeenCalled();
    });

    it('leader Team Media tự duyệt được phiếu do chính mình tạo', async () => {
      const { prisma } = buildDeps();
      const result = await new ApprovalService(prisma).approve(
        'req-1',
        { id: 'nguoi-muon', roles: ['LEADER'], team: 'MEDIA' },
        {},
      );
      expect(result.status).toBe('APPROVED');
    });

    it('member không ký được cấp nào', async () => {
      const { prisma } = buildDeps();
      await expect(
        new ApprovalService(prisma).approve('req-1', { id: 'ai-do', roles: ['MEMBER'] }, {}),
      ).rejects.toThrow(/phải do LEADER ký/);
    });

    it('leader KHÔNG ký thay được cấp của admin ở phiếu mượn cá nhân', async () => {
      // Cửa canh thiết bị rời khỏi việc công ty phải do admin gác, không thì chỉ là hình thức.
      const { prisma } = buildDeps({
        purpose: 'PERSONAL',
        approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
      });
      await expect(new ApprovalService(prisma).approve('req-1', LEADER2, {})).rejects.toThrow(
        /phải do ADMIN ký/,
      );
    });

    it('admin ký thay được cấp của leader khi không còn ai khác', async () => {
      const { prisma } = buildDeps();
      const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});
      expect(result.status).toBe('APPROVED');
    });

    it('leader team khác KHÔNG ký duyệt được phiếu mượn thiết bị', async () => {
      const { prisma } = buildDeps();
      await expect(
        new ApprovalService(prisma).approve(
          'req-1',
          { id: 'leader-k1', roles: ['LEADER'], team: 'Team K1' },
          {},
        ),
      ).rejects.toThrow(/phải do LEADER ký/);
    });

    it('leader Team Media ký duyệt thành công', async () => {
      const { prisma } = buildDeps();
      const result = await new ApprovalService(prisma).approve(
        'req-1',
        { id: 'leader-media', roles: ['LEADER'], team: 'MEDIA' },
        {},
      );
      expect(result.status).toBe('APPROVED');
    });

    it('cấp được ghi đúng số thứ tự trong kế hoạch, không phải đếm bản ghi', async () => {
      // Ghi `level` bằng cách đếm số bản ghi duyệt đã có thì một lần từ chối rồi ký lại sẽ đẩy
      // số cấp lệch đi, và nhật ký duyệt của phiếu không còn khớp với kế hoạch chữ ký.
      const { prisma, tx } = buildDeps({
        purpose: 'PERSONAL',
        approvals: [{ decided_by: LEADER1.id, decision: 'APPROVED' }],
      });
      await new ApprovalService(prisma).approve('req-1', ADMIN, {});

      expect(tx.memsApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ level: 2 }) }),
      );
    });
  });
});

describe('Phiếu mượn việc riêng — hai cấp duyệt', () => {
  /**
   * Phiếu mượn phục vụ việc cá nhân phải qua hai chữ ký: leader rồi admin.
   *
   * Khác với các luật khác trong `approval-plan.spec.ts` — ở đó thứ quyết định là địa điểm và giá
   * trị. Ở đây thứ quyết định là MỤC ĐÍCH: máy rời khỏi công việc của công ty thì phải có admin
   * biết, dù chỉ mượn một buổi và dù máy rẻ.
   */

  const base = {
    totalValue: 10_000_000,
    fromTime: new Date('2026-08-12T08:00:00Z'),
    toTime: new Date('2026-08-13T18:00:00Z'),
    place: 'Nhà riêng',
  };

  describe('planApprovals — phiếu mượn cá nhân', () => {
    it('mượn việc cá nhân cần hai chữ ký: leader trước, admin sau', () => {
      const plan = planApprovals({ ...base, purpose: 'PERSONAL' });

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]).toMatchObject({ level: 1, role: 'LEADER' });
      expect(plan.steps[1]).toMatchObject({ level: 2, role: 'ADMIN' });
    });
  });

  describe('canSign — phiếu mượn cá nhân', () => {
    it('admin KHÔNG ký thay được cấp của leader trên phiếu cá nhân', () => {
      // Nếu ký thay được thì một mình admin bấm hai lần là xong cả phiếu, và luật hai cấp chỉ
      // còn là hình thức. Trên phiếu công việc thì vẫn cho ký thay (xem approval-plan.spec.ts).
      const plan = planApprovals({ ...base, purpose: 'PERSONAL' });

      expect(canSign(plan.steps[0], ['ADMIN'], null)).toBe(false);
      expect(canSign(plan.steps[0], ['LEADER'], 'MEDIA')).toBe(true);
      expect(canSign(plan.steps[1], ['ADMIN'], null)).toBe(true);
    });
  });

  // Kho thiết bị là tài sản của bộ phận Media, nên người ký cấp leader phải thuộc team đó.
  const LEADER = { id: 'leader-1', roles: ['LEADER'], team: 'MEDIA' };
  const LEADER_KHAC = { id: 'leader-2', roles: ['LEADER'], team: 'MEDIA' };
  const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

  function buildDeps(over: Partial<any> = {}) {
    const request = {
      id: 'req-1',
      request_code: 'REQ-20260812-020',
      owner_id: 'nguoi-muon',
      status: 'PENDING_APPROVAL',
      from_time: base.fromTime,
      to_time: base.toTime,
      place: 'Nhà riêng',
      purpose: 'PERSONAL',
      approvals: [],
      lines: [{ quantity: 1, model: { reference_price: 10_000_000 } }],
      ...over,
    };
    const tx = {
      // `decide` khoá theo phiếu trước khi đọc, để hai người ký cùng lúc không cùng ghi một cấp.
      $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
      memsBorrowRequest: {
        findUnique: jest.fn(async () => request),
        findUniqueOrThrow: jest.fn(async () => request),
        update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
      },
      memsApproval: { create: jest.fn(async ({ data }: any) => data) },
      memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    return { prisma, tx };
  }

  describe('ApprovalService.approve — phiếu mượn cá nhân', () => {
    it('leader ký cấp một xong, phiếu vẫn nằm chờ admin', async () => {
      const { prisma, tx } = buildDeps();
      await new ApprovalService(prisma).approve('req-1', LEADER, {});

      expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
      expect(tx.memsApproval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ level: 1 }) }),
      );
    });

    it('admin ký cấp hai xong thì phiếu mới được duyệt và giữ chỗ được xác nhận', async () => {
      const { prisma, tx } = buildDeps({
        approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
      });
      const result = await new ApprovalService(prisma).approve('req-1', ADMIN, {});

      expect(result.status).toBe('APPROVED');
      expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CONFIRMED' } }),
      );
    });

    it('admin không ký được khi chưa có leader nào ký', async () => {
      // Chốt chặn thật sự của luật hai cấp: không cho admin tự bấm hai lần là xong phiếu.
      const { prisma, tx } = buildDeps();
      await expect(new ApprovalService(prisma).approve('req-1', ADMIN, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.memsApproval.create).not.toHaveBeenCalled();
    });

    it('leader khác KHÔNG ký thay được cấp của admin', async () => {
      const { prisma } = buildDeps({
        approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
      });
      await expect(new ApprovalService(prisma).approve('req-1', LEADER_KHAC, {})).rejects.toThrow(
        /phải do ADMIN ký/,
      );
    });

    it('admin KHÔNG tự ký cấp giám sát trên phiếu cá nhân của chính mình', async () => {
      // Cấp hai tồn tại để có người ĐỨNG NGOÀI biết máy rời khỏi việc công ty. Người đứng tên
      // phiếu tự ký cấp đó thì chữ ký giám sát chỉ còn là thủ tục — và admin đúng là người dễ
      // rơi vào ca này nhất vì họ được miễn luật "không tự duyệt" để gỡ thế bí cho phiếu khác.
      const { prisma, tx } = buildDeps({
        owner_id: ADMIN.id,
        approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
      });

      await expect(new ApprovalService(prisma).approve('req-1', ADMIN, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.memsApproval.create).not.toHaveBeenCalled();
    });

    it('admin khác vẫn ký được cấp giám sát cho phiếu cá nhân của admin này', async () => {
      // Siết ở trên không được biến phiếu cá nhân của admin thành phiếu không ai ký nổi.
      const ADMIN_KHAC = { id: 'admin-2', roles: ['ADMIN'], team: null };
      const { prisma } = buildDeps({
        owner_id: ADMIN.id,
        approvals: [{ decided_by: LEADER.id, decision: 'APPROVED' }],
      });

      const result = await new ApprovalService(prisma).approve('req-1', ADMIN_KHAC, {});

      expect(result.status).toBe('APPROVED');
    });

    it('leader Media vẫn tự duyệt được phiếu công việc của chính mình', async () => {
      // Không siết nhầm sang ca đã cân nhắc từ trước: leader Media là người trực tiếp giữ kho,
      // phiếu công việc một cấp của họ vẫn tự ký được.
      const { prisma } = buildDeps({ purpose: 'WORK', owner_id: LEADER.id });

      const result = await new ApprovalService(prisma).approve('req-1', LEADER, {});

      expect(result.status).toBe('APPROVED');
    });

    it('phiếu công việc vẫn chỉ cần một chữ ký như cũ', async () => {
      // Luật mới không được siết phiếu đi quay, đi sự kiện — chỗ đó vẫn một chữ ký.
      const { prisma } = buildDeps({ purpose: 'WORK', place: 'Đà Nẵng' });
      const result = await new ApprovalService(prisma).approve('req-1', LEADER, {});

      expect(result.status).toBe('APPROVED');
    });

    it('phiếu cũ chưa có cột mục đích vẫn duyệt được bằng một chữ ký', async () => {
      // Cột purpose thêm sau, phiếu tạo trước đó đọc ra null. Nếu null bị hiểu thành cá nhân thì
      // mọi phiếu đang chờ trong DB bỗng dưng kẹt lại đòi chữ ký admin.
      const { prisma } = buildDeps({ purpose: null });
      const result = await new ApprovalService(prisma).approve('req-1', LEADER, {});

      expect(result.status).toBe('APPROVED');
    });
  });

  describe('BorrowRequestService.create — mục đích mượn', () => {
    const DTO = {
      project: 'Chụp ảnh cưới người nhà',
      place: 'Nhà riêng',
      fromTime: '2026-08-15T02:00:00Z',
      toTime: '2026-08-16T10:00:00Z',
      lines: [{ modelId: 'model-1', quantity: 1 }],
    };

    function buildCreateDeps() {
      const tx = {
        $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
        memsBorrowRequest: {
          count: jest.fn(async () => 0),
          create: jest.fn(async ({ data }: any) => ({ id: 'req-1', ...data })),
        },
        memsRequestLine: { create: jest.fn(async ({ data }: any) => ({ id: 'line-1', ...data })) },
        memsReservation: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
        // Bộ phận luôn suy từ người đăng nhập — client không còn khai được nữa.
        memsMember: { findFirst: jest.fn(async () => ({ department_id: 'dept-1' })) },
        user: { findUnique: jest.fn(async () => ({ team: 'MEDIA' })) },
        memsDepartment: {
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => []),
        },
      };
      const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
      const availability: any = {
        check: jest.fn(async () => ({
          available: 5,
          enough: true,
          shortBy: 0,
          bufferMinutes: 0,
          bufferedTo: new Date('2026-08-16T10:00:00Z'),
          busyByReservation: 0,
          busyByMaintenance: 0,
        })),
      };
      return { prisma, tx, availability };
    }

    it('mục đích cá nhân được ghi vào phiếu', async () => {
      const { prisma, tx, availability } = buildCreateDeps();
      await new BorrowRequestService(prisma, availability).create('user-1', {
        ...DTO,
        purpose: 'PERSONAL',
      });

      expect(tx.memsBorrowRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ purpose: 'PERSONAL' }) }),
      );
    });

    it('không khai mục đích thì mặc định là việc công ty', async () => {
      // Mặc định phải là WORK: client cũ chưa gửi trường này, và đoán nhầm sang cá nhân thì phiếu
      // đi quay bình thường cũng bị đòi chữ ký admin.
      const { prisma, tx, availability } = buildCreateDeps();
      await new BorrowRequestService(prisma, availability).create('user-1', DTO);

      expect(tx.memsBorrowRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ purpose: 'WORK' }) }),
      );
    });
  });
});

describe('Thành viên chỉ xem phiếu của mình', () => {
  /**
   * Ai được nhìn thấy phiếu mượn của ai.
   *
   * Phiếu mượn lộ dự án, địa điểm, tên và email người mượn của cả công ty. Trước đây hai endpoint
   * này không có `@Roles` lẫn guard nào, nên bất kỳ tài khoản đăng nhập nào cũng đọc được toàn bộ
   * — trong khi chính module này lọc rất kỹ ở `AssetBorrowHistoryService` ("thành viên chỉ thấy
   * lượt của mình"). Cửa rộng nhất lại là cửa để mở.
   *
   * Lọc phải nằm TRONG câu truy vấn. Lọc sau khi đã nạp thì dữ liệu người khác vẫn rời khỏi máy chủ.
   */
  const MEMBER = { id: 'member-1', roles: ['MEMBER'], team: 'Team K1' };
  const LEADER_KHAC = { id: 'leader-k1', roles: ['LEADER'], team: 'Team K1' };
  const LEADER_MEDIA = { id: 'leader-media', roles: ['LEADER'], team: 'MEDIA' };
  const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

  function buildPrisma(request: any = null) {
    return {
      memsBorrowRequest: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => request),
      },
      user: { findMany: jest.fn(async () => []) },
    } as any;
  }

  const REQUEST_CUA_NGUOI_KHAC = {
    id: 'req-1',
    request_code: 'REQ-20260815-001',
    owner_id: 'nguoi-khac',
    from_time: new Date('2026-08-15T02:00:00Z'),
    to_time: new Date('2026-08-16T10:00:00Z'),
    place: 'Studio A',
    purpose: 'WORK',
    lines: [],
    approvals: [],
  };

  describe('ApprovalService.list — lọc theo người xem', () => {
    it('thành viên thường chỉ thấy phiếu của chính mình', async () => {
      const prisma = buildPrisma();
      await new ApprovalService(prisma).list({}, MEMBER);

      expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBe('member-1');
    });

    it('leader bộ phận khác cũng chỉ thấy phiếu của chính mình', async () => {
      // Kho là tài sản của bộ phận Media. Mang chức leader ở bộ phận khác không cho quyền đọc
      // thói quen mượn máy của cả công ty.
      const prisma = buildPrisma();
      await new ApprovalService(prisma).list({}, LEADER_KHAC);

      expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBe('leader-k1');
    });

    it('leader Team Media và admin thấy toàn bộ', async () => {
      for (const viewer of [LEADER_MEDIA, ADMIN]) {
        const prisma = buildPrisma();
        await new ApprovalService(prisma).list({}, viewer);

        expect(prisma.memsBorrowRequest.findMany.mock.calls[0][0].where.owner_id).toBeUndefined();
      }
    });

    it('lọc theo người xem không đè mất bộ lọc trạng thái', async () => {
      // Màn Duyệt phiếu gọi kèm status. Ghép sai thì hoặc mất bộ lọc trạng thái, hoặc mất chốt
      // quyền — cả hai đều hỏng âm thầm.
      const prisma = buildPrisma();
      await new ApprovalService(prisma).list({ status: 'PENDING_APPROVAL' }, MEMBER);

      const where = prisma.memsBorrowRequest.findMany.mock.calls[0][0].where;
      expect(where.owner_id).toBe('member-1');
      expect(where.status).toBe('PENDING_APPROVAL');
    });

    it('lọc nhiều trạng thái cùng lúc vẫn giữ chốt quyền', async () => {
      const prisma = buildPrisma();
      await new ApprovalService(prisma).list({ status: 'ON_LOAN,PARTIALLY_RETURNED' }, MEMBER);

      const where = prisma.memsBorrowRequest.findMany.mock.calls[0][0].where;
      expect(where.owner_id).toBe('member-1');
      expect(where.status).toEqual({ in: ['ON_LOAN', 'PARTIALLY_RETURNED'] });
    });
  });

  describe('ApprovalService.detail — lọc theo người xem', () => {
    it('thành viên KHÔNG xem được phiếu của người khác', async () => {
      const prisma = buildPrisma(REQUEST_CUA_NGUOI_KHAC);
      await expect(new ApprovalService(prisma).detail('req-1', MEMBER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('thành viên xem được phiếu của chính mình', async () => {
      const prisma = buildPrisma({ ...REQUEST_CUA_NGUOI_KHAC, owner_id: MEMBER.id });
      const result = await new ApprovalService(prisma).detail('req-1', MEMBER);

      expect(result.request_code).toBe('REQ-20260815-001');
    });

    it('leader Team Media xem được mọi phiếu', async () => {
      const prisma = buildPrisma(REQUEST_CUA_NGUOI_KHAC);
      const result = await new ApprovalService(prisma).detail('req-1', LEADER_MEDIA);

      expect(result.request_code).toBe('REQ-20260815-001');
    });

    it('phiếu không tồn tại thì báo không tìm thấy, không phải không có quyền', async () => {
      // Trả 403 cho phiếu không tồn tại là nói dối người dùng và khiến họ đi hỏi quyền vô ích.
      const prisma = buildPrisma(null);
      await expect(new ApprovalService(prisma).detail('req-lạ', LEADER_MEDIA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('Vai trò và team', () => {
  /**
   * Quản lý thiết bị nhìn từ phía NGƯỜI DÙNG KHÔNG BIẾT LUỒNG.
   *
   * Người thật không đi theo sơ đồ: họ bấm Duyệt phiếu của chính mình, bấm hai lần, bấm Huỷ khi máy
   * đã ra khỏi kho, mở phiếu của người khác, và làm những việc đó với đủ loại vai trò ở đủ loại
   * team. File này thử đúng những đường đó — cố ý KHÔNG theo thứ tự nghiệp vụ.
   *
   * Ba vai trò: MEMBER, LEADER, ADMIN. Nhiều team, lấy tên thật đang có trong hệ thống.
   *
   * Điểm dễ hiểu sai nhất và là lý do file này tồn tại: quyền điều phối kho KHÔNG do chức vụ quyết
   * định một mình. LEADER của team khác không có quyền gì hơn MEMBER trong kho Media.
   */

  /** Team có thật trong hệ thống, gồm cả những tên dễ bị nhầm là Media. */
  const TEAMS = {
    media: 'Media',
    mediaHoa: 'MEDIA',
    mediaThua: '  media  ',
    k1: 'Team K1',
    k2: 'Team K2',
    ads: 'ADS',
    scaleData: 'Scale Data',
    globalIndo: 'Global - Indo',
    daQuy: 'Đá Quý - Chung Thợ Đá',
    nhieuTeam: 'Media,Team K1',
    nhieuTeamKhongMedia: 'Team K1,Scale Data',
    // Hai cái bẫy: tên CHỨA chữ media nhưng không phải bộ phận Media.
    socialMedia: 'Social Media',
    multimedia: 'Multimedia',
  };

  const user = (id: string, roles: string[], team?: string | null) => ({ id, roles, team });

  const MEMBER_MEDIA = user('u-member-media', ['MEMBER'], TEAMS.media);
  const MEMBER_K1 = user('u-member-k1', ['MEMBER'], TEAMS.k1);
  const LEADER_MEDIA = user('u-leader-media', ['LEADER'], TEAMS.media);
  const LEADER_K1 = user('u-leader-k1', ['LEADER'], TEAMS.k1);
  const LEADER_GLOBAL = user('u-leader-global', ['LEADER'], TEAMS.globalIndo);
  const MANAGER_MEDIA = user('u-manager-media', ['MANAGER'], TEAMS.media);
  const MANAGER_K2 = user('u-manager-k2', ['MANAGER'], TEAMS.k2);
  const ADMIN = user('u-admin', ['ADMIN'], null);
  const ADMIN_KHAC = user('u-admin-2', ['ADMIN'], TEAMS.k1);

  describe('Ai được coi là quản lý kho — ma trận vai trò × team', () => {
    it.each([
      ['MEMBER team Media', MEMBER_MEDIA, false],
      ['MEMBER team K1', MEMBER_K1, false],
      ['LEADER team Media', LEADER_MEDIA, true],
      ['LEADER team K1', LEADER_K1, false],
      ['LEADER team Global - Indo', LEADER_GLOBAL, false],
      ['LEADER team Đá Quý', user('u1', ['LEADER'], TEAMS.daQuy), false],
      ['LEADER team ADS', user('u2', ['LEADER'], TEAMS.ads), false],
      ['LEADER team Scale Data', user('u3', ['LEADER'], TEAMS.scaleData), false],
      ['MANAGER team Media', MANAGER_MEDIA, true],
      ['MANAGER team K2', MANAGER_K2, false],
      ['ADMIN không có team', ADMIN, true],
      ['ADMIN team K1', ADMIN_KHAC, true],
    ])('%s', (_ten, u, mongDoi) => {
      expect(isMediaLeaderOrAdminUser(u)).toBe(mongDoi);
    });

    it('LEADER thuộc nhiều team, trong đó có Media thì vẫn là quản lý kho', () => {
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.nhieuTeam))).toBe(true);
    });

    it('LEADER thuộc nhiều team nhưng không có Media thì không', () => {
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.nhieuTeamKhongMedia))).toBe(false);
    });

    it('tên team viết hoa vẫn nhận ra, người nhập liệu không phải nhớ đúng kiểu chữ', () => {
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.mediaHoa))).toBe(true);
    });

    it('tên team thừa khoảng trắng vẫn nhận ra', () => {
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.mediaThua))).toBe(true);
    });

    it('team tên "Social Media" KHÔNG leo được lên quyền quản lý kho', () => {
      // Tên team do người dùng đặt được. So khớp kiểu "có chứa" thì đặt tên là leo quyền: xoá thiết
      // bị, duyệt phiếu, đọc nhật ký mượn của cả công ty.
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.socialMedia))).toBe(false);
    });

    it('team tên "Multimedia" cũng không', () => {
      expect(isMediaLeaderOrAdminUser(user('u', ['LEADER'], TEAMS.multimedia))).toBe(false);
    });

    it.each([
      ['không có team', user('u', ['LEADER'], null)],
      ['team để trống', user('u', ['LEADER'], '')],
      ['team là undefined', { id: 'u', roles: ['LEADER'] }],
    ])('LEADER %s thì KHÔNG được coi là Media, không đoán có lợi cho người gọi', (_ten, u) => {
      // Bản trước coi `undefined` là Media, nghĩa là mọi lời gọi quên truyền team đều biến cửa canh
      // thành hình thức.
      expect(isMediaLeaderOrAdminUser(u as any)).toBe(false);
    });

    it.each([
      ['chưa đăng nhập', null],
      ['undefined', undefined],
      ['không có vai trò nào', { id: 'u', roles: [], team: TEAMS.media }],
      ['roles không phải mảng', { id: 'u', roles: 'ADMIN' as any, team: TEAMS.media }],
    ])('%s thì không có quyền gì', (_ten, u) => {
      expect(isMediaLeaderOrAdminUser(u as any)).toBe(false);
    });
  });

  describe('Ai ký được cấp nào — phiếu việc công ty (một chữ ký)', () => {
    const step = planApprovals({
      totalValue: 1_000_000,
      fromTime: new Date('2026-09-15T02:00:00Z'),
      toTime: new Date('2026-09-16T10:00:00Z'),
      place: 'Studio',
      purpose: 'WORK',
    }).steps[0];

    it.each([
      ['LEADER Media', LEADER_MEDIA, true],
      ['MANAGER Media', MANAGER_MEDIA, true],
      ['ADMIN ký thay cấp leader', ADMIN, true],
      ['LEADER team K1', LEADER_K1, false],
      ['LEADER team Global - Indo', LEADER_GLOBAL, false],
      ['MANAGER team K2', MANAGER_K2, false],
      ['MEMBER Media', MEMBER_MEDIA, false],
      ['MEMBER team K1', MEMBER_K1, false],
    ])('%s', (_ten, u, mongDoi) => {
      expect(canSign(step, u.roles, u.team)).toBe(mongDoi);
    });

    it('chỉ có một cấp, phiếu việc công ty không cần chữ ký admin', () => {
      const plan = planApprovals({
        totalValue: 1_000_000,
        fromTime: new Date('2026-09-15T02:00:00Z'),
        toTime: new Date('2026-09-16T10:00:00Z'),
        place: 'Studio',
        purpose: 'WORK',
      });
      expect(plan.steps).toHaveLength(1);
    });

    it('máy đắt hay mượn dài chỉ là cảnh báo, KHÔNG đẻ thêm chữ ký', () => {
      const plan = planApprovals({
        totalValue: 900_000_000,
        fromTime: new Date('2026-09-01T00:00:00Z'),
        toTime: new Date('2026-10-01T00:00:00Z'),
        place: 'Đà Nẵng',
        purpose: 'WORK',
      });
      expect(plan.steps).toHaveLength(1);
      expect(plan.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Ai ký được cấp nào — phiếu việc riêng (hai chữ ký)', () => {
    const plan = planApprovals({
      totalValue: 1_000_000,
      fromTime: new Date('2026-09-15T02:00:00Z'),
      toTime: new Date('2026-09-16T10:00:00Z'),
      place: 'Studio',
      purpose: 'PERSONAL',
    });

    it('cần đúng hai cấp: leader rồi admin', () => {
      expect(plan.steps.map((s) => s.role)).toEqual(['LEADER', 'ADMIN']);
    });

    it.each([
      ['LEADER Media ký cấp 1', LEADER_MEDIA, true],
      ['MANAGER Media ký cấp 1', MANAGER_MEDIA, true],
      ['ADMIN KHÔNG ký thay được cấp 1', ADMIN, false],
      ['LEADER team K1 ký cấp 1', LEADER_K1, false],
      ['MEMBER Media ký cấp 1', MEMBER_MEDIA, false],
    ])('%s', (_ten, u, mongDoi) => {
      // Tắt ký thay ở phiếu cá nhân: ở đó admin đã là cấp hai, cho ký thay cấp một nữa thì một
      // người bấm hai lần là xong cả phiếu.
      expect(canSign(plan.steps[0], u.roles, u.team)).toBe(mongDoi);
    });

    it.each([
      ['ADMIN ký cấp 2', ADMIN, true],
      ['LEADER Media ký cấp 2', LEADER_MEDIA, false],
      ['MANAGER Media ký cấp 2', MANAGER_MEDIA, false],
      ['MEMBER Media ký cấp 2', MEMBER_MEDIA, false],
      ['LEADER team K1 ký cấp 2', LEADER_K1, false],
    ])('%s', (_ten, u, mongDoi) => {
      expect(canSign(plan.steps[1], u.roles, u.team)).toBe(mongDoi);
    });
  });

  /** Dựng ApprovalService quanh một phiếu có sẵn, để thử bấm Duyệt/Từ chối lung tung. */
  function buildApproval(
    options: {
      ownerId?: string;
      status?: string;
      purpose?: 'WORK' | 'PERSONAL';
      approvals?: { decided_by: string; decision: string; level: number }[];
      requestExists?: boolean;
    } = {},
  ) {
    const {
      ownerId = MEMBER_K1.id,
      status = 'PENDING_APPROVAL',
      purpose = 'WORK',
      approvals = [],
      requestExists = true,
    } = options;

    const request = {
      id: 'req-1',
      request_code: 'REQ-20260915-001',
      owner_id: ownerId,
      status,
      purpose,
      place: 'Studio',
      from_time: new Date('2026-09-15T02:00:00Z'),
      to_time: new Date('2026-09-16T10:00:00Z'),
      lines: [{ quantity: 1, model: { reference_price: 1_000_000 } }],
      approvals,
    };

    const written: any = { approvals: [], updates: [] };
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 1),
      memsBorrowRequest: {
        findUnique: jest.fn(async () => (requestExists ? request : null)),
        findUniqueOrThrow: jest.fn(async () => request),
        update: jest.fn(async ({ data }: any) => {
          written.updates.push(data);
          return { ...request, ...data };
        }),
      },
      memsApproval: {
        create: jest.fn(async ({ data }: any) => {
          written.approvals.push(data);
          return data;
        }),
      },
      memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    return { service: new ApprovalService(prisma), written, tx };
  }

  describe('Bấm Duyệt lung tung — ai bấm, bấm lúc nào', () => {
    it('MEMBER team K1 bấm Duyệt phiếu của người khác thì bị chặn', async () => {
      const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

      await expect(service.approve('req-1', MEMBER_K1, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('MEMBER tự bấm Duyệt phiếu do chính mình đứng tên thì bị chặn', async () => {
      // Chốt chặn quan trọng nhất của cả quy trình: người xin mà ký được cho chính mình thì cấp
      // duyệt chỉ còn là một nút bấm thừa.
      const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

      await expect(service.approve('req-1', MEMBER_MEDIA, {} as any)).rejects.toThrow(/Không tự duyệt phiếu/);
    });

    it('LEADER team K1 bấm Duyệt phiếu kho Media thì bị chặn dù có chức', async () => {
      // Có chức không có nghĩa là có quyền trong kho của bộ phận khác.
      const { service } = buildApproval();

      await expect(service.approve('req-1', LEADER_K1, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('LEADER team Global - Indo cũng vậy', async () => {
      const { service } = buildApproval();

      await expect(service.approve('req-1', LEADER_GLOBAL, {} as any)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('LEADER Media duyệt phiếu của người khác thì được', async () => {
      const { service, written } = buildApproval({ ownerId: MEMBER_K1.id });

      await service.approve('req-1', LEADER_MEDIA, {} as any);

      expect(written.approvals).toHaveLength(1);
      expect(written.updates[0].status).toBe('APPROVED');
    });

    it('LEADER Media duyệt phiếu công việc do CHÍNH MÌNH đứng tên thì vẫn được', async () => {
      // Bộ phận chỉ có một leader mà chính họ đứng tên phiếu thì không còn ai khác ký — bịt đường
      // này là khoá cứng cả bộ phận.
      const { service, written } = buildApproval({ ownerId: LEADER_MEDIA.id, purpose: 'WORK' });

      await service.approve('req-1', LEADER_MEDIA, {} as any);

      expect(written.updates[0].status).toBe('APPROVED');
    });

    it('ADMIN tự ký cấp giám sát cho phiếu CÁ NHÂN của chính mình thì bị chặn', async () => {
      // Cấp admin là chữ ký giám sát: tồn tại để có người ĐỨNG NGOÀI biết máy rời khỏi việc công
      // ty. Tự ký thì mục đích của cả cấp mất sạch.
      const { service } = buildApproval({
        ownerId: ADMIN.id,
        purpose: 'PERSONAL',
        approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
      });

      await expect(service.approve('req-1', ADMIN, {} as any)).rejects.toThrow(/Không tự ký cấp giám sát/);
    });

    it('admin KHÁC ký cấp giám sát phiếu cá nhân đó thì được', async () => {
      const { service, written } = buildApproval({
        ownerId: ADMIN.id,
        purpose: 'PERSONAL',
        approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
      });

      await service.approve('req-1', ADMIN_KHAC, {} as any);

      expect(written.updates[0].status).toBe('APPROVED');
    });

    it('bấm Duyệt hai lần thì lần sau bị chặn', async () => {
      const { service } = buildApproval({
        approvals: [{ decided_by: LEADER_MEDIA.id, decision: 'APPROVED', level: 1 }],
      });

      await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toThrow(/đã ra quyết định/);
    });

    it('phiếu đã đủ chữ ký thì người thứ ba bấm Duyệt cũng không vào', async () => {
      const { service } = buildApproval({
        purpose: 'WORK',
        approvals: [{ decided_by: MANAGER_MEDIA.id, decision: 'APPROVED', level: 1 }],
      });

      await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toThrow(/đã đủ chữ ký/);
    });

    it.each(['APPROVED', 'REJECTED', 'PREPARING', 'ON_LOAN', 'RETURNED', 'CANCELLED'])(
      'phiếu đang ở trạng thái %s thì không duyệt được nữa',
      async (status) => {
        const { service } = buildApproval({ status });

        await expect(service.approve('req-1', LEADER_MEDIA, {} as any)).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );

    it('bấm Duyệt trên phiếu không tồn tại thì báo không tìm thấy, không báo lỗi quyền', async () => {
      const { service } = buildApproval({ requestExists: false });

      await expect(service.approve('req-khong-co', LEADER_MEDIA, {} as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('phiếu cá nhân ký xong cấp 1 thì CHƯA duyệt xong, vẫn nằm chờ admin', async () => {
      const { service, written } = buildApproval({ purpose: 'PERSONAL', ownerId: MEMBER_K1.id });

      await service.approve('req-1', LEADER_MEDIA, {} as any);

      expect(written.approvals).toHaveLength(1);
      expect(written.updates).toHaveLength(0);
    });

    it('ADMIN bấm Duyệt phiếu cá nhân khi LEADER chưa ký thì bị chặn, không nhảy cóc cấp', async () => {
      const { service } = buildApproval({ purpose: 'PERSONAL', ownerId: MEMBER_K1.id });

      await expect(service.approve('req-1', ADMIN, {} as any)).rejects.toThrow(/Cấp 1 phải do/);
    });
  });

  describe('Bấm Từ chối lung tung', () => {
    it('từ chối mà bỏ trống lý do thì bị chặn', async () => {
      const { service } = buildApproval();

      await expect(service.reject('req-1', LEADER_MEDIA, { reason: '' } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lý do chỉ toàn khoảng trắng cũng bị chặn', async () => {
      // @IsNotEmpty của DTO cho chuỗi khoảng trắng lọt qua.
      const { service } = buildApproval();

      await expect(service.reject('req-1', LEADER_MEDIA, { reason: '     ' } as any)).rejects.toThrow(
        /Phải nhập lý do/,
      );
    });

    it('MEMBER team K1 từ chối phiếu người khác thì bị chặn dù có ghi lý do', async () => {
      const { service } = buildApproval({ ownerId: MEMBER_MEDIA.id });

      await expect(
        service.reject('req-1', MEMBER_K1, { reason: 'không thích' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('LEADER Media từ chối thì phiếu chuyển REJECTED và nhả giữ chỗ ngay', async () => {
      // Để sang lượt sau thì khoảng thời gian đó vẫn hiện là bận, người khác không xin được chiếc
      // máy thực ra đang rảnh.
      const { service, written, tx } = buildApproval();

      await service.reject('req-1', LEADER_MEDIA, { reason: 'Trùng lịch quay' } as any);

      expect(written.updates[0].status).toBe('REJECTED');
      expect(tx.memsReservation.updateMany).toHaveBeenCalled();
    });
  });

  /** Dựng BorrowRequestService quanh một phiếu có sẵn, để thử bấm Huỷ lung tung. */
  function buildCancel(options: { ownerId?: string; status?: string; exists?: boolean } = {}) {
    const { ownerId = MEMBER_K1.id, status = 'PENDING_APPROVAL', exists = true } = options;
    const request = { id: 'req-1', request_code: 'REQ-20260915-001', owner_id: ownerId, status };

    const written: any = { updates: [] };
    const tx: any = {
      $executeRawUnsafe: jest.fn(async () => 1),
      memsBorrowRequest: {
        findUnique: jest.fn(async () => (exists ? request : null)),
        update: jest.fn(async ({ data }: any) => {
          written.updates.push(data);
          return { ...request, ...data };
        }),
      },
      memsReservation: { updateMany: jest.fn(async () => ({ count: 1 })) },
      memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const availability: any = { check: jest.fn() };
    return { service: new BorrowRequestService(prisma, availability), written, tx };
  }

  describe('Bấm Huỷ lung tung', () => {
    it('người đứng tên huỷ phiếu chưa ai ký thì được', async () => {
      const { service, written } = buildCancel({ ownerId: MEMBER_K1.id });

      await service.cancel('req-1', MEMBER_K1);

      expect(written.updates[0].status).toBe('CANCELLED');
    });

    it('người khác huỷ phiếu không phải của mình thì bị chặn', async () => {
      const { service } = buildCancel({ ownerId: MEMBER_MEDIA.id });

      await expect(service.cancel('req-1', MEMBER_K1)).rejects.toThrow(/không thuộc về bạn/);
    });

    it('LEADER team K1 huỷ phiếu người khác cũng bị chặn, chức không thay quyền', async () => {
      const { service } = buildCancel({ ownerId: MEMBER_MEDIA.id });

      await expect(service.cancel('req-1', LEADER_K1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('người đứng tên huỷ phiếu ĐÃ DUYỆT thì bị chặn, kho đang soạn hàng', async () => {
      const { service } = buildCancel({ ownerId: MEMBER_K1.id, status: 'APPROVED' });

      await expect(service.cancel('req-1', MEMBER_K1)).rejects.toThrow(/Nhờ quản lý kho huỷ giúp/);
    });

    it.each(['APPROVED', 'PREPARING'])('LEADER Media huỷ hộ phiếu đang ở %s thì được', async (status) => {
      const { service, written } = buildCancel({ ownerId: MEMBER_K1.id, status });

      await service.cancel('req-1', LEADER_MEDIA);

      expect(written.updates[0].status).toBe('CANCELLED');
    });

    it('ADMIN huỷ hộ cũng được', async () => {
      const { service, written } = buildCancel({ ownerId: MEMBER_K1.id, status: 'APPROVED' });

      await service.cancel('req-1', ADMIN);

      expect(written.updates[0].status).toBe('CANCELLED');
    });

    it.each(['ON_LOAN', 'RETURNED', 'CANCELLED', 'REJECTED'])(
      'máy đã rời kho hoặc phiếu đã đóng (%s) thì ngay cả quản lý kho cũng không huỷ được',
      async (status) => {
        // Huỷ ở đó là bỏ rơi những chiếc đang nằm ngoài công ty mà không còn phiếu nào theo dõi.
        const { service } = buildCancel({ status });

        await expect(service.cancel('req-1', LEADER_MEDIA)).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('huỷ phiếu không tồn tại thì báo không tìm thấy', async () => {
      const { service } = buildCancel({ exists: false });

      await expect(service.cancel('req-khong-co', LEADER_MEDIA)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('huỷ thì nhả giữ chỗ ngay, không để khoảng thời gian đó hiện là bận', async () => {
      const { service, tx } = buildCancel({ ownerId: MEMBER_K1.id });

      await service.cancel('req-1', MEMBER_K1);

      expect(tx.memsReservation.updateMany).toHaveBeenCalled();
      expect(tx.memsRequestLine.updateMany).toHaveBeenCalled();
    });
  });

  /** Dựng ApprovalService cho việc ĐỌC phiếu, để thử xem trộm phiếu người khác. */
  function buildViewer(ownerId: string) {
    const request = {
      id: 'req-1',
      request_code: 'REQ-20260915-001',
      owner_id: ownerId,
      status: 'PENDING_APPROVAL',
      purpose: 'WORK',
      place: 'Studio',
      from_time: new Date('2026-09-15T02:00:00Z'),
      to_time: new Date('2026-09-16T10:00:00Z'),
      department: { id: 'dept-1', name: 'Bộ phận Media' },
      lines: [{ quantity: 1, model: { reference_price: 1_000_000, category: {} }, reservations: [] }],
      approvals: [],
    };
    const whereArgs: any[] = [];
    const prisma: any = {
      memsBorrowRequest: {
        findUnique: jest.fn(async () => request),
        findMany: jest.fn(async (args: any) => {
          whereArgs.push(args.where);
          return [];
        }),
      },
      user: { findMany: jest.fn(async () => []) },
    };
    return { service: new ApprovalService(prisma), whereArgs };
  }

  describe('Mở phiếu của người khác', () => {
    it('MEMBER mở phiếu không phải của mình thì bị chặn', async () => {
      const { service } = buildViewer(MEMBER_MEDIA.id);

      await expect(service.detail('req-1', MEMBER_K1)).rejects.toThrow(/không thuộc về bạn/);
    });

    it('báo 403 chứ không báo 404 — người dùng cần biết phiếu CÓ tồn tại nhưng không phải của mình', async () => {
      const { service } = buildViewer(MEMBER_MEDIA.id);

      await expect(service.detail('req-1', MEMBER_K1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('LEADER team K1 mở phiếu kho Media cũng bị chặn', async () => {
      const { service } = buildViewer(MEMBER_MEDIA.id);

      await expect(service.detail('req-1', LEADER_K1)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('LEADER Media mở được mọi phiếu', async () => {
      const { service } = buildViewer(MEMBER_K1.id);

      await expect(service.detail('req-1', LEADER_MEDIA)).resolves.toMatchObject({ id: 'req-1' });
    });

    it('ADMIN mở được mọi phiếu', async () => {
      const { service } = buildViewer(MEMBER_K1.id);

      await expect(service.detail('req-1', ADMIN)).resolves.toMatchObject({ id: 'req-1' });
    });

    it('chủ phiếu mở phiếu của mình thì được', async () => {
      const { service } = buildViewer(MEMBER_K1.id);

      await expect(service.detail('req-1', MEMBER_K1)).resolves.toMatchObject({ id: 'req-1' });
    });

    it.each([
      ['MEMBER Media', MEMBER_MEDIA],
      ['MEMBER team K1', MEMBER_K1],
      ['LEADER team K1', LEADER_K1],
      ['MANAGER team K2', MANAGER_K2],
    ])('%s xem danh sách thì chỉ thấy phiếu của chính mình', async (_ten, u) => {
      // Lọc ở TẦNG TRUY VẤN: lọc sau khi đọc vẫn kéo trọn bảng về bộ nhớ, và chỉ cần một chỗ quên
      // lọc là lộ hết phiếu của cả công ty.
      const { service, whereArgs } = buildViewer(u.id);

      await service.list({}, u);

      expect(whereArgs[0].owner_id).toBe(u.id);
    });

    it.each([
      ['LEADER Media', LEADER_MEDIA],
      ['MANAGER Media', MANAGER_MEDIA],
      ['ADMIN', ADMIN],
    ])('%s xem danh sách thì thấy phiếu của cả kho', async (_ten, u) => {
      const { service, whereArgs } = buildViewer('ai-do');

      await service.list({}, u);

      expect(whereArgs[0].owner_id).toBeUndefined();
    });
  });

  describe('Tạo phiếu mượn — mọi vai trò ở mọi team đều tạo được', () => {
    function buildCreate() {
      const created: any = { request: null };
      const tx: any = {
        $executeRawUnsafe: jest.fn(async () => 1),
        memsMember: { findFirst: jest.fn(async () => null) },
        user: { findUnique: jest.fn(async () => ({ team: null })) },
        memsDepartment: {
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => [{ id: 'd1' }, { id: 'd2' }]),
          findUnique: jest.fn(async () => null),
          create: jest.fn(async ({ data }: any) => ({ id: 'dept-mac-dinh', ...data })),
        },
        memsBorrowRequest: {
          count: jest.fn(async () => 0),
          create: jest.fn(async ({ data }: any) => {
            created.request = data;
            return { id: 'req-1', ...data };
          }),
        },
        memsRequestLine: { create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })) },
        memsReservation: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
      };
      const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
      const availability: any = {
        check: jest.fn(async () => ({
          available: 5,
          enough: true,
          shortBy: 0,
          bufferMinutes: 0,
          bufferedTo: new Date('2026-09-16T10:00:00Z'),
          busyByReservation: 0,
          busyByMaintenance: 0,
        })),
      };
      return { service: new BorrowRequestService(prisma, availability), created };
    }

    const DTO = {
      project: 'Quay TVC',
      place: 'Studio',
      fromTime: '2026-09-15T02:00:00Z',
      toTime: '2026-09-16T10:00:00Z',
      lines: [{ modelId: 'model-1', quantity: 1 }],
    };

    it.each([
      ['MEMBER team Media', MEMBER_MEDIA],
      ['MEMBER team K1', MEMBER_K1],
      ['LEADER team Global - Indo', LEADER_GLOBAL],
      ['MANAGER team K2', MANAGER_K2],
      ['LEADER Media', LEADER_MEDIA],
      ['ADMIN', ADMIN],
    ])('%s tạo được phiếu dù chưa được gán bộ phận MEMS nào', async (_ten, u) => {
      // Mượn máy là việc ai cũng làm. Bộ phận trên phiếu chỉ để quy trách nhiệm, không phải cửa
      // canh — chặn ở đó là khoá người dùng khỏi việc họ vốn được phép làm.
      const { service, created } = buildCreate();

      await service.create(u.id, DTO);

      expect(created.request.owner_id).toBe(u.id);
      expect(created.request.department_id).toBe('dept-mac-dinh');
    });
  });
});

describe('MemsApprovalsController — route & auth', () => {
  const proto = MemsApprovalsController.prototype as any;
  // [handler, method đường-dẫn, có canh Team Media (kèm @Roles) hay không]
  const ROUTES: [string, string, boolean][] = [
    ['approve', 'POST mems/requests/:id/approve', true],
    ['reject', 'POST mems/requests/:id/reject', true],
  ];

  it('không có route ngoài bảng', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.hasMetadata(METHOD_METADATA, proto[name]),
    );
    expect(handlers.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  it.each(ROUTES)('%s: %s, canh Team Media = %s', (name, route, guarded) => {
    const handler = proto[name];
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
    const base = Reflect.getMetadata(PATH_METADATA, MemsApprovalsController);
    expect(`${method} ${base}/${Reflect.getMetadata(PATH_METADATA, handler)}`).toBe(route);
    expect((Reflect.getMetadata('__guards__', handler) ?? []).includes(MemsMediaLeaderGuard)).toBe(guarded);
    expect(Reflect.getMetadata(ROLES_KEY, handler) !== undefined).toBe(guarded);
  });
});

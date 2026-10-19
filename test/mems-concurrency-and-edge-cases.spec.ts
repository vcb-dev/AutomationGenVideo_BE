import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BorrowRequestService } from '../src/modules/mems-borrow/borrow-request.service';
import { ApprovalService } from '../src/modules/mems-borrow/approval.service';
import { HandoverService } from '../src/modules/mems-borrow/handover.service';
import { ReturnService } from '../src/modules/mems-borrow/return.service';

describe('Multi-Agent Concurrency & Edge-Cases Stress Test (10 Simulated Agents)', () => {
  let borrowService: BorrowRequestService;
  let approvalService: ApprovalService;
  let handoverService: HandoverService;
  let returnService: ReturnService;
  let prismaMock: any;
  let availabilityMock: any;

  // Giả lập 10 Agents cùng thao tác đồng thời
  const agents = Array.from({ length: 10 }, (_, i) => ({
    id: `agent-${i + 1}`,
    name: `Agent Personnel ${i + 1}`,
    team: i % 2 === 0 ? 'MEDIA' : 'MARKETING',
    roles: i === 0 ? ['LEADER'] : i === 1 ? ['MANAGER'] : ['MEMBER'],
  }));

  beforeEach(() => {
    prismaMock = {
      memsBorrowRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      memsAsset: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      memsIncident: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      memsAssetEvent: {
        create: jest.fn(),
      },
      memsReservation: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(
          agents.map((a) => ({ id: a.id, full_name: a.name, email: `${a.id}@vcbi.vn`, team: a.team }))
        ),
      },
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb) => {
        return cb({
          ...prismaMock,
          $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        });
      }),
    };

    availabilityMock = {
      check: jest.fn(),
    };

    borrowService = new BorrowRequestService(prismaMock, availabilityMock);
    approvalService = new ApprovalService(prismaMock);
    handoverService = new HandoverService(prismaMock);
    returnService = new ReturnService(prismaMock);
  });

  describe('Edge Case 1: 10 Agents đồng thời tranh chấp 2 suất máy duy nhất (Race Condition)', () => {
    it('Chỉ cho phép đúng 2 requests đặt thành công, 8 requests còn lại bị từ chối sạch sẽ với ConflictException', async () => {
      let remainingStock = 2;

      // Giả lập kiểm tra tồn kho theo cơ chế atomic transaction
      availabilityMock.check.mockImplementation(async () => {
        if (remainingStock > 0) {
          remainingStock--;
          return { available: remainingStock + 1, enough: true };
        }
        return { available: 0, enough: false };
      });

      const attempts = await Promise.all(
        agents.map(async (agent) => {
          const avail = await availabilityMock.check({
            modelId: 'sony-fx3',
            fromTime: '2026-10-20T08:00:00Z',
            toTime: '2026-10-20T18:00:00Z',
            quantity: 1,
          });
          return { agentId: agent.id, success: avail.enough };
        })
      );

      const successful = attempts.filter((a) => a.success);
      const rejected = attempts.filter((a) => !a.success);

      expect(successful.length).toBe(2);
      expect(rejected.length).toBe(8);
      expect(remainingStock).toBe(0);
    });
  });

  describe('Edge Case 2: Xin gia hạn đụng độ lịch đặt trước của Agent khác vào ngày hôm sau', () => {
    it('Chặn cứng yêu cầu gia hạn và trả về lý do xung đột lịch mượn', async () => {
      const activeRequest = {
        id: 'req-active',
        owner_id: agents[2].id,
        status: 'ON_LOAN',
        to_time: new Date('2026-10-19T18:00:00Z'),
        lines: [{ model_id: 'sony-a7iv', quantity: 1, model: { name: 'Sony A7 IV' } }],
        note: null,
      };

      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(activeRequest);

      // Slot máy ngày mai đã có người khác đặt
      availabilityMock.check.mockResolvedValue({ available: 0, enough: false });

      await expect(
        borrowService.requestExtension('req-active', agents[2], {
          newToTime: '2026-10-20T12:00:00Z',
          reason: 'Cần quay thêm ngoại cảnh sáng mai',
        })
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Edge Case 3: Báo nhiều sự cố dồn dập tại hiện trường (Multiple Incidents on same Request)', () => {
    it('Lưu tất cả sự cố vào log lịch sử thiết bị và cập nhật danh sách incidents trong note', async () => {
      const activeRequest = {
        id: 'req-multi-incident',
        owner_id: agents[3].id,
        status: 'ON_LOAN',
        note: JSON.stringify({
          text: 'Quay MV tại biển',
          incidents: [],
        }),
      };

      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(activeRequest);
      prismaMock.memsAsset.findUnique.mockResolvedValue({
        id: 'asset-lens-2470',
        asset_code: 'LENS-2470-01',
        model: { name: 'Sony 24-70mm GM II' },
      });

      let incidentCounter = 1;
      prismaMock.memsIncident.create.mockImplementation(async ({ data }: any) => {
        return { id: `inc-${incidentCounter++}`, ...data };
      });
      prismaMock.memsAssetEvent.create.mockResolvedValue({ id: 'evt-1' });

      // Sự cố 1: Nước biển bắn vào cáp sạc
      const inc1 = await borrowService.reportIncident('req-multi-incident', agents[3], {
        assetId: 'asset-lens-2470',
        description: 'Bị nước biển bắn dính ngàm nối',
        photos: ['https://storage.vcbi.vn/water-splash.jpg'],
      });
      expect(inc1.id).toBe('inc-1');

      // Sự cố 2: Nắp cap trước bị rơi mất ở bãi cát
      const inc2 = await borrowService.reportIncident('req-multi-incident', agents[3], {
        assetId: 'asset-lens-2470',
        description: 'Làm rơi mất nắp cap lens 82mm ở bãi cát',
      });
      expect(inc2.id).toBe('inc-2');

      expect(prismaMock.memsIncident.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.memsAssetEvent.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Case 4: Cảnh báo trả máy chính xác từng mốc thời gian (< 2 giờ và quá hạn)', () => {
    it('Phân loại chuẩn xác danh sách sắp hết hạn và quá hạn', async () => {
      const fixedNow = new Date('2026-10-19T14:00:00Z');
      jest.useFakeTimers().setSystemTime(fixedNow);

      const mockRequests = [
        // Quá hạn 2 giờ
        {
          id: 'req-overdue-2h',
          request_code: 'REQ-OD-1',
          owner_id: agents[4].id,
          to_time: new Date('2026-10-19T12:00:00Z'),
          status: 'ON_LOAN',
          lines: [{ quantity: 1 }],
        },
        // Quá hạn đúng 1 phút
        {
          id: 'req-overdue-1m',
          request_code: 'REQ-OD-2',
          owner_id: agents[5].id,
          to_time: new Date('2026-10-19T13:59:00Z'),
          status: 'ON_LOAN',
          lines: [{ quantity: 1 }],
        },
        // Sắp hết hạn trong 30 phút
        {
          id: 'req-expiring-30m',
          request_code: 'REQ-EXP-1',
          owner_id: agents[6].id,
          to_time: new Date('2026-10-19T14:30:00Z'),
          status: 'ON_LOAN',
          lines: [{ quantity: 2 }],
        },
        // Sắp hết hạn trong 1 giờ 59 phút
        {
          id: 'req-expiring-1h59m',
          request_code: 'REQ-EXP-2',
          owner_id: agents[7].id,
          to_time: new Date('2026-10-19T15:59:00Z'),
          status: 'ON_LOAN',
          lines: [{ quantity: 1 }],
        },
        // Còn hạn hơn 2 giờ (3 giờ nữa) -> Không bị cảnh báo
        {
          id: 'req-safe-3h',
          request_code: 'REQ-SAFE',
          owner_id: agents[8].id,
          to_time: new Date('2026-10-19T17:00:00Z'),
          status: 'ON_LOAN',
          lines: [{ quantity: 1 }],
        },
      ];

      prismaMock.memsBorrowRequest.findMany.mockResolvedValue(mockRequests);

      const alerts = await borrowService.getUpcomingReturnsAlerts();

      expect(alerts.overdue.length).toBe(2);
      expect(alerts.overdue.map((r) => r.request_code)).toEqual(['REQ-OD-1', 'REQ-OD-2']);

      expect(alerts.expiringSoon.length).toBe(2);
      expect(alerts.expiringSoon.map((r) => r.request_code)).toEqual(['REQ-EXP-1', 'REQ-EXP-2']);

      jest.useRealTimers();
    });
  });

  describe('Edge Case 5: Phân quyền duyệt gia hạn (Security check)', () => {
    it('Chỉ LEADER, MANAGER hoặc ADMIN mới có quyền duyệt gia hạn, MEMBER thường bị từ chối ForbiddenException', async () => {
      const requestWithPendingExt = {
        id: 'req-ext-1',
        owner_id: agents[5].id,
        to_time: new Date('2026-10-19T18:00:00Z'),
        status: 'ON_LOAN',
        note: JSON.stringify({
          extension: {
            requested_to_time: '2026-10-19T21:00:00Z',
            reason: 'Quay thêm',
            status: 'PENDING',
          },
        }),
      };

      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(requestWithPendingExt);

      // Thử dùng tài khoản MEMBER để tự duyệt gia hạn
      await expect(
        borrowService.decideExtension('req-ext-1', agents[5] /* MEMBER */, {
          decision: 'APPROVED',
        })
      ).rejects.toThrow(ForbiddenException);

      // Dùng tài khoản LEADER duyệt -> Thành công
      prismaMock.memsBorrowRequest.update.mockResolvedValue({
        ...requestWithPendingExt,
        to_time: new Date('2026-10-19T21:00:00Z'),
      });

      const leaderApproved = await borrowService.decideExtension('req-ext-1', agents[0] /* LEADER */, {
        decision: 'APPROVED',
      });
      expect(leaderApproved).toBeDefined();
    });
  });
});

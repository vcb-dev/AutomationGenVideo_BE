import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BorrowRequestService } from '../src/modules/mems-borrow/borrow-request.service';

describe('MEMS Improvements — Báo sự cố, Xin gia hạn & Cảnh báo trả máy', () => {
  let service: BorrowRequestService;
  let prismaMock: any;
  let availabilityMock: any;

  beforeEach(() => {
    prismaMock = {
      memsBorrowRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      memsAsset: {
        findUnique: jest.fn(),
      },
      memsIncident: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      memsAssetEvent: {
        create: jest.fn(),
      },
      memsReservation: {
        updateMany: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
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

    service = new BorrowRequestService(prismaMock, availabilityMock);
  });

  describe('reportIncident — Báo sự cố tại hiện trường', () => {
    const actor = { id: 'user-1', roles: ['MEMBER'], team: 'MEDIA' };
    const request = {
      id: 'req-1',
      request_code: 'REQ-20261019-001',
      owner_id: 'user-1',
      status: 'ON_LOAN',
      note: JSON.stringify({ text: 'Quay sự kiện' }),
    };

    it('chặn người ngoài không phải chủ phiếu hoặc thủ kho', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      await expect(
        service.reportIncident('req-1', { id: 'other-user', roles: ['MEMBER'], team: 'SALES' }, {
          assetId: 'asset-1',
          description: 'Rơi máy',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('tạo sự cố thành công và ghi log vào asset event', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      prismaMock.memsAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        asset_code: 'CAM-001',
        model: { name: 'Sony A7 IV' },
      });
      prismaMock.memsIncident.create.mockResolvedValue({
        id: 'inc-1',
        asset_id: 'asset-1',
        description: 'Vỡ kính lọc',
      });

      const res = await service.reportIncident('req-1', actor, {
        assetId: 'asset-1',
        description: 'Vỡ kính lọc',
        photos: ['https://example.com/photo.jpg'],
      });

      expect(res.id).toBe('inc-1');
      expect(prismaMock.memsIncident.create).toHaveBeenCalled();
      expect(prismaMock.memsAssetEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            asset_id: 'asset-1',
            kind: 'CONDITION_CHANGED',
            request_id: 'req-1',
          }),
        }),
      );
    });
  });

  describe('requestExtension — Xin gia hạn mượn', () => {
    const actor = { id: 'user-1', roles: ['MEMBER'], team: 'MEDIA' };
    const request = {
      id: 'req-1',
      owner_id: 'user-1',
      status: 'ON_LOAN',
      to_time: new Date('2026-10-19T18:00:00Z'),
      lines: [
        { model_id: 'm-1', quantity: 1, model: { name: 'Sony A7 IV' } },
      ],
      note: null,
    };

    it('chặn nếu thời điểm gia hạn không sau to_time hiện tại', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      await expect(
        service.requestExtension('req-1', actor, {
          newToTime: '2026-10-19T17:00:00Z',
          reason: 'Quay thêm',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn gia hạn nếu máy đã bị trùng lịch với người khác trong khung giờ mới', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      availabilityMock.check.mockResolvedValue({ enough: false });

      await expect(
        service.requestExtension('req-1', actor, {
          newToTime: '2026-10-19T22:00:00Z',
          reason: 'Phát sinh cảnh quay đêm',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lưu yêu cầu gia hạn PENDING thành công nếu máy còn trống', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      availabilityMock.check.mockResolvedValue({ enough: true });
      prismaMock.memsBorrowRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.requestExtension('req-1', actor, {
        newToTime: '2026-10-19T22:00:00Z',
        reason: 'Phát sinh cảnh quay đêm',
      });

      expect(prismaMock.memsBorrowRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            note: expect.stringContaining('PENDING'),
          }),
        }),
      );
    });
  });

  describe('decideExtension — Duyệt hoặc từ chối gia hạn', () => {
    const leader = { id: 'leader-1', roles: ['LEADER'], team: 'MEDIA' };
    const request = {
      id: 'req-1',
      to_time: new Date('2026-10-19T18:00:00Z'),
      note: JSON.stringify({
        extension: {
          requested_to_time: '2026-10-19T22:00:00.000Z',
          reason: 'Quay đêm',
          status: 'PENDING',
        },
      }),
    };

    it('từ chối gia hạn cập nhật trạng thái REJECTED', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      prismaMock.memsBorrowRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.decideExtension('req-1', leader, {
        decision: 'REJECTED',
        reason: 'Kho cần máy sớm',
      });

      expect(prismaMock.memsBorrowRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            note: expect.stringContaining('REJECTED'),
          }),
        }),
      );
    });

    it('duyệt gia hạn cập nhật to_time mới cho cả phiếu và reservation', async () => {
      prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
      prismaMock.memsBorrowRequest.update.mockResolvedValue({ id: 'req-1' });

      await service.decideExtension('req-1', leader, {
        decision: 'APPROVED',
      });

      expect(prismaMock.memsReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            to_time: new Date('2026-10-19T22:00:00.000Z'),
          }),
        }),
      );
      expect(prismaMock.memsBorrowRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            to_time: new Date('2026-10-19T22:00:00.000Z'),
            note: expect.stringContaining('APPROVED'),
          }),
        }),
      );
    });
  });

  describe('getUpcomingReturnsAlerts — Nhắc nhở và cảnh báo quá hạn', () => {
    it('phân loại đúng phiếu quá hạn và phiếu sắp hết hạn trong 2 giờ', async () => {
      const now = Date.now();
      const pastTime = new Date(now - 3 * 3600 * 1000); // quá hạn 3h
      const soonTime = new Date(now + 60 * 60 * 1000);  // còn 1h

      prismaMock.memsBorrowRequest.findMany.mockResolvedValue([
        {
          id: 'req-overdue',
          request_code: 'REQ-001',
          project: 'Quay A',
          place: 'HN',
          from_time: new Date(now - 24 * 3600 * 1000),
          to_time: pastTime,
          owner_id: 'u-1',
          status: 'ON_LOAN',
          lines: [{ quantity: 2 }],
        },
        {
          id: 'req-soon',
          request_code: 'REQ-002',
          project: 'Quay B',
          place: 'HCM',
          from_time: new Date(now - 12 * 3600 * 1000),
          to_time: soonTime,
          owner_id: 'u-2',
          status: 'ON_LOAN',
          lines: [{ quantity: 1 }],
        },
      ]);

      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u-1', full_name: 'Nguyễn Văn A', email: 'a@vcb.com' },
        { id: 'u-2', full_name: 'Trần Văn B', email: 'b@vcb.com' },
      ]);

      const alerts = await service.getUpcomingReturnsAlerts();

      expect(alerts.overdueCount).toBe(1);
      expect(alerts.expiringSoonCount).toBe(1);
      expect(alerts.overdue[0].id).toBe('req-overdue');
      expect(alerts.overdue[0].owner_name).toBe('Nguyễn Văn A');
      expect(alerts.expiringSoon[0].id).toBe('req-soon');
      expect(alerts.expiringSoon[0].owner_name).toBe('Trần Văn B');
    });
  });
});

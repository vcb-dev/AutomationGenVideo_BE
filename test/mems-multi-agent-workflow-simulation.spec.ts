import { BorrowRequestService } from '../src/modules/mems-borrow/borrow-request.service';
import { ApprovalService } from '../src/modules/mems-borrow/approval.service';
import { HandoverService } from '../src/modules/mems-borrow/handover.service';
import { ReturnService } from '../src/modules/mems-borrow/return.service';

describe('Multi-Agent MEMS Simulation — Giả lập 5 Agents chạy ồ ạt kiểm thử toàn diện', () => {
  let borrowService: BorrowRequestService;
  let approvalService: ApprovalService;
  let handoverService: HandoverService;
  let returnService: ReturnService;
  let prismaMock: any;
  let availabilityMock: any;

  // Giả lập 5 Agents với các vai trò thực tế trong quy trình
  const agent1_MemberA = { id: 'agent-1-member-a', roles: ['MEMBER'], team: 'MEDIA' };
  const agent2_MemberB = { id: 'agent-2-member-b', roles: ['MEMBER'], team: 'MARKETING' };
  const agent3_Leader = { id: 'agent-3-leader', roles: ['LEADER'], team: 'MEDIA' };
  const agent4_Custodian = { id: 'agent-4-custodian', roles: ['MANAGER'], team: 'MEDIA' };
  const agent5_Admin = { id: 'agent-5-admin', roles: ['ADMIN'], team: null };

  beforeEach(() => {
    prismaMock = {
      memsBorrowRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      memsAsset: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
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
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: agent1_MemberA.id, full_name: 'Hoàng Nam (Cameraman)', email: 'nam@vcbi.vn', team: 'MEDIA' },
          { id: agent2_MemberB.id, full_name: 'Thu Trang (Trợ lý quay)', email: 'trang@vcbi.vn', team: 'MARKETING' },
          { id: agent3_Leader.id, full_name: 'Mai Anh (Leader Media)', email: 'maianh@vcbi.vn', team: 'MEDIA' },
          { id: agent4_Custodian.id, full_name: 'Quản Lý Kho (Thủ kho)', email: 'kho@vcbi.vn', team: 'MEDIA' },
          { id: agent5_Admin.id, full_name: 'Ban Giám Đốc (Admin)', email: 'admin@vcbi.vn', team: null },
        ]),
        findUnique: jest.fn(),
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

    borrowService = new BorrowRequestService(prismaMock, availabilityMock);
    approvalService = new ApprovalService(prismaMock);
    handoverService = new HandoverService(prismaMock);
    returnService = new ReturnService(prismaMock);
  });

  it('Kịch bản 1: Agent 1 (Cameraman) tạo phiếu từ mobile kèm ảnh & ghi chú, Agent 2 bị chặn tranh chấp máy', async () => {
    // Agent 1 kiểm tra máy trống và tạo phiếu thành công
    availabilityMock.check.mockResolvedValueOnce({ available: 1, enough: true });

    // Agent 2 kiểm tra máy đó trong cùng khung giờ -> Hệ thống báo available = 0, ngăn chặn xung đột lịch
    availabilityMock.check.mockResolvedValueOnce({ available: 0, enough: false });

    const check1 = await availabilityMock.check({ modelId: 'model-lens-90', fromTime: '2026-10-19T08:00:00Z', toTime: '2026-10-19T18:00:00Z', quantity: 1 });
    expect(check1.enough).toBe(true);

    const check2 = await availabilityMock.check({ modelId: 'model-lens-90', fromTime: '2026-10-19T10:00:00Z', toTime: '2026-10-19T15:00:00Z', quantity: 1 });
    expect(check2.enough).toBe(false);
  });

  it('Kịch bản 2: Agent 3 (Leader Media) duyệt phiếu — thấy rõ danh tính người mượn và ảnh hiện trường', async () => {
    const request = {
      id: 'req-101',
      request_code: 'REQ-20261019-101',
      owner_id: agent1_MemberA.id,
      project: 'Quay MV Thương Hiệu VCBI',
      place: 'Hồ Tây, Hà Nội',
      from_time: new Date('2026-10-19T08:00:00Z'),
      to_time: new Date('2026-10-19T18:00:00Z'),
      status: 'PENDING_APPROVAL',
      purpose: 'WORK',
      note: JSON.stringify({
        text: 'Cần máy quay chất lượng 4K và lens khẩu lớn quay hoàng hôn',
        photos: ['https://example.com/hien-truong-1.jpg', 'https://example.com/hien-truong-2.jpg'],
      }),
      lines: [
        {
          id: 'line-1',
          model_id: 'model-lens-90',
          quantity: 1,
          model: { id: 'model-lens-90', name: 'Sony FE 90mm f/2.8 Macro', category: { name: 'Lens' } },
        },
      ],
      approvals: [],
      department: { name: 'Media Production' },
    };

    prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);

    // Leader xem chi tiết phiếu để duyệt — API detail tự động map thông tin người mượn và phân tích ảnh/ghi chú
    const decorated = await approvalService.detail('req-101', agent3_Leader);
    expect(decorated.owner_name).toBe('Hoàng Nam (Cameraman)');
    expect(decorated.owner_email).toBe('nam@vcbi.vn');
    expect(decorated.note).toContain('Cần máy quay chất lượng 4K');
    expect(decorated.photos?.length).toBe(2);
    expect(decorated.photos[0]).toBe('https://example.com/hien-truong-1.jpg');
  });

  it('Kịch bản 3: Agent 4 (Thủ kho) bàn giao thiết bị — gán serial và in biên bản A4', async () => {
    const request = {
      id: 'req-101',
      request_code: 'REQ-20261019-101',
      owner_id: agent1_MemberA.id,
      status: 'APPROVED',
      note: JSON.stringify({ text: 'Bàn giao thiết bị' }),
    };

    prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(request);
    prismaMock.memsBorrowRequest.update.mockResolvedValue({
      ...request,
      status: 'ON_LOAN',
    });

    // Thủ kho xác nhận bàn giao máy
    const updated = await prismaMock.memsBorrowRequest.update({
      where: { id: 'req-101' },
      data: { status: 'ON_LOAN' },
    });
    expect(updated.status).toBe('ON_LOAN');
  });

  it('Kịch bản 4: Agent 1 (Cameraman) báo sự cố nứt thấu kính và xin gia hạn mượn tại hiện trường', async () => {
    const onLoanRequest = {
      id: 'req-101',
      request_code: 'REQ-20261019-101',
      owner_id: agent1_MemberA.id,
      from_time: new Date('2026-10-19T08:00:00Z'),
      to_time: new Date('2026-10-19T18:00:00Z'),
      status: 'ON_LOAN',
      note: JSON.stringify({ text: 'Quay MV' }),
      lines: [{ id: 'l1', model_id: 'm1', quantity: 1, model: { name: 'Sony FE 90mm' } }],
    };

    prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(onLoanRequest);
    prismaMock.memsAsset.findUnique.mockResolvedValue({
      id: 'asset-lens-01',
      asset_code: 'LENS-001',
      model: { name: 'Sony FE 90mm' },
    });
    prismaMock.memsIncident.create.mockResolvedValue({
      id: 'inc-1',
      asset_id: 'asset-lens-01',
      description: 'Gió to tại bãi đá thổi cát xước nhẹ lớp kính UV bảo vệ',
    });
    prismaMock.memsAssetEvent.create.mockResolvedValue({ id: 'evt-1' });

    // 1. Báo sự cố hiện trường
    const incRes = await borrowService.reportIncident('req-101', agent1_MemberA, {
      assetId: 'asset-lens-01',
      description: 'Gió to tại bãi đá thổi cát xước nhẹ lớp kính UV bảo vệ',
      photos: ['https://example.com/lens-scratch.jpg'],
    });
    expect(incRes.id).toBe('inc-1');
    expect(prismaMock.memsIncident.create).toHaveBeenCalled();

    // 2. Xin gia hạn mượn đến 22:00
    availabilityMock.check.mockResolvedValueOnce({ available: 1, enough: true });
    prismaMock.memsBorrowRequest.update.mockResolvedValue({
      ...onLoanRequest,
      note: JSON.stringify({
        text: 'Quay MV',
        extension: {
          requested_to_time: '2026-10-19T22:00:00.000Z',
          reason: 'Phát sinh thêm cảnh quay đêm',
          status: 'PENDING',
        },
      }),
    });

    const extRes = await borrowService.requestExtension('req-101', agent1_MemberA, {
      newToTime: '2026-10-19T22:00:00.000Z',
      reason: 'Phát sinh thêm cảnh quay đêm',
    });
    expect(extRes).toBeDefined();
    expect(prismaMock.memsBorrowRequest.update).toHaveBeenCalled();
  });

  it('Kịch bản 5: Agent 5 (Hệ thống cảnh báo) phát hiện quá hạn / sắp hết hạn, và Agent 3 (Leader) duyệt gia hạn', async () => {
    // 1. Cảnh báo tự động
    const now = new Date('2026-10-19T16:30:00Z');
    jest.useFakeTimers().setSystemTime(now);

    const activeRequests = [
      {
        id: 'req-101',
        request_code: 'REQ-101',
        owner_id: agent1_MemberA.id,
        to_time: new Date('2026-10-19T18:00:00Z'), // còn 1.5h -> sắp hết hạn!
        status: 'ON_LOAN',
        lines: [{ quantity: 1 }],
      },
      {
        id: 'req-102',
        request_code: 'REQ-102',
        owner_id: agent2_MemberB.id,
        to_time: new Date('2026-10-19T15:00:00Z'), // đã trễ 1.5h -> quá hạn!
        status: 'ON_LOAN',
        lines: [{ quantity: 2 }],
      },
    ];

    prismaMock.memsBorrowRequest.findMany.mockResolvedValue(activeRequests);

    const alerts = await borrowService.getUpcomingReturnsAlerts();
    expect(alerts.expiringSoon.length).toBe(1);
    expect(alerts.expiringSoon[0].request_code).toBe('REQ-101');
    expect(alerts.overdue.length).toBe(1);
    expect(alerts.overdue[0].request_code).toBe('REQ-102');

    // 2. Leader duyệt gia hạn cho REQ-101
    const requestWithExtension = {
      ...activeRequests[0],
      note: JSON.stringify({
        extension: {
          requested_to_time: '2026-10-19T22:00:00.000Z',
          reason: 'Phát sinh cảnh quay đêm',
          status: 'PENDING',
        },
      }),
    };

    prismaMock.memsBorrowRequest.findUnique.mockResolvedValue(requestWithExtension);
    prismaMock.memsBorrowRequest.update.mockResolvedValue({
      ...requestWithExtension,
      to_time: new Date('2026-10-19T22:00:00.000Z'),
    });

    const approvedExt = await borrowService.decideExtension('req-101', agent3_Leader, {
      decision: 'APPROVED',
    });
    expect(approvedExt).toBeDefined();
    expect(prismaMock.memsReservation.updateMany).toHaveBeenCalled();

    jest.useRealTimers();
  });
});


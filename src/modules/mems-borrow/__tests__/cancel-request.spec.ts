import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BorrowRequestService } from '../borrow-request.service';

/**
 * Chức năng: huỷ một phiếu mượn chưa giao máy.
 *
 * Vì sao đáng một file test riêng: trước đây KHÔNG có đường nào huỷ phiếu. Người mượn đặt nhầm
 * ngày hoặc buổi quay bị dời thì phiếu nằm đó giữ chỗ cho tới lúc có người từ chối hộ — mà từ
 * chối là quyền của quản lý kho và mang nghĩa "không cho mượn", khác hẳn "tôi không cần nữa".
 * Hai trạng thái `DRAFT` và `CANCELLED` có sẵn trong enum nhưng chưa ai dùng tới.
 *
 * Điều quan trọng nhất ở đây là NHẢ GIỮ CHỖ: quên bước đó thì khoảng thời gian của phiếu đã huỷ
 * vẫn hiện là bận và không ai xin mượn được chiếc máy thực ra đang rảnh.
 */

const OWNER = { id: 'nguoi-muon', roles: ['MEMBER'], team: 'Team K1' };
const NGUOI_KHAC = { id: 'nguoi-khac', roles: ['MEMBER'], team: 'Team K1' };
const LEADER_MEDIA = { id: 'leader-media', roles: ['LEADER'], team: 'MEDIA' };
const LEADER_KHAC = { id: 'leader-k1', roles: ['LEADER'], team: 'Team K1' };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], team: null };

function buildDeps(over: Partial<any> = {}) {
  const request = {
    id: 'req-1',
    request_code: 'REQ-20260904-001',
    owner_id: OWNER.id,
    status: 'PENDING_APPROVAL',
    ...over,
  };
  const tx = {
    $executeRawUnsafe: jest.fn(async (..._args: any[]) => 1),
    memsBorrowRequest: {
      findUnique: jest.fn(async () => (over.missing ? null : request)),
      update: jest.fn(async ({ data }: any) => ({ ...request, ...data })),
    },
    memsReservation: { updateMany: jest.fn(async () => ({ count: 2 })) },
    memsRequestLine: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { prisma, tx };
}

const service = (prisma: any) => new BorrowRequestService(prisma, {} as any);

describe('BorrowRequestService.cancel — ai huỷ được', () => {
  it('người đứng tên huỷ được phiếu của mình khi còn chờ duyệt', async () => {
    const { prisma, tx } = buildDeps();
    const result = await service(prisma).cancel('req-1', OWNER);

    expect(result.status).toBe('CANCELLED');
    expect(tx.memsBorrowRequest.update).toHaveBeenCalled();
  });

  it('người khác KHÔNG huỷ được phiếu không phải của mình', async () => {
    const { prisma, tx } = buildDeps();

    await expect(service(prisma).cancel('req-1', NGUOI_KHAC)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
  });

  it('leader bộ phận khác cũng không huỷ được — kho là tài sản của Media', async () => {
    const { prisma } = buildDeps();

    await expect(service(prisma).cancel('req-1', LEADER_KHAC)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('quản lý kho và admin huỷ được phiếu của người khác', async () => {
    for (const actor of [LEADER_MEDIA, ADMIN]) {
      const { prisma } = buildDeps();
      const result = await service(prisma).cancel('req-1', actor);

      expect(result.status).toBe('CANCELLED');
    }
  });
});

describe('BorrowRequestService.cancel — huỷ được ở giai đoạn nào', () => {
  it('phiếu đã duyệt hoặc đang chuẩn bị thì quản lý kho vẫn huỷ được', async () => {
    for (const status of ['APPROVED', 'PREPARING']) {
      const { prisma } = buildDeps({ status });
      const result = await service(prisma).cancel('req-1', LEADER_MEDIA);

      expect(result.status).toBe('CANCELLED');
    }
  });

  it('người đứng tên chỉ huỷ được khi phiếu CHƯA duyệt', async () => {
    // Sau khi có chữ ký thì kho đã bắt đầu soạn hàng; rút lui phải qua người giữ kho.
    const { prisma } = buildDeps({ status: 'APPROVED' });

    await expect(service(prisma).cancel('req-1', OWNER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['ON_LOAN', 'PARTIALLY_RETURNED', 'CLOSED', 'REJECTED', 'CANCELLED'])(
    'phiếu ở trạng thái %s thì không huỷ được nữa',
    async (status) => {
      // Máy đã ra khỏi kho thì đường về duy nhất là màn Nhận trả. Cho huỷ ở đây là bỏ rơi những
      // chiếc đang nằm ngoài công ty mà không còn phiếu nào theo dõi chúng.
      const { prisma, tx } = buildDeps({ status });

      await expect(service(prisma).cancel('req-1', ADMIN)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    },
  );

  it('phiếu không tồn tại thì báo không tìm thấy', async () => {
    const { prisma } = buildDeps({ missing: true });

    await expect(service(prisma).cancel('req-la', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BorrowRequestService.cancel — dọn dẹp', () => {
  it('nhả giữ chỗ ngay trong cùng giao dịch', async () => {
    // Để sang lượt sau thì khoảng thời gian đó vẫn hiện là bận, người khác không xin được chiếc
    // máy thực ra đang rảnh — đúng lý do BR-32 bắt từ chối phải nhả ngay.
    const { prisma, tx } = buildDeps();
    await service(prisma).cancel('req-1', OWNER);

    expect(tx.memsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'RELEASED' } }),
    );
    expect(tx.memsRequestLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
  });

  it('khoá theo phiếu để không đua với người đang bấm Duyệt', async () => {
    const { prisma, tx } = buildDeps();
    await service(prisma).cancel('req-1', OWNER);

    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(String(tx.$executeRawUnsafe.mock.calls[0][1])).toContain('req-1');
  });
});

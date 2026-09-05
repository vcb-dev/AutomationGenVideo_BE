import { NotFoundException } from '@nestjs/common';
import { AssignmentService } from '../assignment.service';

/**
 * Chức năng: BR-25 — máy nào được phép gán cho một dòng phiếu, và xếp theo thứ tự nào.
 *
 * Vì sao đáng một file test riêng: đây là danh sách mà thủ kho nhìn vào để chọn máy, và nó lọc
 * HAI TẦNG. Bỏ tầng thứ hai thì kho gán nhầm chiếc đang chờ kiểm tra — nó rảnh lịch nhưng chưa ai
 * xác nhận nó dùng được. Còn thứ tự thì quyết định chiếc nào được chọn mặc định ở màn Bàn giao,
 * nên sai thứ tự là kho tự dồn vòng quay vào vài chiếc trong khi số còn lại nằm không.
 */

const LINE = {
  id: 'line-1',
  model_id: 'model-1',
  request: {
    from_time: new Date('2026-09-10T02:00:00Z'),
    to_time: new Date('2026-09-11T10:00:00Z'),
  },
};

const asset = (over: Partial<any>) => ({
  id: over.id,
  asset_code: over.asset_code ?? String(over.id).toUpperCase(),
  condition: over.condition ?? 'GOOD',
  ...over,
});

function buildDeps(over: { free?: any[]; loanCounts?: any[]; line?: any } = {}) {
  const freeAssets = jest.fn(async (_args: any) => over.free ?? []);
  const prisma: any = {
    memsRequestLine: {
      findUnique: jest.fn(async () => (over.line === null ? null : (over.line ?? LINE))),
    },
    memsHandoverLine: { groupBy: jest.fn(async () => over.loanCounts ?? []) },
  };
  const availability: any = { freeAssets };
  return { service: new AssignmentService(prisma, availability), freeAssets, prisma };
}

describe('AssignmentService.assignableUnits — tầng lọc', () => {
  it('hỏi máy rảnh đúng model và đúng khoảng thời gian của phiếu', async () => {
    const { service, freeAssets } = buildDeps();
    await service.assignableUnits('line-1');

    expect(freeAssets).toHaveBeenCalledWith({
      modelId: 'model-1',
      fromTime: LINE.request.from_time,
      toTime: LINE.request.to_time,
    });
  });

  it('loại máy chưa đạt tình trạng, dù nó rảnh lịch', async () => {
    // Rảnh lịch KHÔNG có nghĩa là dùng được: chiếc đang chờ kiểm tra chưa ai xác nhận nó lành.
    const { service } = buildDeps({
      free: [
        asset({ id: 'a1', condition: 'GOOD' }),
        asset({ id: 'a2', condition: 'NEEDS_CHECK' }),
        asset({ id: 'a3', condition: 'BROKEN' }),
        asset({ id: 'a4', condition: 'IN_MAINTENANCE' }),
        asset({ id: 'a5', condition: 'USED' }),
      ],
    });

    const rows = await service.assignableUnits('line-1');

    expect(rows.map((r: any) => r.id)).toEqual(['a1', 'a5']);
  });

  it('dòng phiếu không tồn tại thì báo không tìm thấy', async () => {
    const { service } = buildDeps({ line: null });

    await expect(service.assignableUnits('line-la')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AssignmentService.assignableUnits — thứ tự gợi ý', () => {
  it('máy tình trạng Tốt đứng trước máy Đã dùng', async () => {
    const { service } = buildDeps({
      free: [asset({ id: 'a1', condition: 'USED' }), asset({ id: 'a2', condition: 'GOOD' })],
    });

    const rows = await service.assignableUnits('line-1');

    expect(rows.map((r: any) => r.id)).toEqual(['a2', 'a1']);
  });

  it('cùng tình trạng thì máy ít vòng quay hơn đứng trước', async () => {
    // Để kho không tự dồn hết lượt mượn vào vài chiếc trong khi số còn lại nằm không.
    const { service } = buildDeps({
      free: [asset({ id: 'a1' }), asset({ id: 'a2' }), asset({ id: 'a3' })],
      loanCounts: [
        { asset_id: 'a1', _count: { asset_id: 9 } },
        { asset_id: 'a2', _count: { asset_id: 2 } },
      ],
    });

    const rows = await service.assignableUnits('line-1');

    // a3 chưa mượn lần nào (không có trong bảng đếm) nên phải đứng đầu.
    expect(rows.map((r: any) => r.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('tình trạng thắng số vòng quay khi hai tiêu chí xung đột', async () => {
    // Chiếc Tốt nhưng mượn nhiều vẫn phải đứng trước chiếc Đã dùng chưa mượn lần nào: thứ tự
    // ưu tiên là tình trạng TRƯỚC, cân bằng vòng quay chỉ để phá hoà.
    const { service } = buildDeps({
      free: [asset({ id: 'cu', condition: 'USED' }), asset({ id: 'tot', condition: 'GOOD' })],
      loanCounts: [{ asset_id: 'tot', _count: { asset_id: 50 } }],
    });

    const rows = await service.assignableUnits('line-1');

    expect(rows.map((r: any) => r.id)).toEqual(['tot', 'cu']);
  });

  it('hoà cả hai tiêu chí thì xếp theo mã máy cho ổn định', async () => {
    // Thứ tự không ổn định thì mỗi lần mở màn Bàn giao lại gợi ý một chiếc khác nhau.
    const { service } = buildDeps({
      free: [
        asset({ id: 'x', asset_code: 'CAM-009' }),
        asset({ id: 'y', asset_code: 'CAM-002' }),
      ],
    });

    const rows = await service.assignableUnits('line-1');

    expect(rows.map((r: any) => r.asset_code)).toEqual(['CAM-002', 'CAM-009']);
  });

  it('không còn máy nào đạt thì trả danh sách rỗng, không lỗi', async () => {
    const { service } = buildDeps({ free: [asset({ id: 'a1', condition: 'BROKEN' })] });

    expect(await service.assignableUnits('line-1')).toEqual([]);
  });
});

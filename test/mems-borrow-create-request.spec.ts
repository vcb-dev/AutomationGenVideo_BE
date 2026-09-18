import { BadRequestException } from '@nestjs/common';
import { BASE, buildCreateDeps, modelLocks, oneLine } from './support/mems-borrow-fixtures';

/**
 * Chức năng: tạo phiếu mượn — luồng chung trên màn "Tạo phiếu mượn".
 *
 * Nhìn từ phía NGƯỜI DÙNG KHÔNG BIẾT LUỒNG: khai thông tin, chọn thiết bị, gửi phiếu, kể cả khi
 * họ đặt ngày ngược, xin nhiều hơn số máy đang có, hay để trống những ô không bắt buộc.
 *
 * Hai chức năng tách riêng file theo quy chuẩn, xem:
 *   - test/mems-borrow-duplicate-model-lines.spec.ts — chặn khai trùng model
 *   - test/mems-borrow-default-department.spec.ts   — bộ phận mặc định
 */

describe('Tạo phiếu mượn — khai thông tin chung', () => {
  it('khai đủ và còn máy thì phiếu vào hàng chờ duyệt', async () => {
    const { service, created } = buildCreateDeps();

    const request = await service.create('user-1', oneLine());

    expect(request).toMatchObject({ id: 'req-1' });
    expect(created.request.status).toBe('PENDING_APPROVAL');
  });

  it('dự án và địa điểm được ghi nguyên văn vào phiếu', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.request.project).toBe('Quay TVC khách hàng ABC');
    expect(created.request.place).toBe('Studio A');
  });

  it('người gửi phiếu là người chịu trách nhiệm, không lấy từ dữ liệu client gửi', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-dang-nhap', oneLine());

    expect(created.request.owner_id).toBe('user-dang-nhap');
  });

  it('đặt thời điểm trả trước thời điểm nhận thì bị từ chối', async () => {
    const { service } = buildCreateDeps();

    await expect(
      service.create('user-1', { ...oneLine(), toTime: '2026-09-14T10:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đặt thời điểm trả TRÙNG thời điểm nhận cũng bị từ chối, mượn 0 phút là vô nghĩa', async () => {
    const { service } = buildCreateDeps();

    await expect(
      service.create('user-1', { ...oneLine(), toTime: BASE.fromTime }),
    ).rejects.toThrow(/Thời điểm trả phải sau/);
  });

  it('bỏ trống mục đích thì coi là việc công ty, phiếu vẫn một cấp duyệt', async () => {
    // Client cũ chưa gửi trường này. Mặc định sang PERSONAL sẽ khiến phiếu kẹt chờ chữ ký admin
    // mà người tạo không hiểu vì sao.
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.request.purpose).toBe('WORK');
  });

  it('chọn việc riêng thì giữ nguyên PERSONAL để sau còn bắt hai chữ ký', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', { ...oneLine(), purpose: 'PERSONAL' as const });

    expect(created.request.purpose).toBe('PERSONAL');
  });

  it('thời điểm nhận và trả được lưu đúng mốc đã chọn', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.request.from_time.toISOString()).toBe('2026-09-15T02:00:00.000Z');
    expect(created.request.to_time.toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });
});

describe('Tạo phiếu mượn — chọn thiết bị', () => {
  it('mượn một máy của một model thì sinh đúng một bản ghi giữ chỗ', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.lines).toHaveLength(1);
    expect(created.reservations).toHaveLength(1);
  });

  it('mượn nhiều máy cùng model thì mỗi máy MỘT bản ghi giữ chỗ', async () => {
    // Hàm khả dụng đếm số BẢN GHI giao nhau, không đọc cột số lượng — ghi gộp một bản ghi
    // quantity=3 thì kho tưởng chỉ có một chiếc đang bận.
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine('model-1', 3));

    expect(created.lines[0].quantity).toBe(3);
    expect(created.reservations).toHaveLength(3);
  });

  it('nhiều model khác nhau thì mỗi model một dòng, theo đúng thứ tự đã khai', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-1', quantity: 1 },
        { modelId: 'model-2', quantity: 2 },
      ],
    });

    expect(created.lines.map((l: any) => l.model_id)).toEqual(['model-1', 'model-2']);
    expect(created.reservations).toHaveLength(3);
  });

  it('ghi chú trên dòng được lưu lại', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine('model-1', 1, 'Cần kèm pin dự phòng'));

    expect(created.lines[0].note).toBe('Cần kèm pin dự phòng');
  });

  it('không ghi chú thì lưu null chứ không lưu undefined', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.lines[0].note).toBeNull();
  });
});

describe('Tạo phiếu mượn — kho còn hay hết máy', () => {
  it('đủ máy thì dòng ở trạng thái Đã giữ chỗ', async () => {
    const { service, created } = buildCreateDeps({ availableByModel: { 'model-1': 5 } });

    await service.create('user-1', oneLine('model-1', 2));

    expect(created.lines[0].status).toBe('RESERVED');
  });

  it('hết máy thì VẪN nhận phiếu, dòng chuyển sang Chờ hàng', async () => {
    // QĐ-08: chặn cứng thì người dùng quay lại mượn tay và hệ thống mất dấu cả chiếc máy.
    const { service, created } = buildCreateDeps({ availableByModel: { 'model-1': 0 } });

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.request.status).toBe('PENDING_APPROVAL');
    expect(created.lines[0].status).toBe('BACKORDERED');
  });

  it('dòng Chờ hàng thì KHÔNG giữ chỗ, để người khác còn mượn được', async () => {
    const { service, created } = buildCreateDeps({ availableByModel: { 'model-1': 0 } });

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.reservations).toHaveLength(0);
  });

  it('xin nhiều hơn số còn lại thì cả dòng là Chờ hàng, không giữ một phần', async () => {
    // Giữ một phần thì người dùng tưởng đã có 2 trong 3 máy, tới lúc bàn giao mới vỡ ra.
    const { service, created } = buildCreateDeps({ availableByModel: { 'model-1': 2 } });

    await service.create('user-1', oneLine('model-1', 3));

    expect(created.lines[0].status).toBe('BACKORDERED');
    expect(created.reservations).toHaveLength(0);
  });

  it('phiếu vừa có dòng đủ vừa có dòng thiếu thì mỗi dòng mang trạng thái riêng', async () => {
    const { service, created } = buildCreateDeps({
      availableByModel: { 'model-du': 5, 'model-thieu': 0 },
    });

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-du', quantity: 1 },
        { modelId: 'model-thieu', quantity: 1 },
      ],
    });

    expect(created.lines.map((l: any) => l.status)).toEqual(['RESERVED', 'BACKORDERED']);
    expect(created.reservations).toHaveLength(1);
  });

  it('bản ghi giữ chỗ mang buffer_to_time, không phải to_time', async () => {
    // Máy trả về còn phải kiểm tra trước khi cho mượn tiếp; bỏ buffer là xếp hai phiếu sát nhau.
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.reservations[0].buffer_to_time.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    expect(created.reservations[0].to_time.toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });

  it('bản ghi giữ chỗ ở trạng thái tạm, chưa phải đã chốt máy', async () => {
    const { service, created } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(created.reservations[0].status).toBe('TENTATIVE');
  });

  it('hỏi khả dụng bằng chính client của giao dịch, không phải kết nối đứng ngoài', async () => {
    const { service, tx, availability } = buildCreateDeps();

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-1', quantity: 1 },
        { modelId: 'model-2', quantity: 1 },
      ],
    });

    for (const call of availability.check.mock.calls) {
      expect(call[1]).toBe(tx);
    }
  });
});

describe('Tạo phiếu mượn — hai người tranh nhau chiếc máy cuối', () => {
  it('khoá từng model trước khi kiểm tra và giữ chỗ', async () => {
    const { service, lockKeys } = buildCreateDeps();

    await service.create('user-1', oneLine('model-1'));

    expect(modelLocks(lockKeys)).toContain('mems:model:model-1');
  });

  it('khoá model theo thứ tự đã SẮP, không theo thứ tự client gửi', async () => {
    // Phiếu A xin [b, a] và phiếu B xin [a, b] cùng lúc thì A giữ b đợi a, B giữ a đợi b —
    // Postgres phát hiện deadlock và giết một giao dịch, người dùng ăn 500 giữa lúc gửi phiếu.
    const { service, lockKeys } = buildCreateDeps();

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-b', quantity: 1 },
        { modelId: 'model-a', quantity: 1 },
      ],
    });

    expect(modelLocks(lockKeys)).toEqual(['mems:model:model-a', 'mems:model:model-b']);
  });

  it('cả phiếu nằm trong MỘT giao dịch, không tách kiểm tra ra ngoài', async () => {
    // Kiểm tra ngoài giao dịch rồi mới ghi giữ chỗ thì hai người cùng đọc "còn 1" rồi cùng ghi.
    const { service, prisma } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Tạo phiếu mượn — mã phiếu', () => {
  it('mã theo dạng REQ-YYYYMMDD-NNN tính theo ngày nhận máy', async () => {
    const { service, created } = buildCreateDeps({ requestsToday: 0 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-001');
  });

  it('số thứ tự chạy tiếp theo số phiếu đã có trong ngày', async () => {
    const { service, created } = buildCreateDeps({ requestsToday: 7 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-008');
  });

  it('số thứ tự đủ ba chữ số, phiếu thứ 100 không thành REQ-...-100 lệch dạng', async () => {
    const { service, created } = buildCreateDeps({ requestsToday: 99 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-100');
  });

  it('đếm phiếu trong đúng khoảng một ngày của thời điểm NHẬN', async () => {
    const { service, countArgs } = buildCreateDeps();

    await service.create('user-1', oneLine());

    expect(countArgs[0].where.from_time.gte.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(countArgs[0].where.from_time.lt.toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });
});

import { BadRequestException } from '@nestjs/common';
import { BorrowRequestService } from '../src/modules/mems-borrow/borrow-request.service';

/**
 * Toàn bộ thao tác của người dùng trên màn "Tạo phiếu mượn".
 *
 * Gom vào một file vì đứng từ phía người dùng thì đây là MỘT việc: khai thông tin, chọn thiết bị,
 * gửi phiếu. Tách theo từng luật nghiệp vụ sẽ khiến không ai đọc được "gửi phiếu thì chuyện gì
 * xảy ra" ở một chỗ.
 *
 * Mock mô phỏng đúng ranh giới thật của Postgres: chỉ client của giao dịch mới thấy bản ghi chưa
 * commit, nên nếu code hỏi khả dụng bằng một kết nối đứng ngoài thì test sẽ lộ ra ngay.
 */

const FROM = '2026-09-15T02:00:00Z';
const TO = '2026-09-16T10:00:00Z';

const BASE = {
  project: 'Quay TVC khách hàng ABC',
  place: 'Studio A',
  fromTime: FROM,
  toTime: TO,
};

const oneLine = (modelId = 'model-1', quantity = 1, note?: string) => ({
  ...BASE,
  lines: [{ modelId, quantity, ...(note !== undefined ? { note } : {}) }],
});

interface DepsOptions {
  /** Số máy khả dụng theo từng model; model không khai thì lấy `defaultAvailable`. */
  availableByModel?: Record<string, number>;
  defaultAvailable?: number;
  /** Bản ghi thành viên MEMS của người gửi phiếu; null nghĩa là chưa ai gán. */
  membership?: { department_id: string } | null;
  /** Cột team trên hồ sơ người dùng; undefined nghĩa là không có hồ sơ. */
  team?: string | null;
  /** Bộ phận khớp được với team. */
  matchedByTeam?: { id: string } | null;
  /** Các bộ phận đang bật trong hệ thống. */
  departments?: { id: string }[];
  /** Bộ phận mặc định đã tồn tại sẵn hay chưa. */
  fallbackDepartment?: { id: string } | null;
  /** Số phiếu đã có trong cùng ngày nhận, dùng cho số thứ tự của mã phiếu. */
  requestsToday?: number;
}

function buildDeps(options: DepsOptions = {}) {
  const {
    availableByModel = {},
    defaultAvailable = 10,
    membership = { department_id: 'dept-media' },
    team = 'MEDIA',
    matchedByTeam = null,
    departments = [],
    fallbackDepartment = null,
    requestsToday = 0,
  } = options;

  const created: any = { request: null, lines: [], reservations: [], departments: [] };
  const lockKeys: string[] = [];
  const countArgs: any[] = [];

  const tx: any = {
    $executeRawUnsafe: jest.fn(async (_sql: string, key: string) => {
      lockKeys.push(key);
      return 1;
    }),
    memsMember: { findFirst: jest.fn(async () => membership) },
    user: { findUnique: jest.fn(async () => (team === undefined ? null : { team })) },
    memsDepartment: {
      findFirst: jest.fn(async () => matchedByTeam),
      findMany: jest.fn(async () => departments),
      findUnique: jest.fn(async () => fallbackDepartment),
      create: jest.fn(async ({ data }: any) => {
        created.departments.push(data);
        return { id: 'dept-vua-tao', ...data };
      }),
    },
    memsBorrowRequest: {
      count: jest.fn(async (args: any) => {
        countArgs.push(args);
        return requestsToday;
      }),
      create: jest.fn(async ({ data }: any) => {
        created.request = data;
        return { id: 'req-1', ...data };
      }),
    },
    memsRequestLine: {
      create: jest.fn(async ({ data }: any) => {
        created.lines.push(data);
        return { id: `line-${created.lines.length}`, ...data };
      }),
    },
    memsReservation: {
      createMany: jest.fn(async ({ data }: any) => {
        created.reservations.push(...data);
        return { count: data.length };
      }),
    },
  };

  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

  const availability: any = {
    check: jest.fn(async (args: any, client?: any) => {
      // Kết nối ngoài giao dịch KHÔNG thấy bản ghi giữ chỗ chưa commit. Chỉ khi được truyền đúng
      // `tx` thì những dòng trước mới trừ vào số khả dụng.
      const seesUncommitted = client === tx;
      const held = seesUncommitted
        ? created.reservations.filter((r: any) => r.model_id === args.modelId).length
        : 0;
      const total = availableByModel[args.modelId] ?? defaultAvailable;
      const available = Math.max(0, total - held);
      return {
        available,
        enough: available >= args.quantity,
        shortBy: Math.max(0, args.quantity - available),
        bufferMinutes: 120,
        bufferedTo: new Date('2026-09-16T12:00:00Z'),
        busyByReservation: held,
        busyByMaintenance: 0,
      };
    }),
  };

  const service = new BorrowRequestService(prisma, availability);
  return { service, prisma, tx, availability, created, lockKeys, countArgs };
}

const modelLocks = (keys: string[]) => keys.filter((k) => k.startsWith('mems:model:'));

describe('Tạo phiếu mượn — khai thông tin chung', () => {
  it('khai đủ và còn máy thì phiếu vào hàng chờ duyệt', async () => {
    const { service, created } = buildDeps();

    const request = await service.create('user-1', oneLine());

    expect(request).toMatchObject({ id: 'req-1' });
    expect(created.request.status).toBe('PENDING_APPROVAL');
  });

  it('dự án và địa điểm được ghi nguyên văn vào phiếu', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.request.project).toBe('Quay TVC khách hàng ABC');
    expect(created.request.place).toBe('Studio A');
  });

  it('người gửi phiếu là người chịu trách nhiệm, không lấy từ dữ liệu client gửi', async () => {
    const { service, created } = buildDeps();

    await service.create('user-dang-nhap', oneLine());

    expect(created.request.owner_id).toBe('user-dang-nhap');
  });

  it('đặt thời điểm trả trước thời điểm nhận thì bị từ chối', async () => {
    const { service } = buildDeps();

    await expect(
      service.create('user-1', { ...oneLine(), toTime: '2026-09-14T10:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đặt thời điểm trả TRÙNG thời điểm nhận cũng bị từ chối, mượn 0 phút là vô nghĩa', async () => {
    const { service } = buildDeps();

    await expect(
      service.create('user-1', { ...oneLine(), toTime: FROM }),
    ).rejects.toThrow(/Thời điểm trả phải sau/);
  });

  it('bỏ trống mục đích thì coi là việc công ty, phiếu vẫn một cấp duyệt', async () => {
    // Client cũ chưa gửi trường này. Mặc định sang PERSONAL sẽ khiến phiếu kẹt chờ chữ ký admin
    // mà người tạo không hiểu vì sao.
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.request.purpose).toBe('WORK');
  });

  it('chọn việc riêng thì giữ nguyên PERSONAL để sau còn bắt hai chữ ký', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', { ...oneLine(), purpose: 'PERSONAL' as const });

    expect(created.request.purpose).toBe('PERSONAL');
  });

  it('thời điểm nhận và trả được lưu đúng mốc đã chọn', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.request.from_time.toISOString()).toBe('2026-09-15T02:00:00.000Z');
    expect(created.request.to_time.toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });
});

describe('Tạo phiếu mượn — chọn thiết bị', () => {
  it('mượn một máy của một model thì sinh đúng một bản ghi giữ chỗ', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.lines).toHaveLength(1);
    expect(created.reservations).toHaveLength(1);
  });

  it('mượn nhiều máy cùng model thì mỗi máy MỘT bản ghi giữ chỗ', async () => {
    // Hàm khả dụng đếm số BẢN GHI giao nhau, không đọc cột số lượng — ghi gộp một bản ghi
    // quantity=3 thì kho tưởng chỉ có một chiếc đang bận.
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine('model-1', 3));

    expect(created.lines[0].quantity).toBe(3);
    expect(created.reservations).toHaveLength(3);
  });

  it('nhiều model khác nhau thì mỗi model một dòng, theo đúng thứ tự đã khai', async () => {
    const { service, created } = buildDeps();

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
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine('model-1', 1, 'Cần kèm pin dự phòng'));

    expect(created.lines[0].note).toBe('Cần kèm pin dự phòng');
  });

  it('không ghi chú thì lưu null chứ không lưu undefined', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.lines[0].note).toBeNull();
  });

  it('khai cùng một model ở hai dòng thì từ chối phiếu', async () => {
    // Giao diện hỏi khả dụng theo TỪNG dòng nên ba dòng cùng model cùng báo "còn 1 máy", rồi
    // tóm tắt cộng thành 3 máy cho model chỉ có 1 chiếc.
    const { service } = buildDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('báo rõ phải tăng số lượng thay vì thêm dòng', async () => {
    const { service } = buildDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toThrow(/tăng số lượng/);
  });

  it('trùng ở dòng thứ ba cũng bị chặn, không chỉ hai dòng liền nhau', async () => {
    const { service } = buildDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-2', quantity: 1 },
          { modelId: 'model-1', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chặn trùng model TRƯỚC khi mở giao dịch, không có gì phải dọn ngược', async () => {
    const { service, prisma, created } = buildDeps();

    await expect(
      service.create('user-1', {
        ...BASE,
        lines: [
          { modelId: 'model-1', quantity: 1 },
          { modelId: 'model-1', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created.request).toBeNull();
    expect(created.lines).toHaveLength(0);
  });
});

describe('Tạo phiếu mượn — kho còn hay hết máy', () => {
  it('đủ máy thì dòng ở trạng thái Đã giữ chỗ', async () => {
    const { service, created } = buildDeps({ availableByModel: { 'model-1': 5 } });

    await service.create('user-1', oneLine('model-1', 2));

    expect(created.lines[0].status).toBe('RESERVED');
  });

  it('hết máy thì VẪN nhận phiếu, dòng chuyển sang Chờ hàng', async () => {
    // QĐ-08: chặn cứng thì người dùng quay lại mượn tay và hệ thống mất dấu cả chiếc máy.
    const { service, created } = buildDeps({ availableByModel: { 'model-1': 0 } });

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.request.status).toBe('PENDING_APPROVAL');
    expect(created.lines[0].status).toBe('BACKORDERED');
  });

  it('dòng Chờ hàng thì KHÔNG giữ chỗ, để người khác còn mượn được', async () => {
    const { service, created } = buildDeps({ availableByModel: { 'model-1': 0 } });

    await service.create('user-1', oneLine('model-1', 1));

    expect(created.reservations).toHaveLength(0);
  });

  it('xin nhiều hơn số còn lại thì cả dòng là Chờ hàng, không giữ một phần', async () => {
    // Giữ một phần thì người dùng tưởng đã có 2 trong 3 máy, tới lúc bàn giao mới vỡ ra.
    const { service, created } = buildDeps({ availableByModel: { 'model-1': 2 } });

    await service.create('user-1', oneLine('model-1', 3));

    expect(created.lines[0].status).toBe('BACKORDERED');
    expect(created.reservations).toHaveLength(0);
  });

  it('phiếu vừa có dòng đủ vừa có dòng thiếu thì mỗi dòng mang trạng thái riêng', async () => {
    const { service, created } = buildDeps({
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
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.reservations[0].buffer_to_time.toISOString()).toBe('2026-09-16T12:00:00.000Z');
    expect(created.reservations[0].to_time.toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });

  it('bản ghi giữ chỗ ở trạng thái tạm, chưa phải đã chốt máy', async () => {
    const { service, created } = buildDeps();

    await service.create('user-1', oneLine());

    expect(created.reservations[0].status).toBe('TENTATIVE');
  });

  it('hỏi khả dụng bằng chính client của giao dịch, không phải kết nối đứng ngoài', async () => {
    const { service, tx, availability } = buildDeps();

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

describe('Tạo phiếu mượn — bộ phận của người mượn', () => {
  it('đã được gán thành viên MEMS thì lấy bộ phận đó, nguồn chắc chắn nhất', async () => {
    const { service, created } = buildDeps({ membership: { department_id: 'dept-mems' } });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-mems');
  });

  it('chưa gán thành viên thì khớp team trên hồ sơ với mã hoặc tên bộ phận', async () => {
    const { service, created } = buildDeps({
      membership: null,
      team: 'MEDIA',
      matchedByTeam: { id: 'dept-khop-team' },
    });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-khop-team');
  });

  it('không khớp team nhưng cả hệ thống chỉ có một bộ phận thì dùng luôn nó', async () => {
    const { service, created } = buildDeps({
      membership: null,
      team: 'Team K2',
      matchedByTeam: null,
      departments: [{ id: 'dept-duy-nhat' }],
    });

    await service.create('user-1', oneLine());

    expect(created.request.department_id).toBe('dept-duy-nhat');
  });

  it('người chưa thuộc bộ phận nào vẫn tạo được phiếu, không còn bị chặn', async () => {
    // Đây là lỗi người dùng gặp: "Chưa xác định được bộ phận của bạn". Bộ phận trên phiếu chỉ để
    // quy trách nhiệm và hiển thị — không chặn hạn mức, không quyết định ai duyệt — nên chặn ở
    // đây là khoá người dùng khỏi việc họ vốn được phép làm.
    const { service } = buildDeps({
      membership: null,
      team: null,
      matchedByTeam: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await expect(service.create('user-moi', oneLine())).resolves.toMatchObject({ id: 'req-1' });
  });

  it('tra không ra bộ phận thì tạo bộ phận mặc định và gắn phiếu vào đó', async () => {
    const { service, created } = buildDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await service.create('user-moi', oneLine());

    expect(created.departments).toHaveLength(1);
    expect(created.departments[0].code).toBe('UNASSIGNED');
    expect(created.request.department_id).toBe('dept-vua-tao');
  });

  it('bộ phận mặc định đã có thì dùng lại, không tạo bản ghi trùng mã', async () => {
    const { service, created } = buildDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
      fallbackDepartment: { id: 'dept-mac-dinh-cu' },
    });

    await service.create('user-moi', oneLine());

    expect(created.departments).toHaveLength(0);
    expect(created.request.department_id).toBe('dept-mac-dinh-cu');
  });

  it('hệ thống chưa có bộ phận nào thì vẫn tạo được phiếu', async () => {
    const { service, created } = buildDeps({
      membership: null,
      team: null,
      departments: [],
    });

    await service.create('user-moi', oneLine());

    expect(created.request.department_id).toBe('dept-vua-tao');
  });

  it('client tự khai departmentId thì bị bỏ qua, vẫn suy từ người đăng nhập', async () => {
    // Nhận giá trị client gửi lên nghĩa là ai cũng gán phiếu của mình cho một bộ phận bất kỳ, và
    // khi máy hỏng thì trách nhiệm rơi sai chỗ.
    const { service, created } = buildDeps({ membership: { department_id: 'dept-that' } });

    await service.create('user-1', {
      ...oneLine(),
      departmentId: 'dept-client-tu-chon',
    } as any);

    expect(created.request.department_id).toBe('dept-that');
  });
});

describe('Tạo phiếu mượn — hai người tranh nhau chiếc máy cuối', () => {
  it('khoá từng model trước khi kiểm tra và giữ chỗ', async () => {
    const { service, lockKeys } = buildDeps();

    await service.create('user-1', oneLine('model-1'));

    expect(modelLocks(lockKeys)).toContain('mems:model:model-1');
  });

  it('khoá model theo thứ tự đã SẮP, không theo thứ tự client gửi', async () => {
    // Phiếu A xin [b, a] và phiếu B xin [a, b] cùng lúc thì A giữ b đợi a, B giữ a đợi b —
    // Postgres phát hiện deadlock và giết một giao dịch, người dùng ăn 500 giữa lúc gửi phiếu.
    const { service, lockKeys } = buildDeps();

    await service.create('user-1', {
      ...BASE,
      lines: [
        { modelId: 'model-b', quantity: 1 },
        { modelId: 'model-a', quantity: 1 },
      ],
    });

    expect(modelLocks(lockKeys)).toEqual(['mems:model:model-a', 'mems:model:model-b']);
  });

  it('lấy khoá bộ phận mặc định SAU khoá model, để mọi giao dịch đi cùng một chiều', async () => {
    const { service, lockKeys } = buildDeps({
      membership: null,
      team: null,
      departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
    });

    await service.create('user-moi', oneLine('model-1'));

    expect(lockKeys).toContain('mems:department:UNASSIGNED');
    expect(lockKeys.indexOf('mems:model:model-1')).toBeLessThan(
      lockKeys.indexOf('mems:department:UNASSIGNED'),
    );
  });

  it('tra ra được bộ phận thì không đụng tới khoá bộ phận mặc định', async () => {
    const { service, lockKeys } = buildDeps({ membership: { department_id: 'dept-mems' } });

    await service.create('user-1', oneLine());

    expect(lockKeys.some((k) => k.startsWith('mems:department:'))).toBe(false);
  });

  it('cả phiếu nằm trong MỘT giao dịch, không tách kiểm tra ra ngoài', async () => {
    // Kiểm tra ngoài giao dịch rồi mới ghi giữ chỗ thì hai người cùng đọc "còn 1" rồi cùng ghi.
    const { service, prisma } = buildDeps();

    await service.create('user-1', oneLine());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Tạo phiếu mượn — mã phiếu', () => {
  it('mã theo dạng REQ-YYYYMMDD-NNN tính theo ngày nhận máy', async () => {
    const { service, created } = buildDeps({ requestsToday: 0 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-001');
  });

  it('số thứ tự chạy tiếp theo số phiếu đã có trong ngày', async () => {
    const { service, created } = buildDeps({ requestsToday: 7 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-008');
  });

  it('số thứ tự đủ ba chữ số, phiếu thứ 100 không thành REQ-...-100 lệch dạng', async () => {
    const { service, created } = buildDeps({ requestsToday: 99 });

    await service.create('user-1', oneLine());

    expect(created.request.request_code).toBe('REQ-20260915-100');
  });

  it('đếm phiếu trong đúng khoảng một ngày của thời điểm NHẬN', async () => {
    const { service, countArgs } = buildDeps();

    await service.create('user-1', oneLine());

    expect(countArgs[0].where.from_time.gte.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(countArgs[0].where.from_time.lt.toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });
});

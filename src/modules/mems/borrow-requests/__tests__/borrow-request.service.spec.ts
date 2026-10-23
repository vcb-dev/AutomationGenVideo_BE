import { BorrowRequestService } from '../borrow-request.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Bộ giả lập dùng chung cho các describe về tạo phiếu bên dưới. */

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
  /** Cột team trên hồ sơ người dùng. */
  team?: string | null;
  /** Bộ phận khớp được với team. */
  matchedByTeam?: { id: string } | null;
  /** Các bộ phận đang bật trong hệ thống. */
  departments?: { id: string }[];
  /** Bộ phận mặc định đã tồn tại sẵn hay chưa. */
  fallbackDepartment?: { id: string } | null;
  /** Số phiếu đã có trong cùng ngày nhận, dùng cho số thứ tự của mã phiếu. */
  requestsToday?: number;
  /** ID ảnh mà người gửi đã tải lên và chưa gắn phiếu nào. */
  attachablePhotoIds?: string[];
}

/**
 * Mock mô phỏng đúng ranh giới thật của Postgres: chỉ client của giao dịch mới thấy bản ghi chưa
 * commit. Nhờ vậy nếu code hỏi khả dụng bằng một kết nối đứng ngoài thì test lộ ra ngay.
 */
function buildCreateDeps(options: DepsOptions = {}) {
  const {
    availableByModel = {},
    defaultAvailable = 10,
    membership = { department_id: 'dept-media' },
    team = 'MEDIA',
    matchedByTeam = null,
    departments = [],
    fallbackDepartment = null,
    requestsToday = 0,
    attachablePhotoIds = [],
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
    memsRequestPhoto: {
      updateMany: jest.fn(async ({ where }: any) => ({
        count: (where.id.in as string[]).filter((id) => attachablePhotoIds.includes(id)).length,
      })),
    },
  };

  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

  const availability: any = {
    check: jest.fn(async (args: any, client?: any) => {
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

describe('Tạo phiếu mượn', () => {
  /**
   * Chức năng: tạo phiếu mượn — luồng chung trên màn "Tạo phiếu mượn".
   *
   * Nhìn từ phía NGƯỜI DÙNG KHÔNG BIẾT LUỒNG: khai thông tin, chọn thiết bị, gửi phiếu, kể cả khi
   * họ đặt ngày ngược, xin nhiều hơn số máy đang có, hay để trống những ô không bắt buộc.
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

      await expect(service.create('user-1', { ...oneLine(), toTime: BASE.fromTime })).rejects.toThrow(
        /Thời điểm trả phải sau/,
      );
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
});

describe('Bộ phận mặc định', () => {
  /**
   * Chức năng: ai cũng tạo được phiếu mượn, kể cả người chưa được gán bộ phận nào trong MEMS.
   *
   * Lỗi người dùng gặp: gửi phiếu thì nhận về "Chưa xác định được bộ phận của bạn. Nhờ quản trị gán
   * bạn vào một bộ phận trong MEMS." — nghĩa là người mới vào công ty không mượn được máy cho tới
   * khi có quản trị gán tay.
   *
   * Bộ phận trên phiếu chỉ để QUY TRÁCH NHIỆM và hiển thị: `borrow_limit` chưa được dùng ở đâu
   * trong mã nguồn, còn duyệt phiếu thì xét vai trò LEADER/MANAGER/ADMIN ở controller chứ không xét
   * leader của bộ phận. Nên chặn ở đó là khoá người dùng khỏi việc họ vốn được phép làm.
   *
   * Thứ tự tra vẫn giữ nguyên, từ chắc chắn nhất tới suy đoán; chỉ thay bước ném lỗi cuối cùng bằng
   * bộ phận mặc định.
   */

  describe('Phiếu mượn — bộ phận mặc định cho người chưa được gán', () => {
    it('đã được gán thành viên MEMS thì lấy bộ phận đó, nguồn chắc chắn nhất', async () => {
      const { service, created } = buildCreateDeps({ membership: { department_id: 'dept-mems' } });

      await service.create('user-1', oneLine());

      expect(created.request.department_id).toBe('dept-mems');
    });

    it('chưa gán thành viên thì khớp team trên hồ sơ với mã hoặc tên bộ phận', async () => {
      const { service, created } = buildCreateDeps({
        membership: null,
        team: 'MEDIA',
        matchedByTeam: { id: 'dept-khop-team' },
      });

      await service.create('user-1', oneLine());

      expect(created.request.department_id).toBe('dept-khop-team');
    });

    it('không khớp team nhưng cả hệ thống chỉ có một bộ phận thì dùng luôn nó', async () => {
      const { service, created } = buildCreateDeps({
        membership: null,
        team: 'Team K2',
        matchedByTeam: null,
        departments: [{ id: 'dept-duy-nhat' }],
      });

      await service.create('user-1', oneLine());

      expect(created.request.department_id).toBe('dept-duy-nhat');
    });

    it('người chưa thuộc bộ phận nào vẫn tạo được phiếu, không còn bị chặn', async () => {
      const { service } = buildCreateDeps({
        membership: null,
        team: null,
        matchedByTeam: null,
        departments: [{ id: 'dept-1' }, { id: 'dept-2' }],
      });

      await expect(service.create('user-moi', oneLine())).resolves.toMatchObject({ id: 'req-1' });
    });

    it('tra không ra bộ phận thì tạo bộ phận mặc định và gắn phiếu vào đó', async () => {
      const { service, created } = buildCreateDeps({
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
      const { service, created } = buildCreateDeps({
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
      const { service, created } = buildCreateDeps({
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
      const { service, created } = buildCreateDeps({ membership: { department_id: 'dept-that' } });

      await service.create('user-1', {
        ...oneLine(),
        departmentId: 'dept-client-tu-chon',
      } as any);

      expect(created.request.department_id).toBe('dept-that');
    });

    it('lấy khoá bộ phận mặc định SAU khoá model, để mọi giao dịch đi cùng một chiều', async () => {
      // Không bắt lỗi trùng mã rồi đọc lại: trong một giao dịch Postgres, câu lệnh lỗi làm HỎNG cả
      // giao dịch, đọc lại chỉ nhận thêm "current transaction is aborted". Phải xếp hàng bằng khoá
      // tư vấn trước khi đọc.
      const { service, lockKeys } = buildCreateDeps({
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
      const { service, lockKeys } = buildCreateDeps({ membership: { department_id: 'dept-mems' } });

      await service.create('user-1', oneLine());

      expect(lockKeys.some((k) => k.startsWith('mems:department:'))).toBe(false);
    });
  });
});

describe('Chặn khai trùng model', () => {
  /**
   * Chức năng: một model chỉ được khai MỘT dòng trong phiếu mượn.
   *
   * Lỗi người dùng gặp: giao diện tính khả dụng theo TỪNG dòng, nên ba dòng cùng một model cùng
   * nhận về "còn 1 máy" — không dòng nào biết dòng trước đã nhận chiếc duy nhất đó — rồi cột tóm
   * tắt cộng thành 3 máy cho model chỉ có 1 chiếc.
   *
   * Dữ liệu không hỏng: dòng sau rơi vào Chờ hàng nhờ phép kiểm chạy trên chính client của giao
   * dịch. Nhưng phiếu mang những dòng chờ hàng mà kho không bao giờ đáp ứng được.
   */

  describe('Phiếu mượn — khai trùng model trong cùng một phiếu', () => {
    it('cùng một model ở hai dòng thì từ chối phiếu', async () => {
      const { service } = buildCreateDeps();

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
      const { service } = buildCreateDeps();

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
      const { service } = buildCreateDeps();

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

    it('chặn TRƯỚC khi mở giao dịch, không có gì phải dọn ngược', async () => {
      // Từ chối muộn thì phiếu đã sinh mã và đã có dòng, phải dọn ngược — chặn sớm thì không có gì
      // để dọn.
      const { service, prisma, created } = buildCreateDeps();

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

    it('các model khác nhau thì vẫn nhận bình thường', async () => {
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
  });
});

describe('Huỷ phiếu', () => {
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

      await expect(service(prisma).cancel('req-1', NGUOI_KHAC)).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.memsBorrowRequest.update).not.toHaveBeenCalled();
    });

    it('leader bộ phận khác cũng không huỷ được — kho là tài sản của Media', async () => {
      const { prisma } = buildDeps();

      await expect(service(prisma).cancel('req-1', LEADER_KHAC)).rejects.toBeInstanceOf(ForbiddenException);
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

        await expect(service(prisma).cancel('req-1', ADMIN)).rejects.toBeInstanceOf(ConflictException);
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
});

describe('Ghi chú và ảnh đính kèm khi tạo phiếu', () => {
  const PHOTO_A = '11111111-1111-4111-8111-111111111111';
  const PHOTO_B = '22222222-2222-4222-8222-222222222222';

  it('ghi chú lưu dạng chữ thường, đã cắt khoảng trắng', async () => {
    const { service, created } = buildCreateDeps();
    await service.create('user-1', { ...oneLine(), note: '  Cần thêm pin dự phòng  ' });
    expect(created.request.note).toBe('Cần thêm pin dự phòng');
  });

  it('không ghi chú thì lưu null', async () => {
    const { service, created } = buildCreateDeps();
    await service.create('user-1', oneLine());
    expect(created.request.note).toBeNull();
  });

  it('gắn ảnh vào phiếu vừa tạo, chỉ ảnh của chính người gửi và chưa gắn ở đâu', async () => {
    const { service, tx } = buildCreateDeps({ attachablePhotoIds: [PHOTO_A, PHOTO_B] });
    await service.create('user-1', { ...oneLine(), photoIds: [PHOTO_A, PHOTO_B] });
    expect(tx.memsRequestPhoto.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [PHOTO_A, PHOTO_B] }, uploaded_by: 'user-1', request_id: null },
      data: { request_id: 'req-1', incident_id: null },
    });
  });

  it('một ảnh không hợp lệ thì từ chối cả phiếu', async () => {
    const { service } = buildCreateDeps({ attachablePhotoIds: [PHOTO_A] });
    await expect(service.create('user-1', { ...oneLine(), photoIds: [PHOTO_A, PHOTO_B] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('gửi trùng ID thì chỉ tính một lần', async () => {
    const { service, tx } = buildCreateDeps({ attachablePhotoIds: [PHOTO_A] });
    await service.create('user-1', { ...oneLine(), photoIds: [PHOTO_A, PHOTO_A] });
    expect(tx.memsRequestPhoto.updateMany.mock.calls[0][0].where.id.in).toEqual([PHOTO_A]);
  });

  it('không gửi ảnh thì không đụng bảng ảnh', async () => {
    const { service, tx } = buildCreateDeps();
    await service.create('user-1', oneLine());
    expect(tx.memsRequestPhoto.updateMany).not.toHaveBeenCalled();
  });
});

describe('Khoá sinh mã phiếu theo ngày', () => {
  const DAY_LOCK = 'mems:request-code:20260915';

  it('khoá theo ngày nhận TRƯỚC khi đếm số phiếu trong ngày', async () => {
    const { service, tx, lockKeys } = buildCreateDeps();
    await service.create('user-1', oneLine());
    const lockIndex = lockKeys.indexOf(DAY_LOCK);
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[lockIndex]).toBeLessThan(
      tx.memsBorrowRequest.count.mock.invocationCallOrder[0],
    );
  });

  it('khoá mã phiếu đến SAU khoá model, cùng chiều với các luồng khác', async () => {
    const { service, lockKeys } = buildCreateDeps();
    await service.create('user-1', oneLine('model-1'));
    expect(lockKeys.indexOf('mems:model:model-1')).toBeLessThan(lockKeys.indexOf(DAY_LOCK));
  });
});

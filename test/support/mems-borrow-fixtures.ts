import { BorrowRequestService } from '../../src/modules/mems-borrow/borrow-request.service';

/**
 * Bộ giả lập dùng chung cho các file test của luồng tạo phiếu mượn.
 *
 * Nằm ngoài `*.spec.ts` nên jest không coi đây là bộ test (testRegex chỉ khớp `.spec.ts`), và
 * `tsconfig.build.json` vốn đã loại cả thư mục `test` nên nó không lọt vào `dist/`.
 *
 * Tách ra vì mỗi chức năng phải có file test riêng, mà cả ba file đều cần đúng một bộ giả lập:
 * chép ba bản là ba chỗ phải sửa mỗi khi service đổi chữ ký.
 */

export const FROM = '2026-09-15T02:00:00Z';
export const TO = '2026-09-16T10:00:00Z';

export const BASE = {
  project: 'Quay TVC khách hàng ABC',
  place: 'Studio A',
  fromTime: FROM,
  toTime: TO,
};

export const oneLine = (modelId = 'model-1', quantity = 1, note?: string) => ({
  ...BASE,
  lines: [{ modelId, quantity, ...(note !== undefined ? { note } : {}) }],
});

export interface DepsOptions {
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
}

/**
 * Mock mô phỏng đúng ranh giới thật của Postgres: chỉ client của giao dịch mới thấy bản ghi chưa
 * commit. Nhờ vậy nếu code hỏi khả dụng bằng một kết nối đứng ngoài thì test lộ ra ngay.
 */
export function buildCreateDeps(options: DepsOptions = {}) {
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

export const modelLocks = (keys: string[]) => keys.filter((k) => k.startsWith('mems:model:'));

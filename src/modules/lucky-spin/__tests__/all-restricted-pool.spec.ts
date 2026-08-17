import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';

/**
 * Khi danh sách chỉ còn toàn người bị hạn chế thì vẫn phải bốc ra người thắng.
 *
 * Cuối buổi sự kiện, người đã trúng bị chuyển sang INACTIVE nên pool teo dần; tới lúc chỉ còn hai
 * người trong REDUCED_ODDS_NAMES thì 99% số lượt cả hai đều trượt vòng tung 1%, mà lại không còn
 * người thường nào để lấp suất. Trước đây rơi vào nhánh đó là ném lỗi "Chỉ còn 0 mục hợp lệ" —
 * MC bấm quay mà bánh xe đứng im.
 *
 * Ý nghĩa của 1% là GIẢM cơ hội so với người khác. Không còn người khác thì không còn gì để giảm:
 * suất thắng phải chia đều trong số người hạn chế còn lại.
 */

const ACTOR = { id: 'u1', name: 'MC' };
const HIEU = 'Trần Trung Hiếu';
const TOAN = 'Nguyễn Văn Toán';

function buildService(memberNames: string[], randomSequence: number[]) {
  const members = memberNames.map((name, i) => ({
    id: `m${i}`,
    name,
    status: SpinEntryStatus.ACTIVE,
  }));

  const prisma: any = {
    spinWorkspace: {
      upsert: jest.fn(async () => ({ id: 'ws1' })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'ws1',
        controller_id: null,
        controller_name: null,
        control_expires_at: null,
      })),
      update: jest.fn(async () => ({})),
    },
    spinMember: { findMany: jest.fn(async () => members) },
    spinTeam: { findMany: jest.fn(async () => []) },
    spinRound: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'r1',
        started_at: new Date(),
        created_at: new Date(),
        ...data,
      })),
    },
  };

  const service = new LuckySpinService(prisma);
  // Dãy cố định thay cho nguồn ngẫu nhiên của vòng tung 1%; hết dãy thì trả 0.5 (trên ngưỡng).
  let i = 0;
  (service as any).nextUnitRandom = () => randomSequence[i++] ?? 0.5;
  return { service, prisma };
}

async function drawOnce(names: string[], randomSequence: number[], count = 1) {
  const { service, prisma } = buildService(names, randomSequence);
  await service.drawRound('seci', { kind: 'member', count } as any, ACTOR);
  return prisma.spinRound.create.mock.calls[0][0].data;
}

describe('LuckySpinService.drawRound — pool chỉ còn người bị hạn chế', () => {
  it('hai người hạn chế, cả hai đều trượt vòng tung 1% → vẫn bốc ra đúng một người', async () => {
    const { pool_names, winner_indexes } = await drawOnce([HIEU, TOAN], [0.9, 0.9]);

    expect(winner_indexes).toHaveLength(1);
    expect(pool_names[winner_indexes[0]]).toMatch(new RegExp(`${HIEU}|${TOAN}`));
  });

  it('bốc nhiều lần thì cả hai người đều có cơ hội, không dính chết ô đầu', async () => {
    // Bốc đều thật sự chứ không phải luôn trả index 0: 200 lượt mà một người không bao giờ ra
    // thì xác suất là 2^-200 — coi như không thể xảy ra ngẫu nhiên.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const { winner_indexes } = await drawOnce([HIEU, TOAN], [0.9, 0.9]);
      seen.add(winner_indexes[0]);
    }

    expect([...seen].sort()).toEqual([0, 1]);
  });

  it('bốc 2 người trong pool 2 người hạn chế → trúng cả hai, không trùng nhau', async () => {
    const { winner_indexes } = await drawOnce([HIEU, TOAN], [0.9, 0.9], 2);

    expect(new Set(winner_indexes).size).toBe(2);
  });

  it('người hạn chế trúng sẵn ở vòng tung 1% thì không bị bốc lại lần hai', async () => {
    // Lượt tung đầu cho Hiếu trúng (0.005 < 1%), lượt sau cho Toán trượt; bốc 2 suất nên suất
    // còn lại phải rơi vào Toán chứ không phải Hiếu lần nữa.
    const { winner_indexes } = await drawOnce([HIEU, TOAN], [0.005, 0.9], 2);

    expect(new Set(winner_indexes).size).toBe(2);
  });

  it('còn một người thường thì người đó vẫn được ưu tiên, suất dư mới tới người hạn chế', async () => {
    // 1 người thường + 2 người hạn chế, bốc 2: người thường chắc chắn có suất, suất còn lại chia
    // cho một trong hai người hạn chế.
    const { pool_names, winner_indexes } = await drawOnce([HIEU, 'Nguyễn Thị Lan', TOAN], [0.9, 0.9], 2);

    const names = winner_indexes.map((i: number) => pool_names[i]);
    expect(names).toContain('Nguyễn Thị Lan');
    expect(new Set(winner_indexes).size).toBe(2);
  });
});

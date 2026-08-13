import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';
import { REDUCED_ODDS_RATE, hasReducedOdds } from '../lucky-spin.constants';

/**
 * Hai người trong danh sách hạn chế không bị chặn hẳn nữa: mỗi lượt quay họ có đúng
 * REDUCED_ODDS_RATE cơ hội thắng, không phụ thuộc danh sách dài bao nhiêu.
 *
 * Cách làm: với mỗi người hạn chế, tung một lần ngẫu nhiên riêng. Trúng thì họ chiếm một suất
 * thắng; không trúng thì suất đó bốc đều trong số người thường. Nhờ vậy con số 1% là xác suất
 * THẬT của họ mỗi lượt — nếu chỉ giảm trọng số trong tập bốc chung thì với 50 người xác suất
 * thực tụt xuống còn khoảng 0,02%, khác hẳn ý ban tổ chức.
 */

const ACTOR = { id: 'u1', name: 'MC' };
const RESTRICTED = 'Trần Trung Hiếu';

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
  // Thay nguồn ngẫu nhiên bằng dãy cố định để test quyết định được kết quả.
  let i = 0;
  (service as any).nextUnitRandom = () => randomSequence[i++] ?? 0.5;
  return { service, prisma, members };
}

describe('hasReducedOdds', () => {
  it('nhận đúng người trong danh sách, không phân biệt dấu và hoa thường', () => {
    expect(hasReducedOdds('Trần Trung Hiếu')).toBe(true);
    expect(hasReducedOdds('TRAN TRUNG HIEU')).toBe(true);
    expect(hasReducedOdds('  tran   trung   hieu  ')).toBe(true);
  });

  it('người khác không bị hạn chế', () => {
    expect(hasReducedOdds('Nguyễn Thị Lan')).toBe(false);
  });

  it('tỷ lệ là 1%', () => {
    expect(REDUCED_ODDS_RATE).toBe(0.01);
  });
});

describe('LuckySpinService.drawRound — người bị hạn chế', () => {
  const POOL = [RESTRICTED, 'Nguyễn Thị Lan', 'Lê Văn Bình', 'Phạm Thu Hà'];

  it('tung ra số DƯỚI ngưỡng thì người hạn chế thắng', async () => {
    const { service, prisma } = buildService(POOL, [0.005]);
    await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);

    const { pool_names, winner_indexes } = prisma.spinRound.create.mock.calls[0][0].data;
    expect(pool_names[winner_indexes[0]]).toBe(RESTRICTED);
  });

  it('tung ra số TỪ ngưỡng trở lên thì người hạn chế không thắng', async () => {
    const { service, prisma } = buildService(POOL, [0.01, 0.3, 0.3, 0.3]);
    await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);

    const { pool_names, winner_indexes } = prisma.spinRound.create.mock.calls[0][0].data;
    expect(pool_names[winner_indexes[0]]).not.toBe(RESTRICTED);
  });

  it('người hạn chế vẫn nằm trên bánh xe dù không thắng', async () => {
    // Bánh xe phải hiện đủ tên như file nhân sự nhập vào — chỉ ô thắng mới bị chi phối.
    const { service, prisma } = buildService(POOL, [0.9, 0.3, 0.3, 0.3]);
    await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);

    const { pool_names } = prisma.spinRound.create.mock.calls[0][0].data;
    expect(pool_names).toContain(RESTRICTED);
    expect(pool_names).toHaveLength(POOL.length);
  });

  it('bốc nhiều người thì không ai trúng hai lần', async () => {
    const { service, prisma } = buildService(POOL, [0.005, 0.2, 0.5, 0.8]);
    await service.drawRound('seci', { kind: 'member', count: 3 } as any, ACTOR);

    const { winner_indexes } = prisma.spinRound.create.mock.calls[0][0].data;
    expect(new Set(winner_indexes).size).toBe(3);
  });

  it('vòng quay TEAM không áp hạn chế — pool là tên team, không phải tên người', async () => {
    // Cần ít nhất 2 mục mới quay được; đặt tên team trùng tên người bị hạn chế để chứng minh
    // vòng quay team KHÔNG áp danh sách đó.
    const members = [
      { id: 't0', name: RESTRICTED, status: SpinEntryStatus.ACTIVE },
      { id: 't1', name: 'Team B', status: SpinEntryStatus.ACTIVE },
    ];
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
      spinMember: { findMany: jest.fn(async () => []) },
      spinTeam: { findMany: jest.fn(async () => members) },
      spinRound: {
        create: jest.fn(async ({ data }: any) => ({ id: 'r1', started_at: new Date(), created_at: new Date(), ...data })),
      },
    };
    const service = new LuckySpinService(prisma);
    (service as any).nextUnitRandom = () => 0.9; // trên ngưỡng, nếu áp hạn chế thì sẽ trượt

    await service.drawRound('seci', { kind: 'team', count: 1 } as any, ACTOR);
    const { winner_indexes } = prisma.spinRound.create.mock.calls[0][0].data;
    expect(winner_indexes).toHaveLength(1);
  });
});

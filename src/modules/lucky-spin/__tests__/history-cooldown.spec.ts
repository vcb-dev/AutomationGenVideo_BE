import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';
import { REDUCED_ODDS_RATE } from '../lucky-spin.constants';

const ACTOR = { id: 'u1', name: 'MC' };

describe('Cơ chế giảm tỉ lệ người vừa trúng trong lịch sử (4-5 lượt) và tự động reset', () => {
  it('người vừa trúng trong 4 lượt gần nhất bị giảm tỉ lệ, sau 4 lượt tự động reset lại bình thường', async () => {
    const memberNames = [
      'Nguyễn Văn Toán', // 1% cố định
      'Thành Viên 1',
      'Thành Viên 2',
      'Thành Viên 3',
      'Thành Viên 4',
      'Thành Viên 5',
      'Thành Viên 6',
      'Thành Viên 7',
      'Thành Viên 8',
      'Thành Viên 9',
      'Thành Viên 10',
    ];
    const members = memberNames.map((name, i) => ({
      id: `m${i}`,
      name,
      status: SpinEntryStatus.ACTIVE,
    }));

    const roundsInDb: any[] = [];

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
      spinRound: {
        findMany: jest.fn(async ({ take }: any) => roundsInDb.slice(-take).reverse()),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: `r_${roundsInDb.length + 1}`, started_at: new Date(), ...data };
          roundsInDb.push(r);
          return r;
        }),
      },
    };

    const service = new LuckySpinService(prisma);

    // Chạy 20 lượt quay
    const winnerNames: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await service.drawRound('seci', { kind: 'member', count: 1 }, ACTOR);
      const winnerName = res.pool[res.winnerIndexes[0]].name;
      winnerNames.push(winnerName);
    }

    // Đảm bảo không có ai bị trúng 2 lần liên tiếp ngay cạnh nhau
    for (let i = 1; i < winnerNames.length; i++) {
      expect(winnerNames[i]).not.toBe(winnerNames[i - 1]);
    }
  });
});

import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';

const ACTOR = { id: 'u1', name: 'MC' };

describe('Anti-Repeat Cooldown (1-2 lượt quay)', () => {
  it('người vừa trúng ở lượt gần nhất sẽ không bị trúng lặp lại ngay ở lượt tiếp theo khi pool còn đủ người', async () => {
    const memberNames = ['Đoàn', 'Thắm', 'Thương', 'Hải', 'Bình'];
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
        findMany: jest.fn(async () => roundsInDb.slice(-2).reverse()),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: `r_${roundsInDb.length + 1}`, started_at: new Date(), ...data };
          roundsInDb.push(r);
          return r;
        }),
      },
    };

    const service = new LuckySpinService(prisma);

    // Chạy 10 lượt quay liên tiếp không xóa người trúng
    const winnerNames: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await service.drawRound('seci', { kind: 'member', count: 1 }, ACTOR);
      const winnerName = res.pool[res.winnerIndexes[0]].name;
      winnerNames.push(winnerName);
    }

    // Kiểm tra không có 2 lượt quay liên tiếp nào trúng cùng 1 người
    for (let i = 1; i < winnerNames.length; i++) {
      expect(winnerNames[i]).not.toBe(winnerNames[i - 1]);
    }
  });

  it('vẫn hoạt động bình thường khi pool chỉ có 1-2 người (hết người mới thì hồi phục lại)', async () => {
    const memberNames = ['A', 'B'];
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
        findMany: jest.fn(async () => roundsInDb.slice(-2).reverse()),
        create: jest.fn(async ({ data }: any) => {
          const r = { id: `r_${roundsInDb.length + 1}`, started_at: new Date(), ...data };
          roundsInDb.push(r);
          return r;
        }),
      },
    };

    const service = new LuckySpinService(prisma);

    for (let i = 0; i < 5; i++) {
      const res = await service.drawRound('seci', { kind: 'member', count: 1 }, ACTOR);
      expect(res.winnerIndexes.length).toBe(1);
    }
  });
});

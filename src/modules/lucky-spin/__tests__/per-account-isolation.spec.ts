import { NotFoundException } from '@nestjs/common';
import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';

/**
 * Mỗi tài khoản một vòng quay riêng — dữ liệu không lọt từ người này sang người kia.
 *
 * Trước đây cả công ty dùng chung một vòng quay: ai nhập Excel là đè lên danh sách của người
 * trước. Từ nay `spin_workspaces` khoá theo cặp (slug, owner_id), nên tài khoản nào mở cũng chỉ
 * thấy dữ liệu của chính mình.
 *
 * Dùng Prisma giả trong bộ nhớ thay vì mock từng lời gọi: phép kiểm ở đây là "dữ liệu của A có
 * lọt sang B không", mà câu đó chỉ trả lời được khi hai tài khoản cùng ghi vào một kho dùng
 * chung rồi đọc chéo nhau.
 */

const A = { id: 'user-a', name: 'Tài khoản A' };
const B = { id: 'user-b', name: 'Tài khoản B' };

type Row = Record<string, any>;

/** So một dòng với mệnh đề where, đủ dùng cho các truy vấn của service. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gt' in cond) return row[key] > cond.gt;
      if ('gte' in cond) return row[key] >= cond.gte;
      if ('not' in cond) return row[key] !== cond.not;
      return true;
    }
    return row[key] === cond;
  });
}

function createFakePrisma() {
  const store: Record<string, Row[]> = {
    workspaces: [],
    teams: [],
    members: [],
    gifts: [],
    memberWins: [],
    teamWins: [],
    giftAwards: [],
    rounds: [],
  };

  let seq = 0;
  const nextId = () => `id-${++seq}`;

  const table = (key: string) => ({
    create: async ({ data }: any) => {
      const row: Row = {
        id: nextId(),
        created_at: new Date(),
        updated_at: new Date(),
        started_at: new Date(),
        settled_at: null,
        status: SpinEntryStatus.ACTIVE,
        gift_received: false,
        ...data,
      };
      store[key].push(row);
      return row;
    },
    findMany: async ({ where = {} }: any = {}) => store[key].filter((r) => matches(r, where)),
    findFirst: async ({ where = {} }: any = {}) => store[key].find((r) => matches(r, where)) ?? null,
    count: async ({ where = {} }: any = {}) => store[key].filter((r) => matches(r, where)).length,
    update: async ({ where, data }: any) => {
      const row = store[key].find((r) => r.id === where.id);
      if (!row) throw new Error(`Không có dòng ${where.id} trong ${key}`);
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = store[key].findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error(`Không có dòng ${where.id} trong ${key}`);
      return store[key].splice(i, 1)[0];
    },
  });

  const prisma: any = {
    spinWorkspace: {
      ...table('workspaces'),
      upsert: async ({ where, create }: any) => {
        // Chốt chặn của cả bộ test: khoá phải là CẶP (slug, owner_id). Khoá theo mỗi slug nghĩa
        // là mọi tài khoản chung một vòng quay — đúng cái bug đang sửa, nên báo lỗi thẳng thay
        // vì lặng lẽ trả về vòng quay dùng chung và làm test xanh giả.
        const key = where.slug_owner_id;
        if (!key?.owner_id) {
          throw new Error(
            'spinWorkspace.upsert phải khoá theo cặp (slug, owner_id); đang khoá theo ' +
              JSON.stringify(where),
          );
        }
        const found = store.workspaces.find((r) => r.slug === key.slug && r.owner_id === key.owner_id);
        if (found) return found;
        const row: Row = {
          id: nextId(),
          controller_id: null,
          controller_name: null,
          control_expires_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          ...create,
        };
        store.workspaces.push(row);
        return row;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const row = store.workspaces.find((r) => r.id === where.id);
        if (!row) throw new Error(`Không có vòng quay ${where.id}`);
        return row;
      },
    },
    spinTeam: table('teams'),
    spinMember: table('members'),
    spinGift: table('gifts'),
    spinMemberWin: table('memberWins'),
    spinTeamWin: table('teamWins'),
    spinGiftAward: table('giftAwards'),
    spinRound: table('rounds'),
    // Chạy thẳng trên chính kho này: phép kiểm ở đây là cách ly dữ liệu, không phải tính nguyên
    // tử của giao dịch — giả lập rollback chỉ làm test khó đọc mà không kiểm thêm được gì.
    $transaction: async (fn: any) => fn(prisma),
  };

  return { prisma, store };
}

function buildService() {
  const { prisma, store } = createFakePrisma();
  return { service: new LuckySpinService(prisma), store };
}

describe('LuckySpinService — cách ly theo tài khoản', () => {
  it('hai tài khoản cùng mở một slug thì sinh ra hai vòng quay khác nhau', async () => {
    const { service, store } = buildService();

    await service.getState('seci', A.id);
    await service.getState('seci', B.id);

    expect(store.workspaces).toHaveLength(2);
    expect(store.workspaces.map((w) => w.owner_id).sort()).toEqual([A.id, B.id]);
  });

  it('cùng một tài khoản mở lại lần hai vẫn là vòng quay cũ, không tạo thêm', async () => {
    const { service, store } = buildService();

    await service.getState('seci', A.id);
    await service.getState('seci', A.id);
    await service.getState('tridao', A.id);

    // 2 dòng: seci của A và tridao của A — mở lại seci không đẻ thêm dòng nào.
    expect(store.workspaces).toHaveLength(2);
  });

  it('thành viên tài khoản A tạo không lọt sang state của tài khoản B', async () => {
    const { service } = buildService();

    const team = await service.createTeam('seci', { name: 'Team A' } as any, A);
    await service.createMember('seci', { name: 'Nhân sự của A', teamId: team.id } as any, A);

    const stateA = await service.getState('seci', A.id);
    const stateB = await service.getState('seci', B.id);

    expect(stateA.members.map((m) => m.name)).toEqual(['Nhân sự của A']);
    expect(stateB.members).toEqual([]);
    expect(stateB.teams).toEqual([]);
  });

  it('tài khoản B không xoá được team của tài khoản A dù biết đúng id', async () => {
    // Chỗ chặn thật sự nằm ở assertTeamInWorkspace: bỏ sót owner ở đó là ai cũng xoá được dữ
    // liệu của người khác chỉ bằng cách đoán id.
    const { service } = buildService();
    const team = await service.createTeam('seci', { name: 'Team A' } as any, A);

    await expect(service.deleteTeam('seci', team.id, B)).rejects.toThrow(NotFoundException);

    const stateA = await service.getState('seci', A.id);
    expect(stateA.teams.map((t) => t.name)).toEqual(['Team A']);
  });

  it('lượt quay đang chạy của A không hiện trên màn hình của B', async () => {
    const { service } = buildService();
    const team = await service.createTeam('seci', { name: 'Team A' } as any, A);
    await service.createMember('seci', { name: 'Người 1', teamId: team.id } as any, A);
    await service.createMember('seci', { name: 'Người 2', teamId: team.id } as any, A);

    await service.drawRound('seci', { kind: 'member', count: 1 } as any, A);

    const stateA = await service.getState('seci', A.id);
    const stateB = await service.getState('seci', B.id);

    expect(stateA.activeRound).not.toBeNull();
    expect(stateB.activeRound).toBeNull();
  });

  it('lịch sử trúng thưởng đếm riêng theo từng tài khoản', async () => {
    const { service } = buildService();
    const team = await service.createTeam('seci', { name: 'Team A' } as any, A);
    const member = await service.createMember('seci', { name: 'Người 1', teamId: team.id } as any, A);

    await service.recordMemberWin('seci', { memberId: member.id } as any, A);

    const stateA = await service.getState('seci', A.id);
    const stateB = await service.getState('seci', B.id);

    expect(stateA.historyCounts.members).toBe(1);
    expect(stateB.historyCounts.members).toBe(0);
    expect(stateB.history).toEqual([]);
  });
});

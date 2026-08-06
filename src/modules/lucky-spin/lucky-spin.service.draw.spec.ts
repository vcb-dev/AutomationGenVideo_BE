import { BadRequestException } from '@nestjs/common';
import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from './lucky-spin.service';
import { laTenKhongDuocTrung } from './lucky-spin.constants';

/**
 * Ban tổ chức yêu cầu hai cái tên không bao giờ được bốc trúng ở vòng quay cá nhân.
 *
 * Họ vẫn phải hiện đủ trên bánh xe (danh sách nhân sự nhập từ Excel là gì thì bánh xe hiện
 * đúng như vậy), chỉ có ô thắng là không bao giờ rơi vào họ. Vì thế test này không kiểm tra
 * `pool` mà kiểm tra `winnerIndexes` — chỗ duy nhất quyết định ai trúng.
 */

const ACTOR = { id: 'u1', name: 'MC' };

function buildService(memberNames: string[]) {
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
    spinGift: { findMany: jest.fn(async () => []) },
    spinRound: {
      create: jest.fn(async ({ data }: any) => ({ id: 'r1', started_at: new Date(), ...data })),
    },
  };

  return new LuckySpinService(prisma);
}

describe('laTenKhongDuocTrung', () => {
  it.each([
    'Trần Trung Hiếu',
    'trần trung hiếu',
    'TRẦN TRUNG HIẾU',
    '  Trần   Trung  Hiếu ',
    'Nguyễn Văn Toán',
    'nguyễn văn toán',
    'NGUYỄN VĂN TOÁN',
  ])('chặn "%s"', (ten) => {
    expect(laTenKhongDuocTrung(ten)).toBe(true);
  });

  it('chặn cả tên gõ ở dạng Unicode tổ hợp (NFD) — Excel hay xuất kiểu này', () => {
    expect(laTenKhongDuocTrung('Trần Trung Hiếu'.normalize('NFD'))).toBe(true);
  });

  it.each([
    'Nguyễn Văn Toàn',
    'Trần Trung Hiền',
    'Trần Trung Hiếu Anh',
    'Nguyễn Văn Toán Em',
    '',
  ])('không đụng tới "%s"', (ten) => {
    expect(laTenKhongDuocTrung(ten)).toBe(false);
  });
});

describe('LuckySpinService.drawRound — người bị chặn', () => {
  it('không bao giờ trúng, dù bánh xe vẫn hiện đủ tên', async () => {
    const names = ['An', 'Trần Trung Hiếu', 'Bình', 'Nguyễn Văn Toán', 'Cường'];
    const service = buildService(names);

    const daTrung = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);
      expect(round.pool.map((p) => p.name)).toEqual(names);
      round.winnerIndexes.forEach((idx) => daTrung.add(round.pool[idx].name));
    }

    expect([...daTrung].sort()).toEqual(['An', 'Bình', 'Cường']);
  });

  it('bốc nhiều người một lượt cũng không lọt người bị chặn', async () => {
    const service = buildService(['An', 'Trần Trung Hiếu', 'Bình', 'Nguyễn Văn Toán', 'Cường']);

    for (let i = 0; i < 100; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 3 } as any, ACTOR);
      const tenTrung = round.winnerIndexes.map((idx) => round.pool[idx].name);
      expect(tenTrung).toHaveLength(3);
      expect(tenTrung).not.toContain('Trần Trung Hiếu');
      expect(tenTrung).not.toContain('Nguyễn Văn Toán');
    }
  });

  it('báo lỗi thay vì để người bị chặn trúng khi không đủ người hợp lệ', async () => {
    const service = buildService(['An', 'Trần Trung Hiếu', 'Nguyễn Văn Toán']);

    await expect(service.drawRound('seci', { kind: 'member', count: 2 } as any, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('vòng quay team không bị ảnh hưởng — pool là tên team, không phải tên người', async () => {
    const service = buildService([]);
    (service as any).prisma.spinTeam.findMany = jest.fn(async () => [
      { id: 't1', name: 'Trần Trung Hiếu' },
      { id: 't2', name: 'Team B' },
    ]);

    const daTrung = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const round = await service.drawRound('seci', { kind: 'team', count: 1 } as any, ACTOR);
      round.winnerIndexes.forEach((idx) => daTrung.add(round.pool[idx].name));
    }

    expect([...daTrung].sort()).toEqual(['Team B', 'Trần Trung Hiếu']);
  });
});

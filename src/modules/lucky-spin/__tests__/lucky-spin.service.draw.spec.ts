import { BadRequestException } from '@nestjs/common';
import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';
import { laTenKhongDuocTrung } from '../lucky-spin.constants';

/**
 * Ban tổ chức yêu cầu hai cái tên không bao giờ được bốc trúng ở vòng quay cá nhân.
 *
 * Họ vẫn phải hiện đủ trên bánh xe (danh sách nhân sự nhập từ Excel là gì thì bánh xe hiện
 * đúng như vậy), chỉ có ô thắng là không bao giờ rơi vào họ. Vì thế test này không kiểm tra
 * `pool` mà kiểm tra `winnerIndexes` — chỗ duy nhất quyết định ai trúng.
 *
 * TẠM TẮT (07/08/2026): danh sách chặn trong lucky-spin.constants.ts đã được comment lại theo
 * yêu cầu, nên toàn bộ test ở đây `.skip`. BẬT LẠI: bỏ comment hai dòng tên trong
 * TEN_KHONG_DUOC_TRUNG rồi bỏ `.skip` ở hai `describe` bên dưới. Giữ nguyên phần thân test —
 * không sửa gì thêm là chạy lại được ngay.
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

describe.skip('laTenKhongDuocTrung', () => {
  it.each([
    // có dấu
    'Trần Trung Hiếu',
    'trần trung hiếu',
    'TRẦN TRUNG HIẾU',
    'TrầN tRuNg HiẾu',
    '  Trần   Trung  Hiếu ',
    'Nguyễn Văn Toán',
    'nguyễn văn toán',
    'NGUYỄN VĂN TOÁN',
    // không dấu — file nhân sự nhiều nơi xuất kiểu này
    'Tran Trung Hieu',
    'tran trung hieu',
    'TRAN TRUNG HIEU',
    '  TRAN   trung Hieu  ',
    'Nguyen Van Toan',
    'nguyen van toan',
    'NGUYEN VAN TOAN',
  ])('chặn "%s"', (ten) => {
    expect(laTenKhongDuocTrung(ten)).toBe(true);
  });

  it('chặn cả tên gõ ở dạng Unicode tổ hợp (NFD) — Excel hay xuất kiểu này', () => {
    expect(laTenKhongDuocTrung('Trần Trung Hiếu'.normalize('NFD'))).toBe(true);
  });

  /*
   * Hệ quả đã biết của việc bỏ dấu, ban tổ chức chấp nhận: mọi cách bỏ dấu ra cùng một chuỗi
   * đều bị chặn. "Nguyễn Văn Toàn" là tên khác nhưng bỏ dấu cũng thành "nguyen van toan".
   */
  it.each(['Nguyễn Văn Toàn', 'Nguyễn Văn Toản', 'Trần Trung Hiệu', 'Trần Trung Hiều'])(
    'chặn luôn "%s" — bỏ dấu ra cùng chuỗi',
    (ten) => {
      expect(laTenKhongDuocTrung(ten)).toBe(true);
    },
  );

  it.each([
    'Trần Trung Hiền',
    'Trần Trung Hiếu Anh',
    'Nguyễn Văn Toán Em',
    'Trần Trung',
    'Nguyễn Văn Toa',
    '',
  ])('không đụng tới "%s"', (ten) => {
    expect(laTenKhongDuocTrung(ten)).toBe(false);
  });
});

describe.skip('LuckySpinService.drawRound — người bị chặn', () => {
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

  /*
   * File nhân sự mỗi phòng xuất một kiểu viết. Tầng hàm thuần đã phủ các biến thể rồi, nhưng
   * phủ thêm ở đây mới chứng minh `drawRound` thực sự gọi qua bộ chuẩn hoá — chứ không phải so
   * chuỗi thô ở đâu đó trên đường đi.
   */
  it.each([
    ['không dấu, IN HOA', 'TRAN TRUNG HIEU'],
    ['không dấu, in thường', 'tran trung hieu'],
    ['không dấu, Viết Hoa Đầu', 'Tran Trung Hieu'],
    ['không dấu, IN HOA', 'NGUYEN VAN TOAN'],
    ['không dấu, in thường', 'nguyen van toan'],
    ['có dấu, IN HOA', 'NGUYỄN VĂN TOÁN'],
    ['có dấu, in thường', 'trần trung hiếu'],
    ['có dấu, hoa thường lẫn lộn', 'TrầN tRuNg HiẾu'],
    ['thừa khoảng trắng', '  Nguyen   Van  Toan  '],
  ])('%s: "%s" nằm trong pool nhưng không bao giờ trúng', async (_kieu: string, tenBiChan: string) => {
    const names = ['An', tenBiChan, 'Bình'];
    const service = buildService(names);

    const daTrung = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);
      expect(round.pool.map((p) => p.name)).toEqual(names);
      round.winnerIndexes.forEach((idx) => daTrung.add(round.pool[idx].name));
    }

    expect([...daTrung].sort()).toEqual(['An', 'Bình']);
  });

  it('pool trộn đủ kiểu viết của cả hai người vẫn không lọt ai', async () => {
    const names = [
      'An',
      'TRAN TRUNG HIEU',
      'Bình',
      'nguyen van toan',
      'Cường',
      'trần trung hiếu',
      'Dũng',
      'NGUYỄN VĂN TOÁN',
    ];
    const service = buildService(names);

    const daTrung = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 4 } as any, ACTOR);
      expect(round.winnerIndexes).toHaveLength(4);
      round.winnerIndexes.forEach((idx) => daTrung.add(round.pool[idx].name));
    }

    expect([...daTrung].sort()).toEqual(['An', 'Bình', 'Cường', 'Dũng']);
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

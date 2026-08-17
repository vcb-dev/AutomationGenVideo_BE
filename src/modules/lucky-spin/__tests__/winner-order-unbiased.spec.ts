import { SpinEntryStatus } from '@prisma/client';
import { LuckySpinService } from '../lucky-spin.service';
import { REDUCED_ODDS_NAMES } from '../lucky-spin.constants';

/**
 * Thứ tự trong winnerIndexes phải ngẫu nhiên, kể cả với người trong REDUCED_ODDS_NAMES.
 *
 * Vì sao thứ tự là chuyện đáng test chứ không phải chi tiết vặt: FE tiết lộ người trúng lần
 * lượt theo đúng thứ tự mảng này (`winnerIndexes.slice(0, revealed)` trong MemberSpinTab), nên
 * thứ tự chính là trình tự xướng tên trước hội trường. Bản đầu chạy vòng tung cho người hạn
 * chế TRƯỚC rồi mới bốc người thường, đo trên 200.000 lượt bốc 3 người thì 99,5% số lần họ
 * trúng là đứng ngay vị trí đầu. Ai ngồi xem vài lượt cũng nhận ra quy luật — mà mức 1% sinh
 * ra chính là để trông tự nhiên, lộ quy luật thì thà chặn hẳn cho xong.
 *
 * Ép nextUnitRandom trả 0 để người hạn chế LUÔN thắng: nếu để 1% thật thì phải quay vài trăm
 * nghìn lượt mới đủ mẫu, test sẽ chậm vô ích. Việc cần đo ở đây là THỨ TỰ, không phải tỉ lệ —
 * tỉ lệ đã có reduced-odds.spec.ts lo.
 */

const ACTOR = { id: 'u1', name: 'MC' };
const [FIRST_RESTRICTED, SECOND_RESTRICTED] = REDUCED_ODDS_NAMES;
const NAMES = ['An', FIRST_RESTRICTED, 'Bình', SECOND_RESTRICTED, 'Cúc', 'Dũng', 'Em'];

function buildService() {
  const members = NAMES.map((name, i) => ({ id: `m${i}`, name, status: SpinEntryStatus.ACTIVE }));
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

  const service = new LuckySpinService(prisma);
  // Mọi lần tung đều dưới REDUCED_ODDS_RATE → cả hai người hạn chế chắc chắn thắng.
  (service as any).nextUnitRandom = () => 0;
  return service;
}

const LAN = 3000;

describe('thứ tự người trúng trong một lượt bốc nhiều người', () => {
  it('người bị hạn chế rơi đều vào cả ba vị trí, không dồn về vị trí đầu', async () => {
    const service = buildService();
    const demViTri = [0, 0, 0];

    for (let i = 0; i < LAN; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 3 } as any, ACTOR);
      const viTri = round.winnerIndexes.findIndex((idx) => round.pool[idx].name === FIRST_RESTRICTED);
      expect(viTri).toBeGreaterThanOrEqual(0);
      demViTri[viTri]++;
    }

    // Kỳ vọng mỗi vị trí 1/3 (1.000 lượt). Ngưỡng 20% rộng rãi để không đỏ vì may rủi:
    // lệch tới mức đó cần sai lệch hàng chục lần độ lệch chuẩn.
    demViTri.forEach((soLan) => {
      expect(soLan / LAN).toBeGreaterThan(0.2);
      expect(soLan / LAN).toBeLessThan(0.47);
    });
  });

  it('trộn thứ tự không làm đổi TẬP người trúng', async () => {
    const service = buildService();

    for (let i = 0; i < 200; i++) {
      const round = await service.drawRound('seci', { kind: 'member', count: 3 } as any, ACTOR);
      const tenTrung = round.winnerIndexes.map((idx) => round.pool[idx].name);

      expect(tenTrung).toHaveLength(3);
      expect(new Set(round.winnerIndexes).size).toBe(3);
      expect(tenTrung).toContain(FIRST_RESTRICTED);
      expect(tenTrung).toContain(SECOND_RESTRICTED);
      expect(round.pool.map((p) => p.name)).toEqual(NAMES);
    }
  });

  it('lượt bốc một người vẫn chạy bình thường', async () => {
    const service = buildService();
    const round = await service.drawRound('seci', { kind: 'member', count: 1 } as any, ACTOR);

    expect(round.winnerIndexes).toHaveLength(1);
    expect(round.pool[round.winnerIndexes[0]].name).toBe(FIRST_RESTRICTED);
  });
});

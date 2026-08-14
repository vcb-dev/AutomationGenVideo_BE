import { ApprovalService } from '../approval.service';

// requiredLevels là hàm thuần, không chạm Prisma — dựng service với prisma rỗng là đủ.
const service = new ApprovalService({} as any);

const base = {
  totalValue: 10_000_000,
  fromTime: new Date('2026-08-12T08:00:00Z'),
  toTime: new Date('2026-08-13T18:00:00Z'),
  place: 'Studio',
};

describe('ApprovalService.requiredLevels', () => {
  it('phiếu nhỏ, ngắn ngày, dùng tại chỗ thì một cấp', () => {
    expect(service.requiredLevels(base)).toEqual({ levels: 1, reasons: [] });
  });

  it('BR-22: giá trị vượt 50 triệu thì lên hai cấp', () => {
    const result = service.requiredLevels({ ...base, totalValue: 50_000_001 });
    expect(result.levels).toBe(2);
    expect(result.reasons).toEqual(['giá trị vượt 50 triệu']);
  });

  it('đúng 50 triệu chẵn vẫn là một cấp', () => {
    // Ngưỡng là "vượt", không phải "từ" — sai chỗ này thì phiếu 50 triệu chẵn bị giữ oan.
    expect(service.requiredLevels({ ...base, totalValue: 50_000_000 }).levels).toBe(1);
  });

  it('mượn dài hơn 7 ngày thì lên hai cấp', () => {
    const result = service.requiredLevels({
      ...base,
      toTime: new Date('2026-08-19T09:00:00Z'),
    });
    expect(result.reasons).toEqual(['mượn dài hơn 7 ngày']);
  });

  it('đúng 7 ngày chẵn vẫn là một cấp', () => {
    expect(
      service.requiredLevels({ ...base, toTime: new Date('2026-08-19T08:00:00Z') }).levels,
    ).toBe(1);
  });

  it('địa điểm ngoài công ty thì lên hai cấp', () => {
    expect(service.requiredLevels({ ...base, place: 'Đà Nẵng' }).reasons).toEqual([
      'sử dụng ngoài công ty',
    ]);
  });

  it('địa điểm bỏ trống chưa tính là ngoài công ty', () => {
    // Người dùng mới chỉ chưa điền, không phải họ mang máy đi xa.
    expect(service.requiredLevels({ ...base, place: '   ' }).levels).toBe(1);
  });

  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    expect(service.requiredLevels({ ...base, place: '  HÀ NỘI ' }).levels).toBe(1);
  });

  it('gom đủ mọi lý do khi phiếu vướng nhiều điều kiện', () => {
    const result = service.requiredLevels({
      totalValue: 90_000_000,
      fromTime: new Date('2026-08-01T08:00:00Z'),
      toTime: new Date('2026-08-20T18:00:00Z'),
      place: 'Đà Nẵng',
    });
    expect(result.levels).toBe(2);
    expect(result.reasons).toHaveLength(3);
  });
});

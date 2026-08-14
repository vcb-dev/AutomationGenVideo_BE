import { canSign, nextStep, planApprovals } from '../approval-rules';

const base = {
  totalValue: 10_000_000,
  fromTime: new Date('2026-08-12T08:00:00Z'),
  toTime: new Date('2026-08-13T18:00:00Z'),
  place: 'Studio',
};

describe('planApprovals', () => {
  it('phiếu dùng tại chỗ chỉ cần một chữ ký của leader', () => {
    const plan = planApprovals(base);
    expect(plan.steps).toEqual([
      { level: 1, role: 'LEADER', reason: 'phiếu nào cũng cần một chữ ký của leader' },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('mang ra ngoài công ty thì thêm chữ ký của admin', () => {
    // Admin ký vì tài sản rời khỏi tầm kiểm soát, không phải vì con số lớn.
    const plan = planApprovals({ ...base, place: 'Đà Nẵng' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]).toMatchObject({ level: 2, role: 'ADMIN' });
  });

  it('giá trị lớn KHÔNG thêm chữ ký, chỉ cảnh báo', () => {
    // Phiếu 90 triệu quay tại studio vẫn là chuyện điều độ nội bộ, máy không đi đâu cả.
    const plan = planApprovals({ ...base, totalValue: 90_000_000 });
    expect(plan.steps).toHaveLength(1);
    expect(plan.warnings).toEqual(['giá trị vượt 50 triệu']);
  });

  it('mượn dài ngày cũng chỉ cảnh báo', () => {
    const plan = planApprovals({ ...base, toTime: new Date('2026-08-25T08:00:00Z') });
    expect(plan.steps).toHaveLength(1);
    expect(plan.warnings).toContain('mượn dài hơn 7 ngày');
  });

  it('một chiếc mic rẻ mang đi xa vẫn cần hai chữ ký', () => {
    // Đây là chỗ ngược trực giác về tiền nhưng đúng với thứ đang được canh.
    const plan = planApprovals({ ...base, totalValue: 7_000_000, place: 'Đà Nẵng' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.warnings).toEqual([]);
  });

  it('địa điểm bỏ trống chưa tính là ngoài công ty', () => {
    expect(planApprovals({ ...base, place: '   ' }).steps).toHaveLength(1);
  });

  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    expect(planApprovals({ ...base, place: '  HÀ NỘI ' }).steps).toHaveLength(1);
  });
});

describe('nextStep', () => {
  it('chưa ai ký thì tới lượt cấp 1', () => {
    const plan = planApprovals({ ...base, place: 'Đà Nẵng' });
    expect(nextStep(plan, 0)).toMatchObject({ level: 1, role: 'LEADER' });
  });

  it('ký xong cấp 1 thì tới lượt admin', () => {
    const plan = planApprovals({ ...base, place: 'Đà Nẵng' });
    expect(nextStep(plan, 1)).toMatchObject({ level: 2, role: 'ADMIN' });
  });

  it('đủ chữ ký thì không còn cấp nào', () => {
    expect(nextStep(planApprovals(base), 1)).toBeNull();
  });
});

describe('canSign', () => {
  const leaderStep = { level: 1 as const, role: 'LEADER' as const, reason: '' };
  const adminStep = { level: 2 as const, role: 'ADMIN' as const, reason: '' };

  it('leader ký được cấp của leader', () => {
    expect(canSign(leaderStep, ['LEADER'])).toBe(true);
  });

  it('manager cũng ký được cấp của leader', () => {
    expect(canSign(leaderStep, ['MANAGER'])).toBe(true);
  });

  it('member không ký được gì', () => {
    expect(canSign(leaderStep, ['MEMBER'])).toBe(false);
    expect(canSign(adminStep, ['MEMBER'])).toBe(false);
  });

  it('leader KHÔNG ký thay được cấp của admin', () => {
    // Nếu ký thay được thì cửa canh tài sản ra khỏi công ty chỉ còn là hình thức.
    expect(canSign(adminStep, ['LEADER', 'MANAGER'])).toBe(false);
  });

  it('admin ký thay được cấp của leader', () => {
    // Dành cho trường hợp bộ phận chỉ có một leader và chính họ đứng tên phiếu.
    expect(canSign(leaderStep, ['ADMIN'])).toBe(true);
  });

  it('người nhiều vai trò thì lấy vai trò cao nhất', () => {
    expect(canSign(adminStep, ['MEMBER', 'ADMIN'])).toBe(true);
  });
});

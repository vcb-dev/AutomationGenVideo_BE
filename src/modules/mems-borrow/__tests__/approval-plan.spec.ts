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
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ level: 1, role: 'LEADER' });
    expect(plan.warnings).toEqual([]);
  });

  it('mang ra ngoài công ty phục vụ công việc vẫn chỉ một chữ ký', () => {
    // Đi quay ngoại cảnh, đi sự kiện là việc thường ngày — bắt qua admin thì nghẽn cả kho.
    // Thứ cần admin gác là mượn cho việc RIÊNG, xem personal-borrow-approval.spec.ts.
    const plan = planApprovals({ ...base, place: 'Đà Nẵng' });
    expect(plan.steps).toHaveLength(1);
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

  it('một chiếc mic rẻ mượn cho việc riêng vẫn cần hai chữ ký', () => {
    // Đây là chỗ ngược trực giác về tiền nhưng đúng với thứ đang được canh: mục đích, không
    // phải giá trị.
    const plan = planApprovals({ ...base, totalValue: 7_000_000, purpose: 'PERSONAL' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.warnings).toEqual([]);
  });

  it('địa điểm không còn quyết định số cấp duyệt', () => {
    expect(planApprovals({ ...base, place: '   ' }).steps).toHaveLength(1);
    expect(planApprovals({ ...base, place: '  HÀ NỘI ' }).steps).toHaveLength(1);
  });
});

describe('nextStep', () => {
  it('chưa ai ký thì tới lượt cấp 1', () => {
    const plan = planApprovals({ ...base, purpose: 'PERSONAL' });
    expect(nextStep(plan, 0)).toMatchObject({ level: 1, role: 'LEADER' });
  });

  it('ký xong cấp 1 thì tới lượt admin', () => {
    const plan = planApprovals({ ...base, purpose: 'PERSONAL' });
    expect(nextStep(plan, 1)).toMatchObject({ level: 2, role: 'ADMIN' });
  });

  it('đủ chữ ký thì không còn cấp nào', () => {
    expect(nextStep(planApprovals(base), 1)).toBeNull();
  });
});

describe('canSign', () => {
  // Cấp của leader trên phiếu CÔNG VIỆC: admin ký thay được khi bộ phận không còn ai khác ký.
  const leaderStep = {
    level: 1 as const,
    role: 'LEADER' as const,
    reason: '',
    adminProxyAllowed: true,
  };
  const adminStep = {
    level: 2 as const,
    role: 'ADMIN' as const,
    reason: '',
    adminProxyAllowed: false,
  };

  it('leader Team Media ký được cấp của leader', () => {
    expect(canSign(leaderStep, ['LEADER'], 'MEDIA')).toBe(true);
  });

  it('manager Team Media cũng ký được cấp của leader', () => {
    expect(canSign(leaderStep, ['MANAGER'], 'MEDIA')).toBe(true);
  });

  it('member không ký được gì', () => {
    expect(canSign(leaderStep, ['MEMBER'], 'MEDIA')).toBe(false);
    expect(canSign(adminStep, ['MEMBER'], 'MEDIA')).toBe(false);
  });

  it('leader KHÔNG ký thay được cấp của admin', () => {
    // Nếu ký thay được thì cửa canh phiếu mượn cá nhân chỉ còn là hình thức.
    expect(canSign(adminStep, ['LEADER', 'MANAGER'], 'MEDIA')).toBe(false);
  });

  it('admin ký thay được cấp của leader', () => {
    // Dành cho trường hợp bộ phận chỉ có một leader và chính họ đứng tên phiếu.
    expect(canSign(leaderStep, ['ADMIN'], null)).toBe(true);
  });

  it('người nhiều vai trò thì lấy vai trò cao nhất', () => {
    expect(canSign(adminStep, ['MEMBER', 'ADMIN'], null)).toBe(true);
  });

  it('leader bộ phận khác KHÔNG ký được, dù cấp đang tới lượt là cấp của leader', () => {
    // Kho là tài sản của bộ phận Media. Leader bộ phận khác ký thì cửa duyệt không còn gắn với
    // người chịu trách nhiệm về máy.
    expect(canSign(leaderStep, ['LEADER'], 'Team K1')).toBe(false);
    expect(canSign(leaderStep, ['MANAGER'], 'Team ADS')).toBe(false);
  });

  it('thiếu thông tin team thì KHÔNG cho ký, không đoán rộng ra', () => {
    // Bản trước coi `undefined` là Media, nên bất kỳ lời gọi nào quên truyền team đều lặng lẽ
    // mở cửa cho leader mọi bộ phận. Mặc định phải là đóng.
    expect(canSign(leaderStep, ['LEADER'], undefined)).toBe(false);
    expect(canSign(leaderStep, ['LEADER'], null)).toBe(false);
    expect(canSign(leaderStep, ['LEADER'], '')).toBe(false);
  });

  it('team ghi nhiều tên hoặc khác hoa thường vẫn nhận đúng', () => {
    expect(canSign(leaderStep, ['LEADER'], 'Scale Data, media')).toBe(true);
    expect(canSign(leaderStep, ['leader'], 'MEDIA')).toBe(true);
  });

  it('tên team chỉ chứa chữ media thì KHÔNG ký thay cấp leader được', () => {
    // Luật cũ so khớp bằng "có chứa", nên đặt tên team là đủ để leo lên quyền ký duyệt phiếu
    // mượn của cả kho. Tên team do người dùng đặt được nên đó là cửa mở sẵn.
    expect(canSign(leaderStep, ['LEADER'], 'Media Chung')).toBe(false);
    expect(canSign(leaderStep, ['LEADER'], 'Social Media')).toBe(false);
  });
});

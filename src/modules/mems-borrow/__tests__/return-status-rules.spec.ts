import { conditionWorsened, resolveReturnStatus } from '../return-rules';

describe('conditionWorsened', () => {
  it('nhận ra máy tệ đi theo thang tình trạng', () => {
    expect(conditionWorsened('GOOD', 'USED')).toBe(true);
    expect(conditionWorsened('USED', 'BROKEN')).toBe(true);
  });

  it('giữ nguyên tình trạng không phải là tệ đi', () => {
    expect(conditionWorsened('USED', 'USED')).toBe(false);
  });

  it('tốt lên không phải là tệ đi', () => {
    // Máy vừa đi bảo trì về thì khá hơn lúc giao, không có gì để quy trách nhiệm.
    expect(conditionWorsened('NEEDS_CHECK', 'GOOD')).toBe(false);
  });

  it('tình trạng lạ coi như mức xấu nhất', () => {
    expect(conditionWorsened('GOOD', 'KHÔNG_RÕ')).toBe(true);
  });
});

describe('resolveReturnStatus', () => {
  it('máy nguyên vẹn, đủ phụ kiện thì về thẳng kệ', () => {
    expect(
      resolveReturnStatus({
        conditionBefore: 'GOOD',
        conditionAfter: 'GOOD',
        missingAccessoryCount: 0,
      }),
    ).toBe('AVAILABLE');
  });

  it('BR-42: máy tệ đi phải qua Kiểm tra sau trả', () => {
    // Cho về Sẵn sàng ngay là người mượn kế tiếp lãnh hậu quả.
    expect(
      resolveReturnStatus({
        conditionBefore: 'GOOD',
        conditionAfter: 'USED',
        missingAccessoryCount: 0,
      }),
    ).toBe('POST_RETURN_CHECK');
  });

  it('thiếu phụ kiện cũng phải kiểm tra dù thân máy nguyên vẹn', () => {
    // Thiếu pin hay sạc thì chiếc máy đó chưa cho mượn tiếp được.
    expect(
      resolveReturnStatus({
        conditionBefore: 'GOOD',
        conditionAfter: 'GOOD',
        missingAccessoryCount: 1,
      }),
    ).toBe('POST_RETURN_CHECK');
  });

  it('máy tốt lên vẫn về thẳng kệ', () => {
    expect(
      resolveReturnStatus({
        conditionBefore: 'USED',
        conditionAfter: 'GOOD',
        missingAccessoryCount: 0,
      }),
    ).toBe('AVAILABLE');
  });
});

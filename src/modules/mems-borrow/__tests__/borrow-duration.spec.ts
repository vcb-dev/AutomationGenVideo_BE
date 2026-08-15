import { borrowDuration } from '../borrow-duration';

/**
 * Chức năng: tính một lượt mượn kéo dài bao lâu và có trễ hạn không.
 *
 * Vì sao đáng một file test riêng: đây là con số người quản lý kho nhìn để đòi máy và để đánh
 * giá ai hay giữ quá hạn — sai một ngày là oan người. Mà "bao lâu" có tới ba mốc dễ lẫn nhau:
 * hạn ĐĂNG KÝ trên phiếu (`to_time`), lúc GIAO thật (`received_at`), lúc TRẢ thật
 * (`returned_at`). Đo theo mốc đăng ký thì không bao giờ thấy ai giữ lố; đo theo mốc thật mà
 * quên đối chiếu hạn thì không biết trễ.
 *
 * Luật đã chốt: thời gian giữ đếm theo THỰC TẾ, còn trễ hay không thì so với hạn đăng ký.
 */
describe('borrowDuration', () => {
  const handedOver = new Date('2026-08-02T09:00:00Z');
  const dueAt = new Date('2026-08-07T09:00:00Z');

  it('trả đúng hạn: đếm đủ số ngày giữ, không tính trễ', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: new Date('2026-08-07T09:00:00Z'),
      now: new Date('2026-08-20T00:00:00Z'),
    });

    expect(result.status).toBe('RETURNED');
    expect(result.heldDays).toBe(5);
    expect(result.lateDays).toBe(0);
  });

  it('trả trễ: nêu đúng số ngày quá hạn', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: new Date('2026-08-09T09:00:00Z'),
      now: new Date('2026-08-20T00:00:00Z'),
    });

    expect(result.status).toBe('RETURNED');
    expect(result.heldDays).toBe(7);
    expect(result.lateDays).toBe(2);
  });

  it('trả sớm hơn hạn thì lateDays là 0, không phải số âm', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: new Date('2026-08-04T09:00:00Z'),
      now: new Date('2026-08-20T00:00:00Z'),
    });

    expect(result.heldDays).toBe(2);
    expect(result.lateDays).toBe(0);
  });

  it('chưa trả: đếm tới hiện tại và đánh dấu đang giữ', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: null,
      now: new Date('2026-08-05T09:00:00Z'),
    });

    expect(result.status).toBe('HOLDING');
    expect(result.heldDays).toBe(3);
    expect(result.lateDays).toBe(0);
  });

  it('chưa trả mà đã quá hạn: vẫn là đang giữ nhưng phải hiện số ngày trễ', () => {
    // Đây là ca người quản lý kho cần thấy nhất — máy đang ở ngoài và đã quá hạn.
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: null,
      now: new Date('2026-08-10T09:00:00Z'),
    });

    expect(result.status).toBe('OVERDUE');
    expect(result.heldDays).toBe(8);
    expect(result.lateDays).toBe(3);
  });

  it('giữ chưa tròn một ngày vẫn tính là 0 ngày, không làm tròn lên', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt,
      returnedAt: new Date('2026-08-02T20:00:00Z'),
      now: new Date('2026-08-20T00:00:00Z'),
    });

    expect(result.heldDays).toBe(0);
    expect(result.lateDays).toBe(0);
  });

  it('thiếu mốc giao thì không bịa số, trả về không xác định', () => {
    // Dữ liệu cũ có thể thiếu mốc giao. Thà nói "không rõ" còn hơn hiện một con số sai.
    const result = borrowDuration({
      handedOverAt: null,
      dueAt,
      returnedAt: null,
      now: new Date('2026-08-10T09:00:00Z'),
    });

    expect(result.status).toBe('UNKNOWN');
    expect(result.heldDays).toBeNull();
    expect(result.lateDays).toBeNull();
  });

  it('không có hạn đăng ký thì vẫn đếm được số ngày giữ, chỉ là không kết luận trễ', () => {
    const result = borrowDuration({
      handedOverAt: handedOver,
      dueAt: null,
      returnedAt: new Date('2026-08-09T09:00:00Z'),
      now: new Date('2026-08-20T00:00:00Z'),
    });

    expect(result.heldDays).toBe(7);
    expect(result.lateDays).toBeNull();
    expect(result.status).toBe('RETURNED');
  });
});

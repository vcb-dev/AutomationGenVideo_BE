import { computeAvailability, overlaps } from '../availability';

const d = (iso: string) => new Date(iso);

describe('overlaps', () => {
  it('hai khoảng chạm đầu đuôi thì KHÔNG coi là giao nhau', () => {
    // Nửa mở: trả lúc 12:00 và mượn lúc 12:00 là hợp lệ, không được chặn.
    const a = { fromTime: d('2026-08-10T08:00:00Z'), toTime: d('2026-08-10T12:00:00Z') };
    expect(overlaps(a, d('2026-08-10T12:00:00Z'), d('2026-08-10T16:00:00Z'))).toBe(false);
  });

  it('hai khoảng chồng lấn một phần thì giao nhau', () => {
    const a = { fromTime: d('2026-08-10T08:00:00Z'), toTime: d('2026-08-10T13:00:00Z') };
    expect(overlaps(a, d('2026-08-10T12:00:00Z'), d('2026-08-10T16:00:00Z'))).toBe(true);
  });

  it('khoảng có toTime null thì chiếm dụng vô hạn về sau', () => {
    // Lệnh bảo trì chưa có ngày hoàn thành: phải luôn bị trừ, nếu không sẽ đếm dư máy.
    const a = { fromTime: d('2026-08-01T00:00:00Z'), toTime: null };
    expect(overlaps(a, d('2026-12-25T00:00:00Z'), d('2026-12-26T00:00:00Z'))).toBe(true);
  });
});

describe('computeAvailability', () => {
  const base = {
    requestedFrom: d('2026-08-10T08:00:00Z'),
    requestedTo: d('2026-08-11T18:00:00Z'),
  };

  it('không có gì bận thì khả dụng bằng tổng máy dùng được', () => {
    const r = computeAvailability({
      ...base,
      totalUsableAssets: 5,
      reservations: [],
      maintenances: [],
    });
    expect(r.available).toBe(5);
  });

  it('mỗi bản ghi giữ chỗ giao nhau trừ đúng một máy', () => {
    // Dòng xin 3 máy sinh 3 bản ghi giữ chỗ, nên đếm bản ghi là đếm máy.
    const r = computeAvailability({
      ...base,
      totalUsableAssets: 5,
      reservations: [
        { fromTime: d('2026-08-10T09:00:00Z'), toTime: d('2026-08-10T17:00:00Z') },
        { fromTime: d('2026-08-10T09:00:00Z'), toTime: d('2026-08-10T17:00:00Z') },
      ],
      maintenances: [],
    });
    expect(r.available).toBe(3);
    expect(r.busyByReservation).toBe(2);
  });

  it('giữ chỗ nằm hoàn toàn ngoài khoảng xin thì không trừ', () => {
    const r = computeAvailability({
      ...base,
      totalUsableAssets: 2,
      reservations: [
        { fromTime: d('2026-08-20T09:00:00Z'), toTime: d('2026-08-21T09:00:00Z') },
      ],
      maintenances: [],
    });
    expect(r.available).toBe(2);
  });

  it('lệnh bảo trì chồng lấn trừ vào khả dụng', () => {
    const r = computeAvailability({
      ...base,
      totalUsableAssets: 3,
      reservations: [],
      maintenances: [
        { fromTime: d('2026-08-09T00:00:00Z'), toTime: d('2026-08-15T00:00:00Z') },
      ],
    });
    expect(r.available).toBe(2);
    expect(r.busyByMaintenance).toBe(1);
  });

  it('khả dụng không bao giờ âm', () => {
    // Dữ liệu lệch (giữ chỗ nhiều hơn máy) không được làm hỏng màn hình bằng số âm.
    const r = computeAvailability({
      ...base,
      totalUsableAssets: 1,
      reservations: [
        { fromTime: d('2026-08-10T09:00:00Z'), toTime: d('2026-08-10T17:00:00Z') },
        { fromTime: d('2026-08-10T09:00:00Z'), toTime: d('2026-08-10T17:00:00Z') },
      ],
      maintenances: [],
    });
    expect(r.available).toBe(0);
  });
});

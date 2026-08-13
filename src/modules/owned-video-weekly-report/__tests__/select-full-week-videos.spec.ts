import {
  DEFAULT_VIEW_THRESHOLD,
  WINDOW_BOUNDARY_DAYS,
  FULL_WEEK_DAYS,
  isFinalRecord,
  filterByThreshold,
  filterUnfinalizedVideos,
  computeWindow,
} from '../select-full-week-videos';

/**
 * Số liệu nền của các mốc trong test này, đo trên DB thật ngày 06/08/2026:
 *   - 95 fanpage nội bộ đang bật
 *   - 112–168 video tròn 7 ngày mỗi ngày
 *   - tổng kho 20.515 video, cũ nhất 11/02/2022  → vì sao phải chặn cửa sổ 14 ngày
 */

const BAY_GIO = new Date('2026-08-07T09:00:00.000Z');
const previousDate = (n: number) => new Date(BAY_GIO.getTime() - n * 86_400_000);

describe('computeWindow — khoảng ngày đăng được chọn', () => {
  it('chặn trên là tròn 7 ngày, chặn dưới là 14 ngày', () => {
    const { tuNgay, denNgay } = computeWindow(BAY_GIO);
    expect(denNgay).toEqual(previousDate(FULL_WEEK_DAYS));
    expect(tuNgay).toEqual(previousDate(WINDOW_BOUNDARY_DAYS));
  });

  it('video 6 ngày chưa tới lượt, 7 ngày thì tới, 15 ngày thì quá muộn', () => {
    const { tuNgay, denNgay } = computeWindow(BAY_GIO);
    const inWindow = (d: Date) => d >= tuNgay && d < denNgay;

    expect(inWindow(previousDate(6))).toBe(false);
    expect(inWindow(previousDate(7.5))).toBe(true);
    expect(inWindow(previousDate(13))).toBe(true);
    expect(inWindow(previousDate(15))).toBe(false);
  });

  it('chặn dưới 14 ngày là bắt buộc: không có nó thì lần chạy đầu quét cả kho từ 2022', () => {
    const { tuNgay } = computeWindow(BAY_GIO);
    const oldVideo = new Date('2022-02-11T00:00:00.000Z'); // video cũ nhất trong kho thật
    expect(oldVideo < tuNgay).toBe(true);
  });
});

describe('isFinalRecord — bản ghi nào coi là xong hẳn', () => {
  it('đã gửi thì chốt', () => {
    expect(isFinalRecord({ trang_thai: 'da_gui', so_lan_thu: 1 })).toBe(true);
  });

  it('không có người nhận thì chốt — thử lại cũng vẫn không có ai để gửi', () => {
    expect(isFinalRecord({ trang_thai: 'khong_co_nguoi_nhan', so_lan_thu: 0 })).toBe(true);
  });

  it('lỗi chưa đủ 3 lượt thì CHƯA chốt, còn được thử lại', () => {
    expect(isFinalRecord({ trang_thai: 'loi', so_lan_thu: 0 })).toBe(false);
    expect(isFinalRecord({ trang_thai: 'loi', so_lan_thu: 2 })).toBe(false);
  });

  it('lỗi đủ 3 lượt thì thôi — lặp lại 3 lần thì không còn là lỗi mạng', () => {
    expect(isFinalRecord({ trang_thai: 'loi', so_lan_thu: 3 })).toBe(true);
    expect(isFinalRecord({ trang_thai: 'loi', so_lan_thu: 9 })).toBe(true);
  });
});

describe('filterUnfinalizedVideos — bỏ video đã xong khỏi lô sắp gửi', () => {
  const videos = [
    { post_id: 'p1' },
    { post_id: 'p2' },
    { post_id: 'p3' },
    { post_id: 'p4' },
  ];

  it('giữ lại đúng video chưa chốt', () => {
    const logs = [
      { post_id: 'p1', trang_thai: 'da_gui', so_lan_thu: 1 },
      { post_id: 'p2', trang_thai: 'loi', so_lan_thu: 1 },
      { post_id: 'p3', trang_thai: 'khong_co_nguoi_nhan', so_lan_thu: 0 },
    ];

    const remaining = filterUnfinalizedVideos(videos, logs).map((v) => v.post_id);
    // p2 lỗi 1 lượt nên vẫn được thử lại; p4 chưa từng có bản ghi nào
    expect(remaining).toEqual(['p2', 'p4']);
  });

  it('chưa có nhật ký nào thì giữ nguyên cả lô', () => {
    expect(filterUnfinalizedVideos(videos, [])).toHaveLength(4);
  });

  it('cả lô đã chốt thì trả về rỗng — cron chạy lại không gửi trùng', () => {
    const logs = videos.map((v) => ({ post_id: v.post_id, trang_thai: 'da_gui', so_lan_thu: 1 }));
    expect(filterUnfinalizedVideos(videos, logs)).toEqual([]);
  });
});

describe('filterByThreshold — chỉ báo video đã bùng nổ', () => {
  const v = (view_count: number) => ({ post_id: `p${view_count}`, view_count });

  it('tách đúng hai nhóm quanh mốc, đạt mốc thì tính là đạt', () => {
    const { aboveThreshold, belowThreshold } = filterByThreshold(
      [v(999_999), v(1_000_000), v(1_330_000)],
      DEFAULT_VIEW_THRESHOLD,
    );
    expect(aboveThreshold.map((x) => x.view_count)).toEqual([1_000_000, 1_330_000]);
    expect(belowThreshold.map((x) => x.view_count)).toEqual([999_999]);
  });

  it('ngưỡng mặc định là 1 triệu — đo thật cho ~1 video/tuần trên 8.431 video/60 ngày', () => {
    expect(DEFAULT_VIEW_THRESHOLD).toBe(1_000_000);
  });

  it('hạ ngưỡng thì nhiều video lọt hơn', () => {
    const lo = [v(120_000), v(600_000), v(1_330_000)];
    expect(filterByThreshold(lo, 1_000_000).aboveThreshold).toHaveLength(1);
    expect(filterByThreshold(lo, 500_000).aboveThreshold).toHaveLength(2);
    expect(filterByThreshold(lo, 100_000).aboveThreshold).toHaveLength(3);
  });
});

describe('isFinalRecord — video dưới ngưỡng', () => {
  it('dưới ngưỡng ở mốc 7 ngày là XONG, ngày thứ 10 lên 1 triệu cũng không báo nữa', () => {
    expect(isFinalRecord({ trang_thai: 'duoi_nguong', so_lan_thu: 0 })).toBe(true);
  });
});

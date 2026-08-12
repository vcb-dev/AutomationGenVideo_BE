import {
  chuanHoaKhoang,
  chuanHoaNenTang,
  congNgay,
  OwnedStatsService,
  daysBetween,
} from '../owned-stats.service';

/**
 * Thống kê tổng quan kênh nội bộ.
 *
 * Test bám vào phần KHÔNG chạm Postgres: chuẩn hoá tham số vào và gộp kết quả ra. Mấy câu
 * $queryRaw ở giữa phải kiểm bằng dữ liệu thật chứ mock lại chỉ chứng minh mock đúng.
 *
 * Giờ hệ thống ghim vào 12:00 ngày 07/08/2026 giờ VN: chuanHoaKhoang() và buildAlerts() đều
 * đọc đồng hồ, không ghim thì test xanh hôm nay đỏ ngày mai.
 */

const BAY_GIO = new Date('2026-08-07T05:00:00.000Z'); // 12:00 giờ VN

beforeAll(() => {
  jest.useFakeTimers({ now: BAY_GIO });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('chuanHoaNenTang', () => {
  it.each(['facebook', 'tiktok', 'instagram', 'youtube'])('giữ nguyên "%s"', (p) => {
    expect(chuanHoaNenTang(p)).toBe(p);
  });

  it.each([
    ['FACEBOOK', 'facebook'],
    ['  TikTok  ', 'tiktok'],
  ])('thường hoá và cắt khoảng trắng: "%s"', (vao, ra) => {
    expect(chuanHoaNenTang(vao)).toBe(ra);
  });

  /*
   * Chuỗi rỗng nghĩa là "tất cả nền tảng" — nguonVideo() dựng đủ 4 nhánh UNION ALL. Nền tảng
   * lạ phải rơi về đây chứ không được ghép thẳng vào SQL.
   */
  it.each([undefined, '', '   ', 'all', 'douyin', 'xiaohongshu', "'; DROP TABLE--"])(
    'quy "%s" về tất cả nền tảng',
    (raw) => {
      expect(chuanHoaNenTang(raw as string | undefined)).toBe('');
    },
  );
});

describe('congNgay / daysBetween', () => {
  it('cộng ngày vượt qua ranh giới tháng', () => {
    expect(congNgay('2026-01-31', 1)).toBe('2026-02-01');
    expect(congNgay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('2028 là năm nhuận nên 28/02 cộng 1 ra 29/02', () => {
    expect(congNgay('2028-02-28', 1)).toBe('2028-02-29');
  });

  /* Khoảng ĐÓNG hai đầu: 7 ngày gần nhất phải là 7, không phải 6. */
  it('đếm cả ngày đầu lẫn ngày cuối', () => {
    expect(daysBetween('2026-08-07', '2026-08-07')).toBe(1);
    expect(daysBetween('2026-08-01', '2026-08-07')).toBe(7);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
  });
});

describe('chuanHoaKhoang', () => {
  it('không tham số nào thì lấy 28 ngày gần nhất tính tới hôm nay', () => {
    expect(chuanHoaKhoang()).toEqual({ tu: '2026-07-11', den: '2026-08-07' });
    expect(daysBetween('2026-07-11', '2026-08-07')).toBe(28);
  });

  it.each([
    ['7', '2026-08-01'],
    ['28', '2026-07-11'],
    ['90', '2026-05-10'],
  ])('preset days=%s', (days, tu) => {
    expect(chuanHoaKhoang(undefined, undefined, days)).toEqual({ tu, den: '2026-08-07' });
  });

  /* Chỉ 3 preset trên nút chọn kỳ là hợp lệ; số lạ phải rơi về mặc định 28 ngày. */
  it.each(['1', '30', '365', 'abc', ''])('days=%s không hợp lệ → về mặc định 28 ngày', (days) => {
    expect(chuanHoaKhoang(undefined, undefined, days)).toEqual({
      tu: '2026-07-11',
      den: '2026-08-07',
    });
  });

  it('tu + den do người dùng chọn thì thắng days', () => {
    expect(chuanHoaKhoang('2026-06-01', '2026-06-30', '7')).toEqual({
      tu: '2026-06-01',
      den: '2026-06-30',
    });
  });

  it('khoảng ngược thì lật lại chứ không trả về khoảng rỗng', () => {
    expect(chuanHoaKhoang('2026-06-30', '2026-06-01')).toEqual({
      tu: '2026-06-01',
      den: '2026-06-30',
    });
  });

  /* Video chưa đăng nên kéo dài sang tương lai không thêm được số nào. */
  it('cắt ngày cuối về hôm nay', () => {
    expect(chuanHoaKhoang('2026-08-01', '2027-01-01')).toEqual({
      tu: '2026-08-01',
      den: '2026-08-07',
    });
  });

  it('cả khoảng nằm trong tương lai thì thu về đúng hôm nay', () => {
    expect(chuanHoaKhoang('2027-01-01', '2027-02-01')).toEqual({
      tu: '2026-08-07',
      den: '2026-08-07',
    });
  });

  /*
   * Trần 366 ngày là chốt chặn hiệu năng, không phải quy tắc nghiệp vụ: bóc hashtag bằng
   * regexp trên caption tốn ~3,4 giây cho 90 ngày. Thả cho chọn 10 năm là treo cả request.
   */
  it('chặn trần 366 ngày, giữ ngày cuối và đẩy ngày đầu lên', () => {
    const ra = chuanHoaKhoang('2016-01-01', '2026-08-07');
    expect(daysBetween(ra.tu, ra.den)).toBe(366);
    expect(ra.den).toBe('2026-08-07');
  });

  /* '2026-02-31' khớp regex YYYY-MM-DD nhưng không phải ngày có thật. */
  it.each(['2026-02-31', '2026-13-01', '07-08-2026', '2026/08/07', 'hôm qua'])(
    'ngày rác "%s" bị bỏ, rơi về mặc định',
    (rac) => {
      expect(chuanHoaKhoang(rac, rac)).toEqual({ tu: '2026-07-11', den: '2026-08-07' });
    },
  );
});

// ── Gộp kết quả ────────────────────────────────────────────────────────────────

function buildService() {
  return new OwnedStatsService({} as any, {} as any);
}

const kenh = (p: any = {}) => ({
  platform: 'facebook',
  kenh_id: 'k1',
  ten: 'Page A',
  avatar: '',
  followers: BigInt(100),
  dong_bo: null,
  loi: null,
  hoat_dong: true,
  ngay_cuoi: BAY_GIO,
  ...p,
});

const channelCount = (p: any = {}) => ({
  platform: 'facebook',
  kenh_id: 'k1',
  ky: 'nay',
  posts: BigInt(0),
  views: BigInt(0),
  likes: BigInt(0),
  comments: BigInt(0),
  shares: BigInt(0),
  ...p,
});

describe('mergeMarkets', () => {
  it('tách VN / Global theo cờ vn và xếp nền tảng nhiều lượt xem lên trước', () => {
    const ra = (buildService() as any).mergeMarkets([
      { platform: 'facebook', vn: true, posts: BigInt(10), views: BigInt(1000) },
      { platform: 'facebook', vn: false, posts: BigInt(5), views: BigInt(500) },
      { platform: 'tiktok', vn: true, posts: BigInt(1), views: BigInt(9_999) },
    ]);

    expect(ra).toEqual([
      { platform: 'tiktok', vn: 9_999, global: 0, posts_vn: 1, posts_global: 0 },
      { platform: 'facebook', vn: 1000, global: 500, posts_vn: 10, posts_global: 5 },
    ]);
  });

  it('không có dòng nào thì trả mảng rỗng, không phải undefined', () => {
    expect((buildService() as any).mergeMarkets([])).toEqual([]);
  });
});

describe('mergeContentLines', () => {
  /*
   * SQL trả MỘT DÒNG cho mỗi cặp (mã tuyến, thị trường). Gộp ở đây phải cộng views vào tổng
   * chung ĐỒNG THỜI tách sang views_vn/views_global — cộng thiếu một chỗ là tổng không khớp
   * với hai cột con.
   */
  it('cộng tổng và tách VN / Global cho cùng một mã tuyến', () => {
    const ra = (buildService() as any).mergeContentLines([
      { ma: 'A1', vn: true, posts: BigInt(3), views: BigInt(300) },
      { ma: 'A1', vn: false, posts: BigInt(2), views: BigInt(200) },
      { ma: 'A2', vn: true, posts: BigInt(1), views: BigInt(50) },
    ]);

    expect(ra).toEqual([
      { ma: 'A1', posts: 5, views: 500, views_vn: 300, views_global: 200 },
      { ma: 'A2', posts: 1, views: 50, views_vn: 50, views_global: 0 },
    ]);
    expect(ra[0].views).toBe(ra[0].views_vn + ra[0].views_global);
  });
});

describe('buildAlerts', () => {
  it('kênh có lỗi đồng bộ được báo trước, nội dung cắt còn 120 ký tự', () => {
    const loiDai = 'x'.repeat(500);
    const ra = (buildService() as any).buildAlerts([kenh({ loi: loiDai })], [], 28);

    expect(ra).toHaveLength(1);
    expect(ra[0].nhan).toBe('Lỗi');
    expect(ra[0].muc).toBe('b');
    expect(ra[0].noi_dung).toBe(`Đồng bộ lỗi: ${'x'.repeat(120)}`);
  });

  it('kênh đã tắt thì im lặng hay lỗi đều không báo — báo lên chỉ làm nhiễu', () => {
    const ra = (buildService() as any).buildAlerts(
      [kenh({ hoat_dong: false, loi: 'token hết hạn', ngay_cuoi: new Date('2020-01-01') })],
      [],
      28,
    );
    expect(ra).toEqual([]);
  });

  it('kênh chưa cào được video nào thì báo Trống', () => {
    const ra = (buildService() as any).buildAlerts([kenh({ ngay_cuoi: null })], [], 28);
    expect(ra[0]).toMatchObject({ nhan: 'Trống', muc: 'w', noi_dung: 'Chưa cào được video nào' });
  });

  it.each([
    [6, false],
    [7, true],
    [30, true],
  ])('im lặng %s ngày → có báo: %s', (silentDays, coBao) => {
    const ngayCuoi = new Date(BAY_GIO.getTime() - silentDays * 86_400_000);
    const ra = (buildService() as any).buildAlerts([kenh({ ngay_cuoi: ngayCuoi })], [], 28);
    const imLang = ra.filter((c: any) => c.nhan === 'Im lặng');

    expect(imLang).toHaveLength(coBao ? 1 : 0);
    if (coBao) expect(imLang[0].noi_dung).toBe(`Chưa đăng bài trong ${silentDays} ngày`);
  });

  /*
   * Sàn 10.000 lượt xem kỳ trước: dưới ngưỡng đó tỷ lệ phần trăm nhảy loạn — 100 xuống 40 là
   * "tụt 60%" nhưng chẳng nói lên điều gì.
   */
  it('không báo tụt khi kỳ trước dưới 10.000 lượt xem, dù tụt sạch', () => {
    const ra = (buildService() as any).buildAlerts(
      [kenh()],
      [channelCount({ ky: 'nay', views: BigInt(0) }), channelCount({ ky: 'truoc', views: BigInt(9_999) })],
      28,
    );
    expect(ra.filter((c: any) => c.nhan === 'Tụt')).toHaveLength(0);
  });

  /* Ngưỡng -30% BAO GỒM chính nó (`delta > -30` mới bỏ qua), nên đúng 30% là đã báo. */
  it.each([
    [71_000, false], // giảm 29%
    [70_000, true], // giảm đúng 30% — vẫn báo
    [50_000, true], // giảm 50%
  ])('kỳ trước 100.000, kỳ này %s → báo tụt: %s', (viewsNay, coBao) => {
    const ra = (buildService() as any).buildAlerts(
      [kenh()],
      [
        channelCount({ ky: 'nay', views: BigInt(viewsNay) }),
        channelCount({ ky: 'truoc', views: BigInt(100_000) }),
      ],
      28,
    );
    expect(ra.filter((c: any) => c.nhan === 'Tụt')).toHaveLength(coBao ? 1 : 0);
  });

  it('nội dung cảnh báo tụt nhắc đúng số ngày của kỳ đang xem', () => {
    const ra = (buildService() as any).buildAlerts(
      [kenh()],
      [channelCount({ ky: 'nay', views: BigInt(40_000) }), channelCount({ ky: 'truoc', views: BigInt(100_000) })],
      90,
    );
    expect(ra[0].noi_dung).toBe('Lượt xem giảm 60% so với 90 ngày trước đó');
  });

  /* Trần 12 dòng: khối "Cần chú ý" trên tokenRow chỉ hiển thị được ngần ấy.
     Dùng 40 kênh IM LẶNG chứ không phải 40 kênh cùng một lỗi đồng bộ: nhiều kênh chung
     một thông báo lỗi nay gộp thành MỘT dòng (xem sync-error-alert-aggregation.spec.ts),
     nên đầu vào cũ không còn sinh nổi 40 dòng để mà kiểm tra chuyện cắt. */
  it('cắt còn tối đa 12 cảnh báo', () => {
    const nhieuKenh = Array.from({ length: 40 }, (_, i) =>
      kenh({ kenh_id: `k${i}`, ten: `Page ${i}`, ngay_cuoi: new Date('2020-01-01') }),
    );
    expect((buildService() as any).buildAlerts(nhieuKenh, [], 28)).toHaveLength(12);
  });

  it('xếp lỗi đồng bộ lên trước im lặng', () => {
    const ra = (buildService() as any).buildAlerts(
      [
        kenh({ kenh_id: 'im', ten: 'Kênh im', ngay_cuoi: new Date('2020-01-01') }),
        kenh({ kenh_id: 'loi', ten: 'Kênh lỗi', loi: 'token hết hạn' }),
      ],
      [],
      28,
    );
    expect(ra.map((c: any) => c.nhan)).toEqual(['Lỗi', 'Im lặng']);
  });
});

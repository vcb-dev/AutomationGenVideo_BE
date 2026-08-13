import {
  DongNhomTrung,
  DongVideoKenh,
  buildDuplicateAlerts,
  mergeGroups,
  rutGonNoiDung,
  computeByChannel,
} from '../owned-duplicate.service';

/**
 * Số liệu trong test lấy từ dữ liệu THẬT (DB local, 05/08/2026 — 20.515 video / 94 fanpage):
 *   Kỳ 09/07→05/08: 320 nhóm trùng chéo kênh (1 nhóm 4 kênh, 74 nhóm 3 kênh, 245 nhóm 2 kênh),
 *                   727/3.615 video (20,1%), 27 kênh dính, 5 cảnh báo cấp kênh.
 *   Page trùng nhiều nhất: "Huyk - Mê Chế Tác" 69/69 (100%), "HuyK Chế Tác" 71/72 (98,6%).
 */

const nhom = (p: Partial<DongNhomTrung>): DongNhomTrung => ({
  platform: 'facebook',
  cap: 'nội dung mẫu đủ dài để không bị bộ lọc caption ngắn loại',
  giay: 38,
  so_kenh: BigInt(2),
  so_video: BigInt(2),
  views: BigInt(1000),
  kenh_id: ['a', 'b'],
  kenh_ten: ['Page A', 'Page B'],
  ngay_dau: new Date('2026-07-10T03:00:00Z'),
  ngay_cuoi: new Date('2026-07-12T03:00:00Z'),
  url_mau: 'https://facebook.com/1',
  ...p,
});

const kenh = (p: Partial<DongVideoKenh>): DongVideoKenh => ({
  platform: 'facebook',
  kenh_id: 'k1',
  kenh_ten: 'Page A',
  video_trung: BigInt(0),
  tong_video: BigInt(0),
  ...p,
});

describe('mergeGroups — dựng danh sách nhóm trùng', () => {
  it('xếp nhóm phủ nhiều kênh lên trước, cùng số kênh thì lượt xem cao trước', () => {
    const ra = mergeGroups([
      nhom({ cap: 'ít kênh nhưng nhiều xem', so_kenh: BigInt(2), views: BigInt(900_000) }),
      nhom({ cap: 'nhiều kênh', so_kenh: BigInt(4), views: BigInt(10) }),
      nhom({ cap: 'ba kênh xem thấp', so_kenh: BigInt(3), views: BigInt(5) }),
      nhom({ cap: 'ba kênh xem cao', so_kenh: BigInt(3), views: BigInt(50) }),
    ]);
    expect(ra.map((x) => x.noi_dung)).toEqual([
      'nhiều kênh',
      'ba kênh xem cao',
      'ba kênh xem thấp',
      'ít kênh nhưng nhiều xem',
    ]);
  });

  it('trả ngày dạng chuỗi ISO chứ không phải Date — qua Redis Date đã thành chuỗi', () => {
    const [ra] = mergeGroups([nhom({})]);
    expect(typeof ra.ngay_dau).toBe('string');
    expect(typeof ra.ngay_cuoi).toBe('string');
    expect(ra.ngay_dau).toBe('2026-07-10T03:00:00.000Z');
  });

  it('ghép kenh_id với kenh_ten theo đúng cặp, giữ nguyên thứ tự SQL trả về', () => {
    const [ra] = mergeGroups([
      nhom({ kenh_id: ['x', 'y', 'z'], kenh_ten: ['Page X', 'Page Y', 'Page Z'], so_kenh: BigInt(3) }),
    ]);
    expect(ra.kenh).toEqual([
      { id: 'x', ten: 'Page X' },
      { id: 'y', ten: 'Page Y' },
      { id: 'z', ten: 'Page Z' },
    ]);
  });

  it('giay = null (YouTube Shorts không có trường độ dài) vẫn ra nhóm hợp lệ', () => {
    const [ra] = mergeGroups([nhom({ platform: 'youtube', giay: null })]);
    expect(ra.giay).toBeNull();
    expect(ra.platform).toBe('youtube');
  });
});

describe('computeByChannel — tỷ lệ trùng mỗi kênh', () => {
  it('tính đúng tỷ lệ và xếp giảm dần', () => {
    const ra = computeByChannel([
      kenh({ kenh_id: 'k1', kenh_ten: 'Huyk - Mê Chế Tác', video_trung: BigInt(69), tong_video: BigInt(69) }),
      kenh({ kenh_id: 'k2', kenh_ten: 'HuyK Trang Sức Đá Quý', video_trung: BigInt(35), tong_video: BigInt(85) }),
      kenh({ kenh_id: 'k3', kenh_ten: 'HuyK Chế Tác', video_trung: BigInt(71), tong_video: BigInt(72) }),
    ]);
    expect(ra.map((x) => x.ten)).toEqual(['Huyk - Mê Chế Tác', 'HuyK Chế Tác', 'HuyK Trang Sức Đá Quý']);
    expect(ra[0].ty_le).toBe(100);
    expect(ra[1].ty_le).toBe(98.6);
    expect(ra[2].ty_le).toBe(41.2);
  });

  it('kênh 0 video không chia cho 0', () => {
    const [ra] = computeByChannel([kenh({ video_trung: BigInt(0), tong_video: BigInt(0) })]);
    expect(ra.ty_le).toBe(0);
    expect(Number.isFinite(ra.ty_le)).toBe(true);
  });
});

describe('buildDuplicateAlerts — chỉ cảnh báo cấp KÊNH', () => {
  /**
   * Ngưỡng ≥3 kênh cho 75 cảnh báo ở kỳ 28 ngày và 333 ở kỳ 90 ngày, trong khi khối
   * "Cần chú ý" cắt ở 12 mục — cảnh báo trùng lặp sẽ đẩy hết lỗi đồng bộ và kênh im lặng
   * ra ngoài. Thêm nữa CanhBaoKenh vẽ avatar + tên kênh, mà một nhóm nội dung phủ 4 kênh
   * không có MỘT kênh nào để gắn.
   */
  it('nhóm nội dung KHÔNG bao giờ sinh cảnh báo, dù phủ 4 kênh', () => {
    const ra = buildDuplicateAlerts(
      computeByChannel([kenh({ video_trung: BigInt(1), tong_video: BigInt(100) })]),
    );
    expect(ra).toEqual([]);
  });

  it('kênh ≥20 video và ≥90% trùng thì báo, mức nặng', () => {
    const ra = buildDuplicateAlerts(
      computeByChannel([
        kenh({ kenh_ten: 'Huyk - Mê Chế Tác', video_trung: BigInt(69), tong_video: BigInt(69) }),
      ]),
    );
    expect(ra).toHaveLength(1);
    expect(ra[0].muc).toBe('b');
    expect(ra[0].kenh).toBe('Huyk - Mê Chế Tác');
    expect(ra[0].nhan).toBe('Trùng');
    expect(ra[0].noi_dung).toContain('69/69');
    expect(ra[0].noi_dung).toContain('100');
  });

  it('sàn 20 video: 19 video trùng 100% KHÔNG báo, 20 video trùng 100% CÓ báo', () => {
    const duoiSan = buildDuplicateAlerts(
      computeByChannel([kenh({ video_trung: BigInt(19), tong_video: BigInt(19) })]),
    );
    expect(duoiSan).toEqual([]);

    const alertsFromReady = buildDuplicateAlerts(
      computeByChannel([kenh({ video_trung: BigInt(20), tong_video: BigInt(20) })]),
    );
    expect(alertsFromReady).toHaveLength(1);
  });

  it('ngưỡng 90%: đúng 90% thì báo, 89,9% thì không', () => {
    const alertsAtThreshold = buildDuplicateAlerts(
      computeByChannel([kenh({ video_trung: BigInt(90), tong_video: BigInt(100) })]),
    );
    expect(alertsAtThreshold).toHaveLength(1);

    const duoiNguong = buildDuplicateAlerts(
      computeByChannel([kenh({ video_trung: BigInt(89), tong_video: BigInt(100) })]),
    );
    expect(duoiNguong).toEqual([]);
  });

  it('xếp kênh trùng nặng nhất lên trước', () => {
    const ra = buildDuplicateAlerts(
      computeByChannel([
        kenh({ kenh_id: 'a', kenh_ten: 'Chín mươi phần trăm', video_trung: BigInt(90), tong_video: BigInt(100) }),
        kenh({ kenh_id: 'b', kenh_ten: 'Trăm phần trăm', video_trung: BigInt(50), tong_video: BigInt(50) }),
      ]),
    );
    expect(ra.map((x) => x.kenh)).toEqual(['Trăm phần trăm', 'Chín mươi phần trăm']);
  });
});

describe('rutGonNoiDung', () => {
  it('giữ nguyên caption ngắn', () => {
    expect(rutGonNoiDung('kẻ thù của vàng #k105 #a1', 80)).toBe('kẻ thù của vàng #k105 #a1');
  });

  it('cắt caption dài và thêm dấu lược', () => {
    const longText = 'a'.repeat(200);
    const ra = rutGonNoiDung(longText, 80);
    expect(ra).toHaveLength(81); // 80 ký tự + '…'
    expect(ra.endsWith('…')).toBe(true);
  });

  it('không cắt lìa ký tự tổ hợp tiếng Việt — đếm theo ký tự hiển thị', () => {
    // 'ẻ' ở dạng tổ hợp (e + U+0309) chiếm 2 mã đơn vị; cắt thô bằng slice sẽ để lại dấu mồ côi.
    const to = 'kẻ thù của vàng '.repeat(20);
    const ra = rutGonNoiDung(to, 30);
    expect([...ra].length).toBeLessThanOrEqual(31);
    expect(ra.normalize('NFC')).toBe(ra);
  });

  it('caption rỗng hoặc null không làm vỡ', () => {
    expect(rutGonNoiDung('', 80)).toBe('');
    expect(rutGonNoiDung(null as unknown as string, 80)).toBe('');
  });
});

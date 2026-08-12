import { dungCanhBao, type DongDanhSachKenh, type DongKenh } from '../owned-stats.service';

/**
 * Vì sao sự cố 03/08–12/08/2026 chạy được 9 ngày mà không ai báo động.
 *
 * 94/95 fanpage cùng chết với `Request failed with status code 502`. Vòng lặp đầu của
 * dungCanhBao() đẻ ra 94 dòng "Đồng bộ lỗi" giống hệt nhau, rồi `slice(0, 12)` cắt còn 12.
 * Trang tổng quan vì thế hiện đúng 12 dòng — và 12 kênh hỏng trên tổng 95 đọc như cái đuôi
 * dài chấp nhận được, không phải một hệ thống sập. Không đâu trên trang nói con số 94.
 *
 * Tệ thêm một tầng: 12 chỗ bị lỗi đồng bộ chiếm sạch, nên cảnh báo "Tụt" và "Im lặng"
 * không bao giờ hiện được nữa — đúng lúc cần chúng nhất.
 *
 * Cách sửa: nhiều kênh CÙNG một thông báo lỗi thì gộp thành MỘT dòng có kèm số lượng.
 * Trần 12 dòng giữ nguyên (94 dòng thì không ai đọc), nhưng quy mô phải đọc được và các
 * loại cảnh báo khác phải còn chỗ.
 */
describe('dungCanhBao — cảnh báo phải nói được quy mô sự cố', () => {
  const LOI_502 = 'Request failed with status code 502';

  function kenh(i: number, loi: string | null): DongDanhSachKenh {
    return {
      platform: 'facebook',
      kenh_id: `page-${i}`,
      ten: `Fanpage ${i}`,
      avatar: '',
      followers: 1000n,
      dong_bo: new Date(),
      loi,
      hoat_dong: true,
      // Mới đăng hôm nay → không dính cảnh báo "Im lặng", giữ phép đo sạch.
      ngay_cuoi: new Date(),
    };
  }

  it('94 kênh cùng một lỗi gộp thành một dòng có ghi số 94', () => {
    const danhSach = Array.from({ length: 94 }, (_, i) => kenh(i, LOI_502));

    const canhBao = dungCanhBao(danhSach, [], 28);

    const dongLoi = canhBao.filter((c) => c.nhan === 'Lỗi');
    expect(dongLoi).toHaveLength(1);
    expect(dongLoi[0].noi_dung).toContain('94');
    expect(dongLoi[0].noi_dung).toContain(LOI_502);
  });

  it('nêu cả mẫu số để đọc ra mức độ: 94 trên 95 kênh', () => {
    const danhSach = [...Array.from({ length: 94 }, (_, i) => kenh(i, LOI_502)), kenh(94, null)];

    const dongLoi = dungCanhBao(danhSach, [], 28).find((c) => c.nhan === 'Lỗi')!;

    expect(dongLoi.noi_dung).toMatch(/94\s*\/\s*95/);
  });

  it('lỗi đồng bộ hàng loạt không còn chiếm hết chỗ của cảnh báo "Im lặng"', () => {
    const imLang = kenh(999, null);
    imLang.ten = 'Kênh bỏ hoang';
    imLang.ngay_cuoi = new Date(Date.now() - 30 * 86_400_000);
    const danhSach = [...Array.from({ length: 94 }, (_, i) => kenh(i, LOI_502)), imLang];

    const canhBao = dungCanhBao(danhSach, [], 28);

    expect(canhBao.some((c) => c.nhan === 'Im lặng' && c.kenh === 'Kênh bỏ hoang')).toBe(true);
  });

  it('vài kênh lẻ hỏng thì vẫn liệt kê từng kênh — gộp lúc đó chỉ làm mất tên', () => {
    const danhSach = [kenh(1, LOI_502), kenh(2, LOI_502), kenh(3, null)];

    const dongLoi = dungCanhBao(danhSach, [], 28).filter((c) => c.nhan === 'Lỗi');

    expect(dongLoi).toHaveLength(2);
    expect(dongLoi.map((c) => c.kenh).sort()).toEqual(['Fanpage 1', 'Fanpage 2']);
  });

  it('hai nguyên nhân khác nhau thì gộp thành hai nhóm, không trộn làm một', () => {
    const danhSach = [
      ...Array.from({ length: 5 }, (_, i) => kenh(i, LOI_502)),
      ...Array.from({ length: 4 }, (_, i) => kenh(100 + i, 'Token hết hạn')),
    ];

    const dongLoi = dungCanhBao(danhSach, [], 28).filter((c) => c.nhan === 'Lỗi');

    expect(dongLoi).toHaveLength(2);
    expect(dongLoi.map((c) => c.noi_dung).join(' ')).toContain('Token hết hạn');
  });

  it('kênh đã tắt vẫn không bị tính vào cảnh báo', () => {
    const tat = kenh(1, LOI_502);
    tat.hoat_dong = false;

    expect(dungCanhBao([tat], [], 28)).toHaveLength(0);
  });

  it('cảnh báo tụt lượt xem giữ nguyên cách tính cũ', () => {
    const theoKenh: DongKenh[] = [
      { platform: 'facebook', kenh_id: 'page-1', ky: 'nay', posts: 5n, views: 20_000n, likes: 0n, comments: 0n, shares: 0n },
      { platform: 'facebook', kenh_id: 'page-1', ky: 'truoc', posts: 5n, views: 100_000n, likes: 0n, comments: 0n, shares: 0n },
    ];

    const canhBao = dungCanhBao([kenh(1, null)], theoKenh, 28);

    expect(canhBao.some((c) => c.nhan === 'Tụt' && c.noi_dung.includes('80%'))).toBe(true);
  });
});

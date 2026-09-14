import { CONTENT_LINE_PATTERN, HASHTAG_PATTERN } from '../owned-stats.service';

/**
 * Khối "Tuyến nội dung" bỏ sót thẻ khi caption dán liền hai tuyến.
 *
 * Mẫu cũ `#(A[1-5])([^[:alnum:]]|$)` chặn biên phải bằng một nhóm khớp THẬT. Với cờ 'g',
 * lần khớp đầu nuốt luôn ký tự phân tách, nên "#A1#A2" mất dấu '#' của thẻ sau và chỉ ra
 * được A1. Đã đối chiếu thẳng trên Postgres 15:
 *
 *   caption               mẫu cũ     mẫu mới
 *   "#A1#A2 gop chung"    A1         A1, A2
 *   "#A10 khong phai"     (không)    (không)
 *
 * Mẫu mới chặn biên bằng lookahead `(?![[:alnum:]])` — không tiêu thụ ký tự nào, nhưng vẫn
 * loại được "#A10".
 *
 * Test này kiểm phần hình dạng của mẫu (chạy được ở CI, không cần DB). Phần hành vi thật do
 * Postgres quyết định và đã được đối chiếu tay như bảng trên.
 */
describe('Mẫu bắt tuyến nội dung #A1…#A5', () => {
  it('chặn biên bằng lookahead, không phải nhóm khớp thật', () => {
    expect(CONTENT_LINE_PATTERN).toContain('(?!');
    // Nhóm khớp thật là thứ đã gây lỗi — không được quay lại.
    expect(CONTENT_LINE_PATTERN).not.toContain('([^[:alnum:]]');
  });

  it('vẫn chỉ nhận A1 đến A5', () => {
    expect(CONTENT_LINE_PATTERN).toContain('A[1-5]');
  });

  /**
   * Bản dịch sang cú pháp JavaScript để chạy được ngoài Postgres: [[:alnum:]] của POSIX
   * tương đương [A-Za-z0-9] với dữ liệu ASCII trong các ca dưới đây.
   */
  const toJsRegex = (pattern: string): RegExp =>
    new RegExp(pattern.replace(/\[:alnum:\]/g, 'A-Za-z0-9'), 'gi');

  it.each([
    ['#A1#A2 gop chung', ['A1', 'A2']],
    ['clip hay #A3', ['A3']],
    ['#A10 khong phai tuyen', []],
    ['#a4 chu thuong', ['A4']],
    ['giua cau #A2, roi #A5.', ['A2', 'A5']],
    ['#A1 #A1 lap lai', ['A1', 'A1']],
  ])('caption %s bắt ra đúng %s', (caption, expected) => {
    const found = [...caption.matchAll(toJsRegex(CONTENT_LINE_PATTERN))].map((m) => m[1].toUpperCase());
    expect(found).toEqual(expected);
  });

  it('mẫu hashtag thường giữ nguyên độ dài tối thiểu 2 ký tự', () => {
    expect(HASHTAG_PATTERN).toContain('{2,64}');
    const found = [...'#ok #a #dulich2026'.matchAll(toJsRegex(HASHTAG_PATTERN))].map((m) => m[1]);
    expect(found).toEqual(['ok', 'dulich2026']);
  });
});

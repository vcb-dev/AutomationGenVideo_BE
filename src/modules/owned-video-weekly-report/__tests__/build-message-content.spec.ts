import { MAX_VIDEOS, FullWeekVideo, buildMessageContent, compactNumber } from '../build-message-content';

const MOT_TRIEU = 1_000_000;

let dem = 0;
const video = (v: Partial<FullWeekVideo> = {}): FullWeekVideo => ({
  post_id: `p${++dem}`,
  ten_fanpage: 'Huyk.vn',
  caption: 'Bên Trung cái vòng này hot lắm',
  permalink_url: 'https://facebook.com/x',
  published_at: new Date('2026-07-30T08:00:00.000Z'),
  view_count: 1_330_000,
  like_count: 12_000,
  comment_count: 340,
  share_count: 89,
  ...v,
});

describe('compactNumber — số lớn đọc bằng mắt', () => {
  it('dùng dấu phẩy thập phân kiểu Việt', () => {
    expect(compactNumber(1_240_000)).toBe('1,24M');
    expect(compactNumber(34_200)).toBe('34,2K');
  });

  it('số nhỏ giữ nguyên, không ép về K', () => {
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(0)).toBe('0');
  });

  it('tròn nghìn thì bỏ phần thập phân thừa', () => {
    expect(compactNumber(2000)).toBe('2K');
    expect(compactNumber(5_000_000)).toBe('5M');
  });

  it('số càng lớn càng ít chữ số lẻ — "763,85K" đọc vướng, "764K" là đủ', () => {
    expect(compactNumber(763_850)).toBe('764K');
    expect(compactNumber(149_200)).toBe('149K');
    expect(compactNumber(42_100)).toBe('42,1K');
    expect(compactNumber(7_560_000)).toBe('7,56M');
  });
});

describe('buildMessageContent', () => {
  /**
   * Đo trên 60 ngày thật: 8.431 video tròn 7 ngày, chỉ 9 video đạt 1 triệu view. Tức 85% số
   * ngày sẽ KHÔNG có video nào đạt — nên hành vi khi lô rỗng là quan trọng nhất ở đây.
   */
  it('không có video nào đạt ngưỡng thì trả null — tuyệt đối không gửi tin "hôm nay không có gì"', () => {
    expect(buildMessageContent([], MOT_TRIEU)).toBeNull();
  });

  it('nêu rõ ngưỡng trong tiêu đề để người đọc biết vì sao mình nhận tin này', () => {
    const tin = buildMessageContent([video()], MOT_TRIEU)!;
    expect(tin).toContain('1M view trong 7 ngày đầu');
  });

  it('một video thì có đủ tên fanpage, caption, bốn chỉ số và link', () => {
    const tin = buildMessageContent([video()], MOT_TRIEU)!;
    expect(tin).toContain('Huyk.vn');
    expect(tin).toContain('Bên Trung cái vòng này hot lắm');
    expect(tin).toContain('1,33M view');
    expect(tin).toContain('12K like');
    expect(tin).toContain('340 bình luận');
    expect(tin).toContain('89 chia sẻ');
    expect(tin).toContain('https://facebook.com/x');
  });

  it('có ngày đăng để biết video này của đợt nào', () => {
    const tin = buildMessageContent([video()], MOT_TRIEU)!;
    expect(tin).toContain('30/07/2026');
  });

  it('nhiều video thì xếp theo view giảm dần', () => {
    const tin = buildMessageContent(
      [video({ caption: 'ít hơn', view_count: 1_100_000 }), video({ caption: 'nhiều hơn', view_count: 4_000_000 })],
      MOT_TRIEU,
    )!;
    expect(tin.indexOf('nhiều hơn')).toBeLessThan(tin.indexOf('ít hơn'));
  });

  it(`quá ${MAX_VIDEOS} video thì cắt và nói còn bao nhiêu cái nữa`, () => {
    const lo = Array.from({ length: 25 }, (_, i) => video({ view_count: 1_000_000 + i }));
    const tin = buildMessageContent(lo, MOT_TRIEU)!;

    const blockCount = tin.split('\n').filter((d) => d.startsWith('▸')).length;
    expect(blockCount).toBe(MAX_VIDEOS);
    expect(tin).toContain('5 video khác');
  });

  it('không thừa dòng "và N video khác" khi đã liệt kê hết', () => {
    const tin = buildMessageContent([video(), video()], MOT_TRIEU)!;
    expect(tin).not.toMatch(/video khác/);
  });

  it('caption dài bị cắt để một video không chiếm cả màn hình', () => {
    const tin = buildMessageContent([video({ caption: 'x'.repeat(300) })], MOT_TRIEU)!;
    const longestRow = Math.max(...tin.split('\n').map((d) => d.length));
    expect(longestRow).toBeLessThan(140);
  });

  it('caption rỗng vẫn ra dòng đọc được, không để trống lửng', () => {
    const tin = buildMessageContent([video({ caption: '' })], MOT_TRIEU)!;
    expect(tin).toMatch(/\(không có mô tả\)/);
  });

  it('video thiếu link thì bỏ dòng link, không in "null"', () => {
    const tin = buildMessageContent([video({ permalink_url: null })], MOT_TRIEU)!;
    expect(tin).not.toContain('null');
  });

  it('ngưỡng đổi thì tiêu đề đổi theo', () => {
    const tin = buildMessageContent([video({ view_count: 600_000 })], 500_000)!;
    expect(tin).toContain('500K view');
  });
});

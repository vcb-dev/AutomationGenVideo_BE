import { Prisma } from '@prisma/client';
import {
  buildFacebookVideoClassificationIndex,
  facebookClassificationFilter,
  facebookVideoClassification,
  facebookVideoIdFromUrl,
} from '../scraper-aggregate-read.service';
import { UNCLASSIFIED_FILTER } from '../../../utils/task-auto/published-link-win-fail.util';

/**
 * Bộ lọc SQL phải ra đúng tập video mà facebookVideoClassification() gắn nhãn, nếu không thẻ video
 * sẽ hiện nhãn khác nhãn đang lọc.
 */

const HAI = { id: 'cls-hai', name: 'Hài hước' };
const KE = { id: 'cls-ke', name: 'Kể chuyện' };

const COT_POST = Prisma.sql`v.post_id`;
const COT_URL = Prisma.sql`v.permalink_url`;
const chu = (s: Prisma.Sql) => s.strings.join('?');

describe('facebookVideoIdFromUrl', () => {
  it('bóc id video từ /reel/<id> và /<page>/videos/<id>, có hay không query/dấu /', () => {
    expect(facebookVideoIdFromUrl('https://www.facebook.com/reel/1492065009044448/')).toBe('1492065009044448');
    expect(facebookVideoIdFromUrl('http://facebook.com/reel/123456789?s=single_unit')).toBe('123456789');
    expect(facebookVideoIdFromUrl('https://www.facebook.com/61550000000000/videos/987654321')).toBe('987654321');
  });

  it('link rút gọn / không có id video → null', () => {
    expect(facebookVideoIdFromUrl('https://www.facebook.com/share/r/1F5VhLyPnL/')).toBeNull();
    expect(facebookVideoIdFromUrl('')).toBeNull();
    expect(facebookVideoIdFromUrl(null)).toBeNull();
  });
});

describe('facebookVideoClassification', () => {
  it('ưu tiên task khớp tự động (post_id) hơn link dán, dòng đầu thắng khi trùng khoá', () => {
    const index = buildFacebookVideoClassificationIndex(
      [{ post_id: 'p1', ...HAI }, { post_id: 'p1', ...KE }],
      [{ video_id: '111', ...KE }, { video_id: '111', ...HAI }],
    );
    expect(facebookVideoClassification(index, 'p1', 'https://www.facebook.com/reel/111/')).toEqual(HAI);
    expect(facebookVideoClassification(index, 'p2', 'https://www.facebook.com/reel/111/')).toEqual(KE);
    expect(facebookVideoClassification(index, 'p3', 'https://www.facebook.com/reel/999/')).toBeNull();
  });
});

describe('facebookClassificationFilter', () => {
  const index = buildFacebookVideoClassificationIndex(
    [{ post_id: 'p1', ...HAI }, { post_id: 'p2', ...KE }],
    [{ video_id: '111', ...KE }, { video_id: '222', ...HAI }],
  );

  it('bỏ trống → null (không lọc)', () => {
    expect(facebookClassificationFilter(index, '', COT_POST, COT_URL)).toBeNull();
  });

  it('1 phân loại: post_id khớp tự động HOẶC id video trong link — link chỉ tính khi post_id chưa khớp tự động', () => {
    const sql = facebookClassificationFilter(index, 'cls-ke', COT_POST, COT_URL)!;
    expect(chu(sql)).toContain('v.post_id = ANY(');
    expect(chu(sql)).toContain('AND NOT');
    expect(sql.values).toEqual(expect.arrayContaining([['p2'], ['111'], ['p1', 'p2']]));
  });

  it('phân loại không có video nào → điều kiện luôn sai, không lỗi SQL vì mảng rỗng', () => {
    const sql = facebookClassificationFilter(index, 'cls-khong-co', COT_POST, COT_URL)!;
    expect(chu(sql)).toContain('FALSE');
  });

  it('"none" → loại mọi video đã nối được phân loại qua cả 2 đường', () => {
    const sql = facebookClassificationFilter(index, UNCLASSIFIED_FILTER, COT_POST, COT_URL)!;
    expect(chu(sql).trim().startsWith('NOT (')).toBe(true);
    expect(sql.values).toEqual(expect.arrayContaining([['p1', 'p2'], ['111', '222']]));
  });
});

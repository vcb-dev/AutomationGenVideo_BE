import { extractFacebookReelId, extractPostIdFromUrl } from '../facebook-url.util';

/**
 * extractFacebookReelId() — bóc ID Reels công khai từ link facebook.com/reel/{id}.
 *
 * Reels là Video NODE THUẦN: Graph API từ chối field kiểu Page Post (shares/insights)
 * trên node này. Nơi cào số liệu (facebook-owned-pages.service.ts fetchStatsForUrl) phải
 * dựa vào hàm này để route link reel — kể cả reel ĐÃ sync — sang endpoint video-node,
 * nếu không toàn bộ link reel Facebook trả "Không lấy được số liệu cho bài viết này".
 */
describe('extractFacebookReelId', () => {
  it('link /reel/{id} chuẩn (có / không có "/" cuối)', () => {
    expect(extractFacebookReelId('https://www.facebook.com/reel/1836282150691344/')).toBe('1836282150691344');
    expect(extractFacebookReelId('https://www.facebook.com/reel/1836282150691344')).toBe('1836282150691344');
  });

  it('bỏ qua query string / tracking param', () => {
    expect(
      extractFacebookReelId('https://www.facebook.com/reel/1591643832446397/?s=fb_shorts_profile&stack_idx=0'),
    ).toBe('1591643832446397');
  });

  it('host m.facebook.com vẫn nhận diện', () => {
    expect(extractFacebookReelId('https://m.facebook.com/reel/123456')).toBe('123456');
  });

  it('link KHÔNG phải reel → null (giữ nguyên đường Page Post)', () => {
    expect(extractFacebookReelId('https://www.facebook.com/mypage/videos/222/')).toBeNull();
    expect(extractFacebookReelId('https://www.facebook.com/watch/?v=222')).toBeNull();
    expect(extractFacebookReelId('https://www.facebook.com/mypage/posts/pfbid02abc')).toBeNull();
    // reel shortcode chữ-số (kiểu Instagram) không phải số thuần → null
    expect(extractFacebookReelId('https://www.instagram.com/reel/ABC123/')).toBeNull();
  });

  it('reel id không phải số thuần → null', () => {
    expect(extractFacebookReelId('https://www.facebook.com/reel/abc')).toBeNull();
  });

  it('URL sai định dạng / rỗng → null, không throw', () => {
    expect(extractFacebookReelId('not a url')).toBeNull();
    expect(extractFacebookReelId('')).toBeNull();
  });

  it('nhất quán với nhánh reel của extractPostIdFromUrl', () => {
    const url = 'https://www.facebook.com/reel/777/';
    expect(extractFacebookReelId(url)).toBe(extractPostIdFromUrl(url).postId);
  });
});

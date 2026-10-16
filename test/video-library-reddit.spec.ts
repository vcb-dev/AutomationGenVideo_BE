import { detectPlatformFromUrl, extractVideoId } from '../src/common/utils/video-url.util';
import { isShortLink } from '../src/common/utils/resolve-short-link.util';

/**
 * Bộ Sưu Tập nhận thêm nền tảng Reddit.
 * Mã video của Reddit = mã BÀI VIẾT (base36) — là khoá chống trùng và là tham số gọi TikHub
 * (post_id = t3_<mã>). Link v.redd.it/<mã> mang mã MEDIA nên phải giải về link bài trước.
 */
describe('Reddit — nhận diện nền tảng và mã bài viết', () => {
  it.each([
    ['https://www.reddit.com/r/Jewelry/comments/1ojnh50/my_new_ring/', '1ojnh50'],
    ['https://old.reddit.com/r/videos/comments/1abcdef/x/', '1abcdef'],
    ['https://reddit.com/comments/1ojnh50', '1ojnh50'],
    ['https://redd.it/1ojnh50', '1ojnh50'],
  ])('%s → mã %s', (url, id) => {
    expect(detectPlatformFromUrl(url)).toBe('reddit');
    expect(extractVideoId(url)).toBe(id);
  });

  it('link v.redd.it (mã media) KHÔNG bị nhầm thành mã bài, được coi là link rút gọn', () => {
    const url = 'https://v.redd.it/abc123xyz9';
    expect(detectPlatformFromUrl(url)).toBe('reddit');
    expect(extractVideoId(url)).toBe('');
    expect(isShortLink(url)).toBe(true);
  });

  it('link chia sẻ của app (/r/<sub>/s/<mã>) là link rút gọn, link bài thường thì không', () => {
    expect(isShortLink('https://www.reddit.com/r/Jewelry/s/AbC123xYz')).toBe(true);
    expect(isShortLink('https://www.reddit.com/r/Jewelry/comments/1ojnh50/x/')).toBe(false);
  });

  it('link subreddit / trang cá nhân không phải một video', () => {
    expect(extractVideoId('https://www.reddit.com/r/Jewelry/')).toBe('');
    expect(extractVideoId('https://www.reddit.com/user/someone/')).toBe('');
  });

  it('không làm lệch nhận diện các nền tảng cũ', () => {
    expect(detectPlatformFromUrl('https://www.douyin.com/video/7676122785118164474')).toBe('douyin');
    expect(extractVideoId('https://www.youtube.com/shorts/OOIs3kky2wc')).toBe('OOIs3kky2wc');
    expect(isShortLink('https://vt.tiktok.com/ZSabc/')).toBe(true);
  });
});

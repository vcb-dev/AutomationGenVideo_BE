import { FacebookExternalScraperReadService } from '../src/modules/facebook-external-scraper/facebook-external-scraper-read.service';
import { preferHostedImage } from '../src/common/utils/hosted-thumbnail-url.util';

/**
 * ThumbnailMigrationService ghi 'FAILED' vào cột *_drive_url khi đẩy ảnh lên kho lỗi. Đọc kiểu
 * `drive_url || url` thì chữ 'FAILED' thắng URL gốc, FE gắn nó vào <img src> và gọi
 * /dashboard/externalChannels/FAILED → 404, fanpage mất avatar.
 */

describe('Ảnh fanpage/reel — bỏ qua dấu FAILED của ThumbnailMigration', () => {
  it('preferHostedImage', () => {
    expect(preferHostedImage('https://res.cloudinary.com/x.jpg', 'https://fbcdn/a.jpg')).toBe('https://res.cloudinary.com/x.jpg');
    expect(preferHostedImage('FAILED', 'https://fbcdn/a.jpg')).toBe('https://fbcdn/a.jpg');
    expect(preferHostedImage(null, 'https://fbcdn/a.jpg')).toBe('https://fbcdn/a.jpg');
    expect(preferHostedImage('FAILED', 'FAILED')).toBeNull();
    expect(preferHostedImage('FAILED', null)).toBeNull();
  });

  it('API danh sách fanpage trả avatar gốc khi avatar_drive_url = FAILED', () => {
    const read = new FacebookExternalScraperReadService({} as any);
    const out = (read as any).serializeFanpage(
      {
        id: 36n,
        profile_id: '100063576820959',
        name: 'Dạy nghề chế tác vàng bạc',
        handle: 'daychetacvangbac.vn',
        avatar_url: 'https://scontent.fbcdn.net/a.jpg',
        avatar_drive_url: 'FAILED',
        followers_count: 0n,
        likes_count: 0n,
      },
      10,
    );
    expect(out.avatar_url).toBe('https://scontent.fbcdn.net/a.jpg');
  });
});

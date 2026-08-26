import { ThumbnailMigrationService, THUMBNAIL_TARGETS, publicIdOf } from '../thumbnail-migration.service';
import { isHostedThumbnailUrl } from '../../../../common/utils/hosted-thumbnail-url.util';

/**
 * Đẩy thumbnail/avatar từ CDN gốc lên Google Drive.
 *
 * AI service chỉ ghi URL CDN thô vào DB. CDN của Facebook/Douyin/TikTok chặn hotlink (403)
 * và URL còn kèm tham số hết hạn, nên BE phải tự tải ảnh về rồi đẩy lên kho của mình.
 * Ba lỗi dưới đây đều đã xảy ra trên production trước khi có test này.
 */

describe('publicIdOf — không hai bảng nào được ghi đè ảnh của nhau', () => {
  it('mọi target sinh public_id khác nhau cho cùng một id', () => {
    // scraper_tiktok_videos và scraper_tiktok_profile_videos từng dùng chung prefix
    // 'tiktok' trong cùng folder 'TikTok'. Id của hai bảng là hai chuỗi autoincrement
    // độc lập nên trùng nhau gần như chắc chắn, và upload dùng overwrite: true — ảnh lên
    // sau đè ảnh lên trước, cả hai bản ghi DB cùng trỏ vào một ảnh sai.
    const ids = THUMBNAIL_TARGETS.map((t) => publicIdOf(t, 42n));

    expect(new Set(ids).size).toBe(THUMBNAIL_TARGETS.length);
  });

  it('phủ hết bảng video của mọi nền tảng — thiếu bảng nào là nền tảng đó vĩnh viễn không có ảnh', () => {
    // scraper_youtube_shorts từng bị bỏ quên: 38 short có URL ảnh đầy đủ nhưng 0% vào được
    // kho, và chờ bao lâu cũng vô ích vì cron không bao giờ đọc tới bảng đó.
    const VIDEO_TABLES = [
      'scraper_facebook_reels',
      'scraper_instagram_reels',
      'scraper_youtube_shorts',
      'scraper_tiktok_videos',
      'scraper_tiktok_profile_videos',
      'scraper_douyin_videos',
      'scraper_xiaohongshu_videos',
      'scraper_kuaishou_videos',
      'scraper_bilibili_videos',
    ];
    const declared = THUMBNAIL_TARGETS.map((t) => t.table);

    expect(VIDEO_TABLES.filter((t) => !declared.includes(t))).toEqual([]);
  });

  it('phủ hết cột ảnh tác giả — cột này hiển thị trên thẻ video nhưng từng không ai đẩy lên kho', () => {
    // Năm bảng dưới đây lưu ảnh tác giả ngay trong bảng video (không lấy từ bảng profile),
    // và read service trả thẳng ra UI. Không khai báo thì URL CDN gốc nằm đó tới lúc hết
    // hạn rồi 403 — đo thực tế trên TikTok: 442/442 dòng author_avatar đều đã chết.
    const AUTHOR_AVATAR_TABLES = [
      'scraper_tiktok_videos',
      'scraper_douyin_videos',
      'scraper_xiaohongshu_videos',
      'scraper_kuaishou_search_videos',
      'scraper_bilibili_search_videos',
    ];
    const declared = THUMBNAIL_TARGETS.filter((t) => t.sourceColumn === 'author_avatar').map((t) => t.table);

    expect(AUTHOR_AVATAR_TABLES.filter((t) => !declared.includes(t))).toEqual([]);
  });

  it('public_id gắn với folder nền tảng nên hai nền tảng có thể trùng tên tệp', () => {
    const facebook = THUMBNAIL_TARGETS.find((t) => t.table === 'scraper_facebook_reels')!;

    expect(publicIdOf(facebook, 7n)).toContain('facebook');
    expect(publicIdOf(facebook, 7n)).toContain('fb-reel-7');
  });
});

describe('isHostedThumbnailUrl — nhận diện ảnh đã nằm trong kho của mình', () => {
  it('nhận URL Cloudinary', () => {
    // Thiếu nhánh này thì scraper cào lại sẽ ghi đè URL Cloudinary về CDN gốc, phút sau
    // migration upload lại — vòng lặp đốt quota, và giữa hai bước UI hiện URL hay bị 403.
    expect(isHostedThumbnailUrl('https://res.cloudinary.com/demo/image/upload/v1/a.jpg')).toBe(true);
  });

  it('nhận URL Google Drive (kho cũ, vẫn còn dữ liệu)', () => {
    expect(isHostedThumbnailUrl('https://drive.google.com/uc?id=abc')).toBe(true);
    expect(isHostedThumbnailUrl('https://lh3.googleusercontent.com/d/abc')).toBe(true);
  });

  it('KHÔNG nhận URL CDN gốc — đó là thứ cần được thay thế', () => {
    expect(isHostedThumbnailUrl('https://scontent.fdmm2-3.fna.fbcdn.net/v/t39.jpg')).toBe(false);
    expect(isHostedThumbnailUrl('https://p16-sign-va.tiktokcdn.com/x.jpeg')).toBe(false);
  });

  it('rỗng/null thì không tính là đã lưu', () => {
    expect(isHostedThumbnailUrl('')).toBe(false);
    expect(isHostedThumbnailUrl(null)).toBe(false);
    expect(isHostedThumbnailUrl(undefined)).toBe(false);
  });
});

describe('ThumbnailMigrationService — dòng hỏng không được chặn cả hàng đợi', () => {
  const TARGET = {
    table: 'scraper_facebook_reels',
    sourceColumn: 'thumbnail_url',
    destColumn: 'thumbnail_drive_url',
    filenamePrefix: 'fb-reel',
    platform: 'Facebook',
  };

  /** `failsFor` mô phỏng CDN Facebook trả 403 vì tham số oe= đã hết hạn. */
  function build(
    rows: Array<{ id: bigint; src: string }>,
    failsFor: (url: string) => boolean = () => true,
  ) {
    const prisma: any = {
      $queryRawUnsafe: jest.fn(async () => rows),
      $executeRawUnsafe: jest.fn(async () => 1),
    };
    const googleDrive: any = {
      isAvailable: () => true,
      uploadThumbnailFromUrl: jest.fn(async (url: string) =>
        failsFor(url) ? '' : 'https://lh3.googleusercontent.com/d/abc',
      ),
    };
    const service = new ThumbnailMigrationService(prisma, googleDrive);
    return { service, prisma, uploader: googleDrive };
  }

  it('không thử lại ngay dòng vừa hỏng ở lượt chạy kế tiếp', async () => {
    // ORDER BY id DESC LIMIT 10 + không ghi dấu thất bại = mỗi phút lại lấy đúng 10 dòng
    // chết đó. URL CDN Facebook hết hạn là hỏng vĩnh viễn, nên migration đứng im mãi mãi
    // và không bao giờ chạm tới dòng cũ hơn.
    const rows = [{ id: 1n, src: 'https://scontent.fbcdn.net/hong.jpg' }];
    const { service, uploader } = build(rows);

    await (service as any).migrateTarget(TARGET);
    expect(uploader.uploadThumbnailFromUrl).toHaveBeenCalledTimes(1);

    await (service as any).migrateTarget(TARGET);
    expect(uploader.uploadThumbnailFromUrl).toHaveBeenCalledTimes(1);
  });

  it('dòng hỏng bị bỏ qua nhưng dòng lành phía sau vẫn được xử lý', async () => {
    const rows = [
      { id: 1n, src: 'https://scontent.fbcdn.net/hong.jpg' },
      { id: 2n, src: 'https://scontent.fbcdn.net/lanh.jpg' },
    ];
    const { service, uploader } = build(rows, (url) => url.includes('hong'));

    await (service as any).migrateTarget(TARGET);

    // Lượt sau dòng 1 đang trong thời gian chờ, dòng 2 vẫn phải được thử lại.
    uploader.uploadThumbnailFromUrl.mockClear();
    await (service as any).migrateTarget(TARGET);

    const triedUrls = uploader.uploadThumbnailFromUrl.mock.calls.map((c: any[]) => c[0]);
    expect(triedUrls).not.toContain('https://scontent.fbcdn.net/hong.jpg');
    expect(triedUrls).toContain('https://scontent.fbcdn.net/lanh.jpg');
  });

  it('target ghi đè tại chỗ phải cất URL CDN gốc lại trước khi đè lên', async () => {
    // 5 target inPlace ghi URL kho đè thẳng lên cột nguồn. Trước khi có cột lưu bản gốc,
    // URL CDN ban đầu mất vĩnh viễn: Cloudinary xoá asset (Free plan) hoặc upload sai ảnh
    // là không còn đường lấy lại, kể cả cào lại cũng không vì isHostedThumbnailUrl giữ
    // nguyên URL kho. COALESCE để lần chạy sau không đè bản gốc bằng URL Cloudinary.
    const inPlaceTarget = {
      table: 'scraper_douyin_videos',
      sourceColumn: 'preview_image',
      destColumn: 'preview_image',
      originalColumn: 'preview_image_original_url',
      filenamePrefix: 'douyin',
      inPlace: true,
      platform: 'Douyin',
    };
    const rows = [{ id: 5n, src: 'https://p3-sign.douyinpic.com/goc.jpeg' }];
    const { service, prisma } = build(rows, () => false);

    await (service as any).migrateTarget(inPlaceTarget);

    const [sql, ...params] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('"preview_image_original_url" = COALESCE');
    expect(params).toContain('https://p3-sign.douyinpic.com/goc.jpeg');
  });

  it('target thường (có cột đích riêng) không cần cất bản gốc', async () => {
    // Cột nguồn vẫn còn nguyên nên không có gì để mất.
    const rows = [{ id: 5n, src: 'https://scontent.fbcdn.net/a.jpg' }];
    const { service, prisma } = build(rows, () => false);

    await (service as any).migrateTarget(TARGET);

    const [sql] = prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).not.toContain('COALESCE');
  });

  it('upload thành công thì xoá dấu hỏng, lần sau vẫn xử lý bình thường', async () => {
    const rows = [{ id: 1n, src: 'https://scontent.fbcdn.net/anh.jpg' }];
    const { service, prisma } = build(rows, () => false);

    await (service as any).migrateTarget(TARGET);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);

    // Không còn dấu hỏng nào thì lượt sau vẫn xử lý bình thường, không bị chờ oan.
    expect((service as any).failures.size).toBe(0);
    await (service as any).migrateTarget(TARGET);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from './google-drive-storage.service';
import { notHostedThumbnailSql } from '../../../common/utils/hosted-thumbnail-url.util';
import { normalizeThumbnailSourceUrl, supportedThumbnailSql } from '../../../common/utils/thumbnail-source.util';


export interface ThumbnailTarget {
  table: string;
  sourceColumn?: string;
  /** Raw SQL expression overriding sourceColumn (e.g. COALESCE across 2 columns). */
  sourceExpr?: string;
  destColumn: string;
  filenamePrefix: string;
  /** Uploaded URL overwrites sourceColumn in place instead of a separate destColumn. */
  inPlace?: boolean;
  /**
   * Cột cất URL CDN gốc trước khi bị ghi đè. Bắt buộc với mọi target `inPlace`: không có
   * nó thì URL ban đầu mất vĩnh viễn, kho ảnh mất tệp là hết đường khôi phục.
   */
  originalColumn?: string;
  /** Tên hiển thị nền tảng — quyết định folder con trong root/platform. */
  platform: string;
}

const BATCH_SIZE = 10;

// Lấy dư rồi lọc bỏ dòng đang trong thời gian chờ, để một nhúm dòng chết không chiếm hết
// chỗ của batch và chặn đứng cả hàng đợi.
const SCAN_SIZE = BATCH_SIZE * 5;

// Backoff khi upload hỏng, theo số lần đã thử. URL CDN Facebook hết hạn là hỏng vĩnh viễn,
// nên sau vài lần phải giãn ra hẳn thay vì thử lại mỗi phút.
const RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

// AI service (scraper) chỉ ghi CDN URL thô vào các cột này. BE tự tải ảnh + đẩy lên
// Google Drive định kỳ.
export const THUMBNAIL_TARGETS: ThumbnailTarget[] = [
  { table: 'scraper_fanpages', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'fb-scraped-avatar', platform: 'Facebook' },
  { table: 'scraper_facebook_reels', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'fb-reel', platform: 'Facebook' },
  { table: 'video_management_managedfacebookpage', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'fb-managed-avatar', platform: 'Facebook' },
  { table: 'video_management_ownedvideocontent', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'fb-owned', platform: 'Facebook' },
  { table: 'scraper_douyin_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'douyin-avatar', platform: 'Douyin' },
  { table: 'scraper_douyin_videos', sourceColumn: 'preview_image', destColumn: 'preview_image', originalColumn: 'preview_image_original_url', filenamePrefix: 'douyin', inPlace: true, platform: 'Douyin' },
  { table: 'scraper_tiktok_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'tiktok-avatar', platform: 'TikTok' },
  { table: 'scraper_tiktok_videos', sourceColumn: 'preview_image', destColumn: 'preview_image', originalColumn: 'preview_image_original_url', filenamePrefix: 'tiktok', inPlace: true, platform: 'TikTok' },
  // Prefix phải khác 'tiktok' của scraper_tiktok_videos: hai bảng có hai chuỗi id độc lập
  // nên id trùng nhau là chuyện thường, mà upload dùng overwrite: true — trùng public_id
  // là ảnh bảng này đè ảnh bảng kia.
  { table: 'scraper_tiktok_profile_videos', sourceColumn: 'cover_image', destColumn: 'cover_image', originalColumn: 'cover_image_original_url', filenamePrefix: 'tiktok-profile', inPlace: true, platform: 'TikTok' },
  { table: 'scraper_instagram_profiles', sourceExpr: `COALESCE(NULLIF("avatar_url", ''), NULLIF("hd_avatar_url", ''))`, destColumn: 'avatar_drive_url', filenamePrefix: 'ig-avatar', platform: 'Instagram' },
  { table: 'scraper_instagram_reels', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'ig-reel', platform: 'Instagram' },
  // Bảng này từng bị bỏ quên: 38 short có URL ảnh đầy đủ nhưng 0% vào được kho, và chờ
  // bao lâu cũng vô ích vì cron không đọc tới. Chỉ có avatar kênh YouTube được khai báo.
  { table: 'scraper_youtube_shorts', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'yt-short', platform: 'Youtube' },
  { table: 'scraper_xiaohongshu_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'xhs', platform: 'Xiaohongshu' },
  { table: 'scraper_kuaishou_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'kuaishou-avatar', platform: 'Kuaishou' },
  { table: 'scraper_kuaishou_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'kuaishou', platform: 'Kuaishou' },
  { table: 'scraper_kuaishou_search_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_url', originalColumn: 'thumbnail_original_url', filenamePrefix: 'kuaishou-search', inPlace: true, platform: 'Kuaishou' },
  { table: 'scraper_bilibili_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'bilibili-avatar', platform: 'Bilibili' },
  { table: 'scraper_bilibili_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'bilibili', platform: 'Bilibili' },
  { table: 'scraper_bilibili_search_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_url', originalColumn: 'thumbnail_original_url', filenamePrefix: 'bilibili-search', inPlace: true, platform: 'Bilibili' },
  // ─── Ảnh tác giả nằm ngay trong bảng video ────────────────────────────────────────
  // Năm bảng này không lấy ảnh tác giả từ bảng profile mà lưu thẳng trong bảng video, và
  // read service trả ra UI. Thiếu khai báo thì URL CDN gốc nằm đó tới lúc hết hạn rồi 403.
  { table: 'scraper_tiktok_videos', sourceColumn: 'author_avatar', destColumn: 'author_avatar_drive_url', filenamePrefix: 'tiktok-author', platform: 'TikTok' },
  { table: 'scraper_douyin_videos', sourceColumn: 'author_avatar', destColumn: 'author_avatar_drive_url', filenamePrefix: 'douyin-author', platform: 'Douyin' },
  { table: 'scraper_xiaohongshu_videos', sourceColumn: 'author_avatar', destColumn: 'author_avatar_drive_url', filenamePrefix: 'xhs-author', platform: 'Xiaohongshu' },
  { table: 'scraper_kuaishou_search_videos', sourceColumn: 'author_avatar', destColumn: 'author_avatar_drive_url', filenamePrefix: 'kuaishou-search-author', platform: 'Kuaishou' },
  { table: 'scraper_bilibili_search_videos', sourceColumn: 'author_avatar', destColumn: 'author_avatar_drive_url', filenamePrefix: 'bilibili-search-author', platform: 'Bilibili' },
];

function sourceExprOf(target: ThumbnailTarget): string {
  return target.sourceExpr ?? `"${target.sourceColumn}"`;
}

/**
 * Định danh ảnh trong kho: `<platform>/<prefix>-<id>`.
 *
 * Phải là duy nhất trên toàn bộ THUMBNAIL_TARGETS cho cùng một id — hai target trùng
 * định danh sẽ ghi đè ảnh của nhau, vì tên tệp tải lên chỉ gồm prefix và id.
 */
export function publicIdOf(target: ThumbnailTarget, id: bigint | number): string {
  return `${target.platform.toLowerCase().trim()}/${target.filenamePrefix}-${id}`;
}

@Injectable()
export class ThumbnailMigrationService {
  private readonly logger = new Logger(ThumbnailMigrationService.name);
  private isRunning = false;

  // Dòng upload hỏng + thời điểm được thử lại, khoá theo "<bảng>#<id>".
  // Giữ trong RAM chứ không thêm cột DB: sau khi restart thử lại từ đầu là chấp nhận được,
  // còn thêm cột thì phải chạy migration trên bảng đang có dữ liệu thật.
  private readonly failures = new Map<string, { attempts: number; nextTryAt: number }>();

  private isCoolingDown(table: string, id: bigint): boolean {
    const entry = this.failures.get(`${table}#${id}`);
    return !!entry && Date.now() < entry.nextTryAt;
  }

  private markFailure(table: string, id: bigint): void {
    const key = `${table}#${id}`;
    const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
    const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
    this.failures.set(key, { attempts, nextTryAt: Date.now() + backoff });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async migrateThumbnails(): Promise<void> {
    if (this.isRunning) return;
    if (!this.googleDrive.isAvailable()) return;

    this.isRunning = true;
    try {
      for (const target of THUMBNAIL_TARGETS) {
        await this.migrateTarget(target);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async migrateTarget(target: ThumbnailTarget): Promise<void> {
    const { table, destColumn, filenamePrefix, inPlace, platform, originalColumn } = target;
    const src = sourceExprOf(target);
    // Loại định dạng trình duyệt không hiển thị được (.kvif của Kuaishou) ngay từ truy vấn —
    // 4312/6177 thumbnail Kuaishou thuộc loại này, để lọt vào batch là chiếm chỗ của dòng
    // tải được và làm log ngập lỗi mỗi phút.
    const supported = supportedThumbnailSql(src);
    const whereClause = inPlace
      ? `${src} IS NOT NULL AND ${src} <> '' AND ${supported} AND ${notHostedThumbnailSql(src)}`
      : `${src} IS NOT NULL AND ${src} <> '' AND ${supported} AND ("${destColumn}" IS NULL OR "${destColumn}" = '')`;

    let scanned: Array<{ id: bigint; src: string }>;
    try {
      // Quét dư SCAN_SIZE rồi mới lọc: nếu chỉ lấy đúng BATCH_SIZE thì một nhúm dòng chết
      // nằm đầu (ORDER BY id DESC) sẽ chiếm hết chỗ và chặn đứng mọi dòng phía sau.
      scanned = await this.prisma.$queryRawUnsafe<Array<{ id: bigint; src: string }>>(
        `SELECT id, ${src} AS src FROM "${table}" WHERE ${whereClause} ORDER BY id DESC LIMIT ${SCAN_SIZE}`,
      );
    } catch (err: any) {
      this.logger.error(`[ThumbnailMigration] Query failed for ${table}: ${err.message}`);
      return;
    }

    const rows = scanned.filter((r) => !this.isCoolingDown(table, r.id)).slice(0, BATCH_SIZE);

    for (const row of rows) {
      const filename = `${filenamePrefix}-${row.id}`;
      // rednotecdn trả 498 với query đầy đủ nhưng 200 khi bỏ query — xem thumbnail-source.util.
      const sourceUrl = normalizeThumbnailSourceUrl(row.src);
      const uploadedUrl = await this.googleDrive.uploadThumbnailFromUrl(sourceUrl, `${filename}.jpg`, platform);

      if (!uploadedUrl) {
        this.markFailure(table, row.id);
        continue;
      }
      this.failures.delete(`${table}#${row.id}`);

      try {
        // Target ghi đè tại chỗ: cất URL CDN gốc lại cùng lúc. COALESCE để lần chạy sau
        // không đè bản gốc bằng chính URL Cloudinary vừa ghi ở lần trước.
        if (originalColumn) {
          await this.prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${destColumn}" = $1, "${originalColumn}" = COALESCE("${originalColumn}", $3) WHERE id = $2`,
            uploadedUrl,
            row.id,
            row.src,
          );
        } else {
          await this.prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${destColumn}" = $1 WHERE id = $2`,
            uploadedUrl,
            row.id,
          );
        }
        this.logger.log(`[ThumbnailMigration] ${table}#${row.id} → Drive OK`);
      } catch (err: any) {
        this.logger.error(`[ThumbnailMigration] Update failed ${table}#${row.id}: ${err.message}`);
      }
    }
  }
}

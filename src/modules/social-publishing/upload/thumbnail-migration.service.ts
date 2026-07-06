import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from './google-drive-storage.service';

interface ThumbnailTarget {
  table: string;
  sourceColumn?: string;
  /** Raw SQL expression overriding sourceColumn (e.g. COALESCE across 2 columns). */
  sourceExpr?: string;
  destColumn: string;
  filenamePrefix: string;
  /** Drive URL overwrites sourceColumn in place instead of a separate destColumn. */
  inPlace?: boolean;
}

const BATCH_SIZE = 10;

// AI service (scraper) chỉ ghi CDN URL thô vào các cột này. BE tự tải ảnh + đẩy lên
// Drive định kỳ — AI không còn gọi ngược lại BE để nhờ upload nữa.
const TARGETS: ThumbnailTarget[] = [
  { table: 'scraper_fanpages', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'fb-scraped-avatar' },
  { table: 'scraper_facebook_reels', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'fb-reel' },
  { table: 'video_management_managedfacebookpage', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'fb-managed-avatar' },
  { table: 'video_management_ownedvideocontent', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'fb-owned' },
  { table: 'scraper_douyin_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'douyin-avatar' },
  { table: 'scraper_douyin_videos', sourceColumn: 'preview_image', destColumn: 'preview_image', filenamePrefix: 'douyin', inPlace: true },
  { table: 'scraper_tiktok_profiles', sourceColumn: 'avatar_url', destColumn: 'avatar_drive_url', filenamePrefix: 'tiktok-avatar' },
  { table: 'scraper_tiktok_videos', sourceColumn: 'preview_image', destColumn: 'preview_image', filenamePrefix: 'tiktok', inPlace: true },
  { table: 'scraper_tiktok_profile_videos', sourceColumn: 'cover_image', destColumn: 'cover_image', filenamePrefix: 'tiktok', inPlace: true },
  { table: 'scraper_instagram_profiles', sourceExpr: `COALESCE(NULLIF("avatar_url", ''), NULLIF("hd_avatar_url", ''))`, destColumn: 'avatar_drive_url', filenamePrefix: 'ig-avatar' },
  { table: 'scraper_instagram_reels', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'ig-reel' },
  { table: 'scraper_xiaohongshu_videos', sourceColumn: 'thumbnail_url', destColumn: 'thumbnail_drive_url', filenamePrefix: 'xhs' },
];

function sourceExprOf(target: ThumbnailTarget): string {
  return target.sourceExpr ?? `"${target.sourceColumn}"`;
}

@Injectable()
export class ThumbnailMigrationService {
  private readonly logger = new Logger(ThumbnailMigrationService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async migrateThumbnails(): Promise<void> {
    if (this.isRunning || !this.googleDrive.isAvailable()) return;
    this.isRunning = true;
    try {
      for (const target of TARGETS) {
        await this.migrateTarget(target);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async migrateTarget(target: ThumbnailTarget): Promise<void> {
    const { table, destColumn, filenamePrefix, inPlace } = target;
    const src = sourceExprOf(target);
    const whereClause = inPlace
      ? `${src} IS NOT NULL AND ${src} <> '' AND ${src} NOT LIKE '%drive.google.com%' AND ${src} NOT LIKE '%googleusercontent.com%'`
      : `${src} IS NOT NULL AND ${src} <> '' AND ("${destColumn}" IS NULL OR "${destColumn}" = '')`;

    let rows: Array<{ id: bigint; src: string }>;
    try {
      rows = await this.prisma.$queryRawUnsafe<Array<{ id: bigint; src: string }>>(
        `SELECT id, ${src} AS src FROM "${table}" WHERE ${whereClause} ORDER BY id DESC LIMIT ${BATCH_SIZE}`,
      );
    } catch (err: any) {
      this.logger.error(`[ThumbnailMigration] Query failed for ${table}: ${err.message}`);
      return;
    }

    for (const row of rows) {
      const filename = `${filenamePrefix}-${row.id}.jpg`;
      const driveUrl = await this.googleDrive.uploadThumbnailFromUrl(row.src, filename);
      if (!driveUrl) continue;

      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "${destColumn}" = $1 WHERE id = $2`,
          driveUrl,
          row.id,
        );
        this.logger.log(`[ThumbnailMigration] ${table}#${row.id} → Drive OK`);
      } catch (err: any) {
        this.logger.error(`[ThumbnailMigration] Update failed ${table}#${row.id}: ${err.message}`);
      }
    }
  }
}

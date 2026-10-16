import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/** Nơi ảnh được thả vào — để biết ảnh đến từ tab nào khi duyệt nhãn. */
export type TrainingImageSource = 'cutout' | 'held-swap' | 'held-auto';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** "Túi Xách Hà Trúc TX004-22" → "tui-xach-ha-truc-tx004-22" — tên file an toàn trên Drive và mọi hệ điều hành. */
export function slugForFileName(text: string | undefined, maxLength = 60): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Lưu lại ẢNH GỐC người dùng thả vào tab Tạo ảnh sản phẩm lên Google Drive công ty — để sau này người dùng vào duyệt /
 * sửa nhãn (trang duyệt nhãn ở bag-detector-training) rồi mới cho model nhận diện túi học tiếp. Người dùng chốt 15/10:
 * người thả ảnh KHÔNG phải làm gì thêm, máy KHÔNG tự học từ kết quả của chính nó (đã thử 10/10: học nhãn tự gán làm
 * model kém đi 82,2% → 79,2%), chỉ lưu ảnh chờ duyệt.
 *
 * Chạy nền, không chờ: lỗi Drive / Drive chưa cấu hình chỉ ghi log, không làm hỏng lượt tạo ảnh. Ảnh trùng (cùng nội
 * dung) chỉ lưu một lần mỗi tiến trình — người dùng hay thả lại cùng ảnh khi thử nền khác.
 * Cây thư mục: <GOOGLE_DRIVE_FOLDER_ID>/<FOLDER_NAME>/<YYYY-MM-DD>/<tên SP>__<băm>.<đuôi> (resolveDatedFolder).
 */
@Injectable()
export class ProductImageTrainingArchiveService {
  static readonly FOLDER_NAME = 'Tạo ảnh SP - ảnh chờ duyệt nhãn';
  /** Nhớ chừng này ảnh gần nhất để bỏ ảnh trùng — đủ cho vài ngày dùng, không phình bộ nhớ. */
  static readonly SEEN_LIMIT = 5000;

  private readonly logger = new Logger(ProductImageTrainingArchiveService.name);
  private readonly seen = new Set<string>();

  constructor(private readonly drive: GoogleDriveStorageService) {}

  /** Lưu ảnh (chạy nền) — trả Promise để test chờ được; nơi gọi không cần await. */
  archive(file: Express.Multer.File | undefined, info: { source: TrainingImageSource; productName?: string }): Promise<void> {
    if (!file?.buffer?.length) return Promise.resolve();
    return this.save(file, info).catch((err: any) => {
      this.logger.warn(`[ProductImage] Không lưu được ảnh chờ duyệt nhãn lên Drive: ${err?.message ?? err}`);
    });
  }

  private async save(file: Express.Multer.File, info: { source: TrainingImageSource; productName?: string }) {
    if (!this.drive.isAvailable()) {
      this.logger.warn(
        '[ProductImage] Google Drive công ty chưa cấu hình (COMPANY_DRIVE_PROVIDER, GOOGLE_DRIVE_FOLDER_ID, quyền truy cập) — ' +
          'không lưu ảnh chờ duyệt nhãn.',
      );
      return;
    }
    const hash = createHash('sha1').update(file.buffer).digest('hex').slice(0, 16);
    if (this.seen.has(hash)) return;
    this.remember(hash);
    const extension = EXTENSION_BY_MIME[file.mimetype] ?? 'jpg';
    const name = `${slugForFileName(info.productName) || 'anh-sp'}__${info.source}__${hash}.${extension}`;
    const tempPath = path.join(os.tmpdir(), `product-image-archive-${hash}.${extension}`);
    try {
      const folderId = await this.drive.resolveDatedFolder(ProductImageTrainingArchiveService.FOLDER_NAME);
      await fs.promises.writeFile(tempPath, file.buffer);
      await this.drive.uploadFromPath(tempPath, name, file.mimetype, undefined, { folderId });
    } catch (err) {
      // Lần sau thả lại cùng ảnh vẫn thử lưu.
      this.seen.delete(hash);
      throw err;
    } finally {
      await fs.promises.rm(tempPath, { force: true });
    }
  }

  private remember(hash: string) {
    this.seen.add(hash);
    if (this.seen.size > ProductImageTrainingArchiveService.SEEN_LIMIT) {
      this.seen.delete(this.seen.values().next().value as string);
    }
  }
}

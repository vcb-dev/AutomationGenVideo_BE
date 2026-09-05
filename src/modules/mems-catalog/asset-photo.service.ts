import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  IMAGE_EXTENSION,
  IMAGE_MIME,
  SUPPORTED_IMAGE_LABEL,
  sniffImageKind,
} from '../../common/mems/image-file-type';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/** Thư mục dự phòng khi chưa cấu hình Google Drive — giống cách task-auto đang làm. */
export const MEMS_PHOTO_DIR = path.join(process.cwd(), 'uploads', 'mems');

/**
 * Trần kích thước ảnh. Xuất ra ngoài để controller đặt luôn cho Multer.
 *
 * Kiểm ở tầng service là quá muộn: lúc đó Multer đã nạp trọn file vào RAM rồi, nên một video
 * tải nhầm vẫn đủ hạ máy chủ trước khi dòng kiểm tra nào chạy tới.
 */
export const MEMS_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Ảnh này chụp để làm gì.
 *
 * `CATALOG` là ảnh hồ sơ của máy, hiện trong thư viện ảnh và làm ảnh đại diện ở bảng kho.
 * `HANDOVER` và `RETURN` là chứng cứ của một lượt giao/nhận — chúng đi qua cùng endpoint tải
 * ảnh nên nếu không phân biệt thì mỗi lượt mượn lại đẩy thêm ảnh vào thư viện của máy, và ảnh
 * đại diện có thể rơi trúng một tấm chụp vết xước.
 */
export const PHOTO_PURPOSE = {
  CATALOG: 'CATALOG',
  HANDOVER: 'HANDOVER',
  RETURN: 'RETURN',
} as const;

export type PhotoPurpose = (typeof PHOTO_PURPOSE)[keyof typeof PHOTO_PURPOSE];

@Injectable()
export class AssetPhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleDrive: GoogleDriveStorageService,
  ) {}

  /**
   * Đặt tên file theo mã máy để lúc mở thư mục lưu trữ còn biết ảnh của chiếc nào.
   * Kèm mốc thời gian và một đoạn ngẫu nhiên vì một máy có nhiều ảnh và người ta hay
   * tải lên hai file trùng tên gốc.
   */
  private buildFileName(assetCode: string, extension: string) {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${assetCode}_${Date.now()}_${rand}${extension}`;
  }

  async list(assetCode: string) {
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode.toUpperCase() },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);
    return this.prisma.memsAssetPhoto.findMany({
      where: { asset_id: asset.id },
      orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }, { created_at: 'asc' }],
    });
  }

  /**
   * Tải một ảnh lên cho máy.
   *
   * Ảnh đầu tiên của máy tự thành ảnh đại diện — không bắt người dùng bấm thêm một nút nữa
   * chỉ để nói điều hiển nhiên.
   */
  async upload(
    assetCode: string,
    uploaderId: string,
    file: Express.Multer.File,
    caption: string | undefined,
    user: unknown,
  ) {
    if (!file) throw new BadRequestException('Chưa chọn ảnh nào để tải lên');
    if (file.size > MEMS_PHOTO_MAX_BYTES) {
      throw new BadRequestException('Ảnh vượt quá 10MB, chụp lại ở kích thước nhỏ hơn');
    }

    // Loại file suy từ NỘI DUNG, không từ `file.mimetype` (client tự khai) hay đuôi trong
    // `file.originalname` (người dùng tự gõ). Tin hai thứ đó là ghi được file bất kỳ xuống đĩa
    // chỉ bằng cách đổi tên và đặt lại header.
    const kind = sniffImageKind(file.buffer);
    if (!kind) {
      throw new BadRequestException(`Tệp không phải ảnh hợp lệ. Chỉ nhận ${SUPPORTED_IMAGE_LABEL}`);
    }

    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode.toUpperCase() },
      select: { id: true, asset_code: true },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);

    const filename = this.buildFileName(asset.asset_code, IMAGE_EXTENSION[kind]);
    let url: string;
    let storage: string;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(
          tmpPath,
          filename,
          IMAGE_MIME[kind],
          user,
          { subfolder: 'mems' },
        );
        url = result.url;
        storage = 'google_drive';
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    } else {
      if (!fs.existsSync(MEMS_PHOTO_DIR)) fs.mkdirSync(MEMS_PHOTO_DIR, { recursive: true });
      fs.writeFileSync(path.join(MEMS_PHOTO_DIR, filename), file.buffer);
      // Đường dẫn tương đối: máy chủ đổi tên miền thì ảnh cũ vẫn mở được.
      url = `/api/mems/photos/${filename}`;
      storage = 'local';
    }

    const existing = await this.prisma.memsAssetPhoto.count({ where: { asset_id: asset.id } });
    return this.prisma.memsAssetPhoto.create({
      data: {
        asset_id: asset.id,
        url,
        storage,
        caption: caption?.trim() || null,
        is_primary: existing === 0,
        sort_order: existing,
        uploaded_by: uploaderId,
      },
    });
  }

  /** Đổi ảnh đại diện. Bỏ cờ ở ảnh cũ trong cùng giao dịch để không bao giờ có hai ảnh cùng cờ. */
  async setPrimary(photoId: string) {
    const photo = await this.prisma.memsAssetPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Không có ảnh này');
    return this.prisma.$transaction(async (tx) => {
      await tx.memsAssetPhoto.updateMany({
        where: { asset_id: photo.asset_id },
        data: { is_primary: false },
      });
      return tx.memsAssetPhoto.update({ where: { id: photoId }, data: { is_primary: true } });
    });
  }

  /**
   * Xoá ảnh. Ảnh đại diện bị xoá thì ảnh còn lại đầu tiên lên thay — nếu không, bảng kho
   * mất hình mà người dùng không hiểu vì sao.
   */
  async remove(photoId: string) {
    const photo = await this.prisma.memsAssetPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Không có ảnh này');

    return this.prisma.$transaction(async (tx) => {
      await tx.memsAssetPhoto.delete({ where: { id: photoId } });

      if (photo.is_primary) {
        const next = await tx.memsAssetPhoto.findFirst({
          where: { asset_id: photo.asset_id },
          orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
        if (next) {
          await tx.memsAssetPhoto.update({ where: { id: next.id }, data: { is_primary: true } });
        }
      }

      // File trên đĩa xoá sau cùng, và lỗi ở đây KHÔNG làm hỏng giao dịch: bản ghi đã đi rồi,
      // một file mồ côi trong thư mục nhẹ hơn nhiều so với một bản ghi trỏ vào file không còn.
      if (photo.storage === 'local') {
        const filename = path.basename(photo.url);
        fs.unlink(path.join(MEMS_PHOTO_DIR, filename), () => {});
      }
      return { deleted: true, id: photoId };
    });
  }
}

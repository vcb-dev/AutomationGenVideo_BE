import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/** Thư mục dự phòng khi chưa cấu hình Google Drive — giống cách task-auto đang làm. */
export const MEMS_PHOTO_DIR = path.join(process.cwd(), 'uploads', 'mems');

const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|heic)$/;
const MAX_BYTES = 10 * 1024 * 1024;

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
  private buildFileName(assetCode: string, originalName: string) {
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const rand = Math.random().toString(36).slice(2, 8);
    return `${assetCode}_${Date.now()}_${rand}${ext}`;
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
    if (!ALLOWED_MIME.test(file.mimetype)) {
      throw new BadRequestException('Chỉ nhận ảnh jpg, png, gif, webp hoặc heic');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Ảnh vượt quá 10MB, chụp lại ở kích thước nhỏ hơn');
    }

    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode.toUpperCase() },
      select: { id: true, asset_code: true },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);

    const filename = this.buildFileName(asset.asset_code, file.originalname);
    let url: string;
    let storage: string;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(
          tmpPath,
          filename,
          file.mimetype,
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

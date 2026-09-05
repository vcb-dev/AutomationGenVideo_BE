import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemsPhotoUrlSigner } from '../../common/mems/photo-url-signer.service';
import { GoogleDriveStorageService } from '../social-publishing/upload/google-drive-storage.service';

/** Thư mục dự phòng khi chưa cấu hình Google Drive — giống cách task-auto đang làm. */
export const MEMS_PHOTO_DIR = path.join(process.cwd(), 'uploads', 'mems');

const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|heic)$/;
const MAX_BYTES = 10 * 1024 * 1024;

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
    private readonly photoUrls: MemsPhotoUrlSigner,
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
    const photos = await this.prisma.memsAssetPhoto.findMany({
      where: { asset_id: asset.id, purpose: PHOTO_PURPOSE.CATALOG },
      orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }, { created_at: 'asc' }],
    });
    // Ký ngay khi trả ra: route ảnh là công khai nên URL không có token thì trình duyệt nhận 404.
    return this.photoUrls.signAll(photos);
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
    purpose: PhotoPurpose = PHOTO_PURPOSE.CATALOG,
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

    // Đếm trong CÙNG nhóm mục đích: ảnh biên bản không được đẩy `sort_order` của thư viện ảnh
    // hồ sơ, và ngược lại.
    const existing = await this.prisma.memsAssetPhoto.count({
      where: { asset_id: asset.id, purpose },
    });
    const created = await this.prisma.memsAssetPhoto.create({
      data: {
        asset_id: asset.id,
        url,
        storage,
        purpose,
        caption: caption?.trim() || null,
        // Chỉ ảnh hồ sơ mới được làm ảnh đại diện. Ảnh chứng cứ thành ảnh đại diện nghĩa là bảng
        // kho hiện tấm chụp vết xước lúc trả máy — đúng thứ không ai muốn thấy đầu tiên.
        is_primary: purpose === PHOTO_PURPOSE.CATALOG && existing === 0,
        sort_order: existing,
        uploaded_by: uploaderId,
      },
    });

    // Trả về URL đã ký để màn hình vừa tải ảnh lên là hiện được ngay, không phải nạp lại danh sách.
    return { ...created, url: this.photoUrls.sign(created.url) };
  }

  /** Đổi ảnh đại diện. Bỏ cờ ở ảnh cũ trong cùng giao dịch để không bao giờ có hai ảnh cùng cờ. */
  async setPrimary(photoId: string) {
    const photo = await this.prisma.memsAssetPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Không có ảnh này');
    // Chặn đường vòng: cột `purpose` mới chỉ ngăn ảnh biên bản TỰ thành ảnh đại diện lúc tải lên.
    // Endpoint này nhận id bất kỳ, nên không kiểm ở đây thì vẫn đặt được một tấm chụp vết xước
    // làm ảnh đại diện của máy trong bảng kho.
    if (photo.purpose !== PHOTO_PURPOSE.CATALOG) {
      throw new BadRequestException(
        'Chỉ ảnh hồ sơ của máy mới làm ảnh đại diện được. Ảnh này thuộc một biên bản giao/nhận.',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.memsAssetPhoto.updateMany({
        where: { asset_id: photo.asset_id },
        data: { is_primary: false },
      });
      return tx.memsAssetPhoto.update({ where: { id: photoId }, data: { is_primary: true } });
    });

    // Ký như mọi lối trả ảnh khác — trả ra một URL chắc chắn 404 là đặt bẫy cho lần dùng sau.
    return { ...updated, url: this.photoUrls.sign(updated.url) };
  }

  /**
   * Xoá ảnh. Ảnh đại diện bị xoá thì ảnh còn lại đầu tiên lên thay — nếu không, bảng kho
   * mất hình mà người dùng không hiểu vì sao.
   */
  async remove(photoId: string) {
    const photo = await this.prisma.memsAssetPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Không có ảnh này');

    // Ảnh biên bản là chứng cứ, không phải ảnh trang trí. `photoKeys` của biên bản trỏ thẳng vào
    // id này mà không có khoá ngoại nào giữ, nên xoá đi là biên bản còn ghi "3 ảnh" trong khi
    // không tấm nào mở được — đúng tình trạng trước khi siết BR-26.
    if (photo.purpose !== PHOTO_PURPOSE.CATALOG) {
      throw new BadRequestException(
        'Ảnh này là chứng cứ của một biên bản giao/nhận, không xoá được. Chỉ xoá được ảnh hồ sơ của máy.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.memsAssetPhoto.delete({ where: { id: photoId } });

      if (photo.is_primary) {
        const next = await tx.memsAssetPhoto.findFirst({
          // Lọc theo mục đích, nếu không thì ảnh biên bản lên thay làm ảnh đại diện — mà chúng
          // đánh `sort_order` theo nhóm riêng nên tấm đầu tiên mang số 0 và xếp TRƯỚC mọi ảnh
          // hồ sơ. Bảng kho sẽ hiện tấm chụp vết xước lúc trả máy.
          where: { asset_id: photo.asset_id, purpose: PHOTO_PURPOSE.CATALOG },
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

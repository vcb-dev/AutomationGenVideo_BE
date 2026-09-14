import { BadRequestException } from '@nestjs/common';

/**
 * Ảnh làm chứng cứ trong biên bản bàn giao và biên bản nhận trả.
 *
 * BR-26 và BR-27 nói mỗi máy phải có ít nhất một ảnh. Trước đây điều kiện đó chỉ đếm độ dài
 * mảng `photoKeys`, mà `photoKeys` là chuỗi CLIENT TỰ ĐẶT — giao diện gửi lên tên file trên máy
 * người dùng, thậm chí bịa ra `"CAM-001-handover.jpg"` khi không chụp được tấm nào. Kết quả:
 * biên bản luôn ghi "đủ ảnh" trong khi không tấm nào tồn tại và không màn hình nào mở được,
 * nghĩa là đúng lúc tranh cãi vết xước thì vẫn chỉ còn lời khai đối lời khai — thứ mà cả hai
 * quy tắc này sinh ra để tránh.
 *
 * Từ đây `photoKeys` là ID của bản ghi `MemsAssetPhoto` do chính máy chủ sinh ra sau khi nhận
 * file. Hàm này kiểm ba điều, theo thứ tự từ rẻ tới đắt:
 *   1. đúng dạng ID máy chủ sinh — chặn luôn tên file, và tránh cho Prisma ăn chuỗi lạ ở cột
 *      kiểu uuid rồi ném lỗi 500 thay vì 400;
 *   2. ảnh có thật trong kho ảnh;
 *   3. ảnh thuộc đúng chiếc máy đang ghi biên bản — ảnh có thật nhưng chụp chiếc khác vẫn là
 *      chứng cứ sai chỗ.
 *
 * Cố ý nhận `client` thay vì tự giữ Prisma: cả hai chỗ gọi đều đang ở trong một giao dịch, và
 * kiểm bằng kết nối khác thì không thấy được ảnh vừa tải lên trong cùng luồng.
 */

const SERVER_PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhotoEvidenceUnit {
  assetId: string;
  photoKeys: string[];
}

export interface PhotoEvidenceClient {
  memsAssetPhoto: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; asset_id: true };
    }): Promise<{ id: string; asset_id: string }[]>;
  };
}

export async function assertPhotoEvidence(
  client: PhotoEvidenceClient,
  units: PhotoEvidenceUnit[],
): Promise<void> {
  const allKeys = units.flatMap((unit) => unit.photoKeys ?? []);

  const malformed = allKeys.filter((key) => !SERVER_PHOTO_ID.test(key));
  if (malformed.length > 0) {
    throw new BadRequestException(
      `Ảnh "${malformed[0]}" chưa được tải lên máy chủ. Chụp hoặc chọn ảnh trong màn hình này ` +
        'để hệ thống lưu lại trước, đừng gửi tên file.',
    );
  }

  const stored = await client.memsAssetPhoto.findMany({
    where: { id: { in: allKeys } },
    select: { id: true, asset_id: true },
  });
  const ownerByPhotoId = new Map(stored.map((photo) => [photo.id, photo.asset_id]));

  for (const unit of units) {
    for (const key of unit.photoKeys ?? []) {
      const owner = ownerByPhotoId.get(key);
      if (!owner) {
        throw new BadRequestException(
          `Ảnh ${key} không còn trong kho ảnh, có thể đã bị xoá. Tải lại ảnh rồi lập biên bản.`,
        );
      }
      if (owner !== unit.assetId) {
        throw new BadRequestException(
          `Ảnh ${key} không thuộc máy đang lập biên bản. Mỗi máy phải có ảnh chụp chính nó.`,
        );
      }
    }
  }
}

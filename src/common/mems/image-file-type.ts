/**
 * Nhận dạng loại ảnh bằng CHÍNH NỘI DUNG file, không tin lời khai của client.
 *
 * `file.mimetype` mà Multer đưa ra là header `Content-Type` do trình gửi tự đặt, còn
 * `file.originalname` thì hoàn toàn do người dùng gõ — cả hai đều giả được. Trước đây kho lọc
 * bằng mimetype rồi lấy đuôi file từ tên gốc, nên một file bất kỳ đặt tên `.php` kèm khai
 * `image/jpeg` vẫn ghi được xuống đĩa. Nó không phục vụ ra ngoài được (route ảnh có mẫu tên
 * chặt), nhưng nằm lại vĩnh viễn và không có đường nào xoá.
 *
 * Đọc vài byte đầu là đủ và rẻ: mọi định dạng dưới đây đều có chữ ký cố định ở đầu file.
 * Cố ý KHÔNG chạm Prisma hay Nest để test được bằng vài Buffer dựng tay.
 */

export type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic';

/** Đuôi file và mime chuẩn cho từng loại — suy từ nội dung, không lấy từ tên người dùng gửi. */
export const IMAGE_EXTENSION: Record<ImageKind, string> = {
  jpeg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  heic: '.heic',
};

export const IMAGE_MIME: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** Nhãn con người đọc được, dùng trong câu báo lỗi. */
export const SUPPORTED_IMAGE_LABEL = 'jpg, png, gif, webp hoặc heic';

const startsWith = (buffer: Buffer, bytes: number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte);

const asciiAt = (buffer: Buffer, offset: number, text: string): boolean =>
  buffer.length >= offset + text.length &&
  buffer.subarray(offset, offset + text.length).toString('latin1') === text;

/**
 * Nhãn thương hiệu HEIF được coi là ảnh. Bỏ `mp41`/`mp42`/`isom` vì đó là video MP4 — cùng vỏ
 * hộp ISO-BMFF nhưng không phải ảnh, cho qua thì kho nhận cả file phim.
 */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

export function sniffImageKind(buffer: Buffer | undefined | null): ImageKind | null {
  if (!buffer || buffer.length < 12) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (asciiAt(buffer, 0, 'GIF87a') || asciiAt(buffer, 0, 'GIF89a')) return 'gif';
  // WEBP nằm trong vỏ RIFF: 'RIFF' ở đầu, kích thước 4 byte, rồi 'WEBP'.
  if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WEBP')) return 'webp';
  // HEIC là vỏ ISO-BMFF: 4 byte kích thước box, rồi 'ftyp', rồi nhãn thương hiệu.
  if (asciiAt(buffer, 4, 'ftyp')) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (HEIC_BRANDS.includes(brand)) return 'heic';
  }

  return null;
}

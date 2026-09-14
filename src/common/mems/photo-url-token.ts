import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Chữ ký có hạn cho đường dẫn ảnh thiết bị.
 *
 * Route phục vụ ảnh buộc phải `@Public`: thẻ `<img>` của trình duyệt không gửi được header
 * Authorization, nên để sau `JwtAuthGuard` thì ảnh không bao giờ hiện. Nhưng công khai hẳn thì
 * ai có link đều xem được ảnh serial thiết bị của công ty, kể cả người đã nghỉ việc.
 *
 * Dựa vào cookie phiên cũng không chắc: cookie đang đặt `SameSite=lax`, mà `lax` KHÔNG gửi cookie
 * kèm subresource — ảnh chính là subresource. Nếu production đặt API khác site với giao diện thì
 * mọi ảnh sẽ hỏng. Chữ ký nằm ngay trong URL nên không phụ thuộc bố trí tên miền.
 *
 * Cố ý KHÔNG chạm Nest hay Prisma: mọi ca biên (hết hạn, sửa tên file, sửa chữ ký) test được
 * bằng vài lời gọi hàm.
 *
 * Khoá lấy từ chính bí mật JWT, kèm nhãn phân tách miền ở đầu chuỗi ký. Tách nhãn để một chữ ký
 * ảnh không bao giờ dùng lại được ở chỗ khác cũng ký bằng bí mật đó — và để không phải thêm một
 * biến môi trường bắt buộc mới, thứ sẽ làm hỏng lần deploy kế tiếp nếu ai đó quên đặt.
 */

const LABEL = 'mems-photo-v1';

/** 128 bit là quá đủ để không đoán được, mà URL vẫn ngắn. */
const SIGNATURE_HEX_LENGTH = 32;

/** Bằng đúng trần cache của route ảnh: token hết hạn trước khi cache hết thì ảnh chớp tắt vô cớ. */
export const PHOTO_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sign = (filename: string, secret: string, expiresAtMs: number): string =>
  createHmac('sha256', secret)
    .update(`${LABEL}:${filename}:${expiresAtMs}`)
    .digest('hex')
    .slice(0, SIGNATURE_HEX_LENGTH);

/** Token dạng `<hết hạn>.<chữ ký>` — gắn vào URL ảnh dưới dạng `?t=`. */
export function createPhotoToken(
  filename: string,
  secret: string,
  now: number = Date.now(),
): string {
  const expiresAtMs = now + PHOTO_TOKEN_TTL_MS;
  return `${expiresAtMs}.${sign(filename, secret, expiresAtMs)}`;
}

/**
 * Token này có cho phép xem đúng file này không.
 *
 * Trả về boolean chứ không ném: người gọi quyết định báo 404 hay 403. Ở route ảnh nên là 404 —
 * 403 xác nhận file có tồn tại, tức là vẫn rò rỉ một mẩu thông tin cho người đang dò.
 */
export function verifyPhotoToken(
  filename: string,
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;

  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const expiresAtMs = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;

  const provided = token.slice(separator + 1);
  const expected = sign(filename, secret, expiresAtMs);

  // So sánh theo thời gian hằng định: so bằng `===` thì thời gian trả lời rò rỉ số ký tự đầu
  // khớp, đủ để dò từng ký tự một.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Gắn token vào một URL ảnh do máy chủ này phục vụ.
 *
 * URL tuyệt đối (ảnh trên Google Drive) trả về nguyên vẹn: chúng không đi qua route này nên ký
 * vào chỉ làm bẩn đường dẫn.
 */
export function withPhotoToken(url: string, secret: string, now: number = Date.now()): string {
  if (!url || /^https?:\/\//i.test(url)) return url;

  const filename = url.split('/').pop() ?? '';
  if (!filename) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${createPhotoToken(filename, secret, now)}`;
}

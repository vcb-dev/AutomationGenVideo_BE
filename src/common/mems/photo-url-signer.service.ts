import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRuntimeJwtSecret } from '../../modules/auth/jwt-secret.util';
import { verifyPhotoToken, withPhotoToken } from './photo-url-token';

/**
 * Nơi DUY NHẤT biết khoá ký đường dẫn ảnh.
 *
 * Hai service của kho đều trả ảnh ra ngoài (`AssetPhotoService` và `MemsCatalogService`), nên nếu
 * mỗi bên tự lấy bí mật rồi tự ký thì sớm muộn một bên quên — mà quên ký nghĩa là ảnh ở đúng màn
 * đó không hiện được, còn quên kiểm thì cửa mở toang. Gói lại một chỗ để cả hai dùng chung.
 *
 * Dùng lại bí mật JWT thay vì thêm một biến môi trường bắt buộc mới: thêm biến là lần deploy kế
 * tiếp hỏng nếu ai đó quên đặt, mà hàm ký đã có nhãn phân tách miền nên chữ ký ảnh không bao giờ
 * dùng lại được ở chỗ khác.
 */
@Injectable()
export class MemsPhotoUrlSigner {
  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    return getRuntimeJwtSecret(this.config);
  }

  sign(url: string): string {
    return withPhotoToken(url, this.secret());
  }

  /** Ký cả danh sách bản ghi ảnh, giữ nguyên mọi trường khác. */
  signAll<T extends { url: string }>(photos: T[]): T[] {
    const secret = this.secret();
    return photos.map((photo) => ({ ...photo, url: withPhotoToken(photo.url, secret) }));
  }

  verify(filename: string, token: string | undefined): boolean {
    return verifyPhotoToken(filename, token, this.secret());
  }
}

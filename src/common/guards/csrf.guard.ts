import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { COOKIE_CSRF, CSRF_HEADER } from '../../modules/auth/cookie.constants';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit: FE đọc cookie vcbi_csrf (cookie duy nhất không HttpOnly) rồi gửi lại qua header
 * x-csrf-token. Trang tấn công có thể khiến trình duyệt gửi cookie kèm request, nhưng không đọc
 * được giá trị cookie của domain khác nên không dựng nổi header khớp.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { cookies?: Record<string, string> }>();

    if (SAFE_METHODS.has(req.method)) return true;

    // Trình duyệt không tự gắn Authorization vào request do trang khác kích hoạt, nên request mang
    // Bearer vốn đã miễn nhiễm CSRF. Bắt ở đây chỉ làm gãy Swagger "Try it out" và script curl nội
    // bộ mà không thêm được chút an toàn nào.
    if (req.headers.authorization?.startsWith('Bearer ')) return true;

    const fromCookie = req.cookies?.[COOKIE_CSRF];
    const fromHeader = req.headers[CSRF_HEADER];

    if (!fromCookie || !fromHeader || fromCookie !== fromHeader) {
      throw new ForbiddenException('CSRF token không hợp lệ');
    }

    return true;
  }
}

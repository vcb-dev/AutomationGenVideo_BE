import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/**
 * Xác thực cho các route phát media (video/ảnh) mà trình duyệt gọi bằng thẻ `<video src>`.
 *
 * Vì sao KHÔNG dùng được JwtAuthGuard ở đây: thẻ `<video src="...">` do chính trình duyệt đi
 * tải, và nó KHÔNG cho gắn header tuỳ ý — không có cách nào đính `Authorization: Bearer`.
 * Đặt JwtAuthGuard lên route phát thì mọi request media đều 401 và video hiện lỗi, dù gọi
 * bằng curl kèm header thì vẫn chạy (đúng cái bẫy đã mắc phải một lần).
 *
 * Nên guard này chấp nhận token ở MỘT TRONG HAI chỗ:
 *   - header Authorization (khi gọi bằng fetch/curl, vd lúc test)
 *   - query `?t=<jwt>`     (khi trình duyệt tải qua thẻ <video>)
 *
 * Token trong URL chỉ là token của chính người dùng, trên cùng một origin, và link phát vốn
 * đã hết hạn theo giờ — nhưng vẫn nên tránh log nguyên URL của các route dùng guard này.
 */
@Injectable()
export class MediaTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const header = req.headers.authorization || '';
    const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : '';
    const fromQuery = typeof req.query?.t === 'string' ? req.query.t : '';
    const token = fromHeader || fromQuery;

    if (!token) throw new UnauthorizedException('Thiếu token truy cập media.');

    try {
      const payload = await this.jwtService.verifyAsync(token);
      (req as any).user = { id: payload.sub, email: payload.email, roles: payload.roles ?? [] };
      return true;
    } catch {
      throw new UnauthorizedException('Token truy cập media không hợp lệ hoặc đã hết hạn.');
    }
  }
}

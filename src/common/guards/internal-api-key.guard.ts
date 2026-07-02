import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-internal-key'];
    const expected = process.env.INTERNAL_API_KEY;

    if (!expected) throw new UnauthorizedException('INTERNAL_API_KEY chưa được cấu hình');
    if (!key || key !== expected) throw new UnauthorizedException('Internal API key không hợp lệ');

    return true;
  }
}

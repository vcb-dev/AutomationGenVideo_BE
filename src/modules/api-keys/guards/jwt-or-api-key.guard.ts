import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { extractApiKey, touchApiKeyUsage, verifyApiKey } from "../api-key.util";
import { API_KEY_READ_ONLY_KEY } from "../decorators/api-key-read-only.decorator";

/**
 * Guard gộp cho các route vốn chỉ đứng sau `JwtAuthGuard`:
 *
 *  1. Request mang `X-API-Key: agv_...` (hoặc `Authorization: Bearer agv_...`) → xác thực key,
 *     gắn `req.user` = tài khoản dịch vụ thật (row `users`) + `req.apiKey = { id, name }`.
 *     Key sai / hết hạn / bị thu hồi → 401 ngay, KHÔNG rơi xuống nhánh JWT.
 *  2. Ngược lại → uỷ quyền cho `JwtAuthGuard` (cookie/Bearer/query + `@Public()`) — hành vi cũ giữ nguyên.
 *
 * Chỉ phụ thuộc `Reflector` + `PrismaService` (đều là provider global) nên gắn được vào bất kỳ
 * controller nào mà không phải sửa `imports` của module đó.
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  private readonly jwtAuthGuard: JwtAuthGuard;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    this.jwtAuthGuard = new JwtAuthGuard(this.reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rawKey = extractApiKey(req);

    if (rawKey) {
      const verified = await verifyApiKey(this.prisma, rawKey);
      this.assertReadOnlyAllowed(context, req);
      (req as any).user = verified.serviceUser;
      (req as any).apiKey = { id: verified.apiKeyId, name: verified.name };
      touchApiKeyUsage(this.prisma, verified.apiKeyId, req);
      return true;
    }

    return (await this.jwtAuthGuard.canActivate(context)) as boolean;
  }

  private assertReadOnlyAllowed(context: ExecutionContext, req: Request): void {
    const classReadOnly = this.reflector.get<boolean>(
      API_KEY_READ_ONLY_KEY,
      context.getClass(),
    );
    if (!classReadOnly) return;

    const handlerReadOnly = this.reflector.get<boolean>(
      API_KEY_READ_ONLY_KEY,
      context.getHandler(),
    );
    const method = (req.method ?? "").toUpperCase();
    if (handlerReadOnly || method === "GET" || method === "HEAD") return;

    throw new ForbiddenException(
      "API key chỉ được phép đọc dữ liệu ở endpoint này.",
    );
  }
}

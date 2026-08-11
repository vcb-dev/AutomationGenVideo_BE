import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

/** Header BE tự gắn khi gọi nội bộ chính nó (server-to-server). */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Cho phép truy cập /characters/* khi THOẢ MỘT trong hai:
 *
 *  1. Có header x-internal-token khớp INTERNAL_API_TOKEN — dành cho lệnh gọi server-to-server
 *     trong nội bộ BE (vd luồng /ai/content-transform/transform lấy system_prompt qua HTTP thay vì
 *     đọc thẳng DB). Không kèm JWT người dùng nên KHÔNG đi qua JwtAuthGuard.
 *  2. Hoặc là user đã đăng nhập VÀ có role ADMIN/MANAGER — hành vi y hệt trước đây
 *     (JwtAuthGuard + RolesGuard + @Roles(ADMIN, MANAGER)).
 *
 * Vì sao cần guard gộp thay vì chỉ nới @Roles: system_prompt là tài sản trí tuệ của công ty,
 * cố ý KHÔNG expose cho user thường. Nếu nới /characters/:id cho mọi role đã đăng nhập để luồng
 * transform (MEMBER cũng dùng được) không bị 403, thì bất kỳ MEMBER nào cũng đọc được toàn bộ
 * prompt của mọi nhân vật. Token nội bộ giữ nguyên rào chắn đó cho người dùng thật, chỉ mở cho
 * chính BE gọi mình.
 */
@Injectable()
export class AdminOrInternalGuard implements CanActivate {
  private readonly jwtAuthGuard: JwtAuthGuard;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.jwtAuthGuard = new JwtAuthGuard(this.reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const presented = request.headers?.[INTERNAL_TOKEN_HEADER];
    const expected = this.configService.get<string>('INTERNAL_API_TOKEN');
    // Chỉ chấp nhận khi INTERNAL_API_TOKEN thực sự được cấu hình — tránh trường hợp env rỗng
    // khiến mọi request không kèm header cũng lọt qua.
    if (expected && presented && presented === expected) {
      return true;
    }

    const authenticated = await this.jwtAuthGuard.canActivate(context);
    if (!authenticated) return false;

    const roles: UserRole[] = request.user?.roles || [];
    const allowed = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);
    if (!allowed) {
      throw new ForbiddenException('Chỉ Admin/Manager mới có quyền truy cập quản lý nhân vật');
    }
    return true;
  }
}

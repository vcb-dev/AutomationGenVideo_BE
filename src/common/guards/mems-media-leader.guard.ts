import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { isMediaTeam } from '../mems/media-team';

/**
 * Kiểm tra xem một người dùng có phải là Leader/Manager của Team Media hoặc Admin không.
 */
export function isMediaLeaderOrAdminUser(user?: {
  roles?: (UserRole | string)[];
  team?: string | null;
} | null): boolean {
  if (!user || !user.roles || !Array.isArray(user.roles)) return false;
  const roles = user.roles.map((r) => String(r).toUpperCase());
  if (roles.includes('ADMIN')) return true;

  const isLeaderOrManager = roles.includes('LEADER') || roles.includes('MANAGER');
  return isLeaderOrManager && isMediaTeam(user.team);
}

/**
 * Guard giới hạn các thao tác quản lý kho thiết bị, duyệt phiếu, gán máy, bàn giao, nhận trả:
 * Chỉ cho phép Leader của Team Media hoặc Admin.
 */
@Injectable()
export class MemsMediaLeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Yêu cầu đăng nhập để thực hiện thao tác.');
    }

    if (!isMediaLeaderOrAdminUser(user)) {
      throw new ForbiddenException(
        'Chỉ Leader của Team Media hoặc Admin mới có quyền thực hiện thao tác quản lý thiết bị này.',
      );
    }

    return true;
  }
}

import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

const SENSITIVE_ACTION_PERMISSIONS = new Set([
  "social:external:crawl_all",
  "social:external:propose",
]);

/**
 * Kiểm tra xem một danh sách quyền của user có thỏa mãn quyền được yêu cầu hay không.
 * Hỗ trợ so khớp chính xác, wildcard (*) và quy tắc "all" (ví dụ social:external:all).
 * Chú ý: Các quyền hành động nhạy cảm như crawl_all bắt buộc phải được cấp đích danh, không thừa hưởng từ :all.
 */
export function checkPermissionMatch(userPermissions: string[], requiredPerm: string): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;

  // 1. So khớp chính xác
  if (userPermissions.includes(requiredPerm)) return true;

  // 2. Nếu user có wildcard gốc "*"
  if (userPermissions.includes("*")) return true;

  // Nếu là quyền hành động nhạy cảm (như cào tay crawl_all), bắt buộc phải có quyền đích danh hoặc *
  if (SENSITIVE_ACTION_PERMISSIONS.has(requiredPerm)) {
    return false;
  }

  // 3. Kiểm tra quyền "all" hoặc wildcard cấp cao hơn
  // Ví dụ: requiredPerm = "social:external:tiktok"
  // User có "social:external:all" hoặc "social:external:*" hoặc "social:*"
  const parts = requiredPerm.split(":");
  let currentPrefix = "";

  for (let i = 0; i < parts.length - 1; i++) {
    currentPrefix = currentPrefix ? `${currentPrefix}:${parts[i]}` : parts[i];
    if (userPermissions.includes(`${currentPrefix}:all`)) return true;
    if (userPermissions.includes(`${currentPrefix}:*`)) return true;
  }

  return false;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Nếu endpoint không yêu cầu @RequirePermissions thì cho qua
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // 1. Admin luôn có toàn quyền (Bypass)
    if (user.roles?.includes(UserRole.ADMIN)) {
      return true;
    }

    const userPermissions: string[] = user.permissions ?? [];

    // 2. Kiểm tra xem user có ít nhất một quyền hợp lệ trong danh sách requiredPermissions
    return requiredPermissions.some((perm) =>
      checkPermissionMatch(userPermissions, perm),
    );
  }
}

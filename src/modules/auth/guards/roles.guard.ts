import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Trong hệ thống VCBI, ADMIN và MANAGER đều là một (cùng cấp quyền quản trị tối cao)
    const effectiveRoles = new Set<UserRole>(user.roles || []);
    if (effectiveRoles.has(UserRole.ADMIN)) {
      effectiveRoles.add(UserRole.MANAGER);
    }
    if (effectiveRoles.has(UserRole.MANAGER)) {
      effectiveRoles.add(UserRole.ADMIN);
    }

    return requiredRoles.some((role) => effectiveRoles.has(role));
  }
}
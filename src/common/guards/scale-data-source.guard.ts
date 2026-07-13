import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { isPrivilegedSourceTeamMember } from '../utils/team-membership.util'

/**
 * Cho phép thao tác với kho source nếu user là ADMIN/MANAGER
 * hoặc là thành viên của team "Scale Data" hoặc "MEDIA".
 */
@Injectable()
export class ScaleDataSourceGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest()
    if (!user) return false

    const roles: string[] = user.roles ?? []
    if (roles.includes('ADMIN') || roles.includes('MANAGER')) return true

    return isPrivilegedSourceTeamMember(this.prisma, user.id)
  }
}

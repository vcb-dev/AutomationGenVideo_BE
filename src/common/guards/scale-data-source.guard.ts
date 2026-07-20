import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Cho phép thao tác với kho source nếu user là ADMIN/MANAGER
 * hoặc là thành viên của team "Scale Data".
 */
@Injectable()
export class ScaleDataSourceGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest()
    if (!user) return false

    const roles: string[] = user.roles ?? []
    if (roles.includes('ADMIN') || roles.includes('MANAGER')) return true

    const scaleDataTeam = await this.prisma.team.findUnique({
      where: { name: 'Scale Data' },
      select: { id: true },
    })
    if (!scaleDataTeam) return false

    const membership = await this.prisma.teamMember.findFirst({
      where: { team_id: scaleDataTeam.id, user_id: user.id },
      select: { id: true },
    })
    return !!membership
  }
}

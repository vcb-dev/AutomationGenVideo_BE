import {
  Injectable, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CreateTeamDto, UpdateTeamDto, EditorApprovalDto } from './dto/team.dto'

// Prisma generated enums
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

@Injectable()
export class TaskAutoTeamsService {
  constructor(private prisma: PrismaService) {}

  private teamInclude = {
    leader: { select: { id: true, full_name: true, email: true } },
    members: {
      include: { user: { select: { id: true, full_name: true, email: true, roles: true } } },
    },
    _count: { select: { members: true, tasks: true } },
  }

  // Sync teams from User.team field (source of truth is user data)
  private async syncFromUsers() {
    const users = await this.prisma.user.findMany({
      where: { team: { not: null }, is_active: true },
      select: { id: true, roles: true, team: true },
    })

    // Group by team name
    const teamMap = new Map<string, { leader_id: string | null; memberIds: string[] }>()
    for (const user of users) {
      if (!user.team) continue
      if (!teamMap.has(user.team)) teamMap.set(user.team, { leader_id: null, memberIds: [] })
      const g = teamMap.get(user.team)!
      g.memberIds.push(user.id)
      if ((user.roles as string[]).includes('LEADER')) g.leader_id = user.id
    }

    for (const [name, { leader_id, memberIds }] of teamMap) {
      const team = await this.prisma.team.upsert({
        where: { name },
        create: { name, leader_id, is_active: true },
        update: { leader_id },
      })

      // Upsert each member — user_id is unique, so this also moves users between teams
      for (const userId of memberIds) {
        await this.prisma.teamMember.upsert({
          where: { user_id: userId },
          create: { team_id: team.id, user_id: userId },
          update: { team_id: team.id },
        })
      }
    }
  }

  async findAll() {
    await this.syncFromUsers()
    return this.prisma.team.findMany({
      include: this.teamInclude,
      orderBy: { name: 'asc' },
    })
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        ...this.teamInclude,
        tasks: {
          take: 10,
          orderBy: { created_at: 'desc' },
          include: {
            assignee: { select: { id: true, full_name: true } },
          },
        },
        team_kpis: { orderBy: { month: 'desc' }, take: 3, include: { allocations: true } },
      },
    })
    if (!team) throw new NotFoundException('Team not found')
    return team
  }

  async create(dto: CreateTeamDto) {
    const existing = await this.prisma.team.findUnique({ where: { name: dto.name } })
    if (existing) throw new ConflictException('Team name already exists')

    return this.prisma.team.create({
      data: {
        name: dto.name,
        leader_id: dto.leader_id,
        is_active: dto.is_active ?? true,
        members: dto.member_ids?.length
          ? { create: dto.member_ids.map(uid => ({ user_id: uid })) }
          : undefined,
      },
      include: this.teamInclude,
    })
  }

  async update(id: string, dto: UpdateTeamDto) {
    await this.findOne(id)

    const { member_ids, ...rest } = dto

    if (member_ids !== undefined) {
      // Replace all members atomically
      await this.prisma.$transaction([
        this.prisma.teamMember.deleteMany({ where: { team_id: id } }),
        ...member_ids.map(uid =>
          this.prisma.teamMember.create({ data: { team_id: id, user_id: uid } })
        ),
      ])
    }

    return this.prisma.team.update({
      where: { id },
      data: rest,
      include: this.teamInclude,
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    await this.prisma.team.delete({ where: { id } })
    return { success: true }
  }

  // ─── Members ───────────────────────────────────────────────────────────────

  async addMember(teamId: string, userId: string) {
    await this.findOne(teamId)
    const existing = await this.prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } })
    if (existing) throw new ConflictException('User is already a member')
    return this.prisma.teamMember.create({ data: { team_id: teamId, user_id: userId } })
  }

  async removeMember(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } })
    if (!member) throw new NotFoundException('Member not found in team')
    await this.prisma.teamMember.delete({ where: { id: member.id } })
    return { success: true }
  }

  async listAllMembers(role?: string) {
    return this.prisma.user.findMany({
      where: role ? { roles: { has: role as any } } : undefined,
      select: { id: true, full_name: true, email: true, roles: true, is_active: true },
      orderBy: { full_name: 'asc' },
    })
  }

  // ─── Team Products ────────────────────────────────────────────────────────

  async listTeamProducts(teamId: string) {
    await this.findOne(teamId) // validates team exists
    return this.prisma.teamProduct.findMany({
      where: { team_id: teamId },
      include: {
        product: {
          select: {
            id: true, name: true, sku: true, image_url: true,
            price: true, market: true, priority_score: true,
            product_line: { select: { id: true, name: true } },
          },
        },
        added_by: { select: { id: true, full_name: true } },
      },
      orderBy: { added_at: 'desc' },
    })
  }

  async addTeamProduct(teamId: string, productId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)

    // Chỉ thành viên trong team (hoặc leader) hoặc ADMIN/MANAGER mới được thêm
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (!isAdminOrManager) {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      const isLeader = team.leader_id === userId
      if (!isMember && !isLeader) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm sản phẩm')
    }

    const existing = await this.prisma.teamProduct.findUnique({
      where: { team_id_product_id: { team_id: teamId, product_id: productId } },
    })
    if (existing) throw new ConflictException('Sản phẩm đã có trong kho của team')

    return this.prisma.teamProduct.create({
      data: { team_id: teamId, product_id: productId, added_by_id: userId },
      include: {
        product: { select: { id: true, name: true, sku: true, image_url: true } },
        added_by: { select: { id: true, full_name: true } },
      },
    })
  }

  async removeTeamProduct(teamId: string, productId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)

    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (!isAdminOrManager) {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      const isLeader = team.leader_id === userId
      if (!isMember && !isLeader) throw new ForbiddenException('Chỉ thành viên trong team mới có thể xóa sản phẩm')
    }

    const entry = await this.prisma.teamProduct.findUnique({
      where: { team_id_product_id: { team_id: teamId, product_id: productId } },
    })
    if (!entry) throw new NotFoundException('Sản phẩm không có trong kho team')
    await this.prisma.teamProduct.delete({ where: { id: entry.id } })
    return { success: true }
  }

  // ─── Team Contents ────────────────────────────────────────────────────────

  async listTeamContents(teamId: string) {
    await this.findOne(teamId)
    return this.prisma.teamContent.findMany({
      where: { team_id: teamId },
      include: {
        content: {
          select: {
            id: true, title: true, body: true, status: true, market: true,
            view_count: true, file_content_url: true, voice_url: true,
            content_line: { select: { id: true, name: true } },
          },
        },
        added_by: { select: { id: true, full_name: true } },
      },
      orderBy: { added_at: 'desc' },
    })
  }

  async addTeamContent(teamId: string, contentId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)

    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (!isAdminOrManager) {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      const isLeader = team.leader_id === userId
      if (!isMember && !isLeader) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm content')
    }

    const existing = await this.prisma.teamContent.findUnique({
      where: { team_id_content_id: { team_id: teamId, content_id: contentId } },
    })
    if (existing) throw new ConflictException('Content đã có trong kho của team')

    return this.prisma.teamContent.create({
      data: { team_id: teamId, content_id: contentId, added_by_id: userId },
      include: {
        content: { select: { id: true, title: true, status: true, market: true } },
        added_by: { select: { id: true, full_name: true } },
      },
    })
  }

  async removeTeamContent(teamId: string, contentId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)

    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (!isAdminOrManager) {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      const isLeader = team.leader_id === userId
      if (!isMember && !isLeader) throw new ForbiddenException('Chỉ thành viên trong team mới có thể xóa content')
    }

    const entry = await this.prisma.teamContent.findUnique({
      where: { team_id_content_id: { team_id: teamId, content_id: contentId } },
    })
    if (!entry) throw new NotFoundException('Content không có trong kho team')
    await this.prisma.teamContent.delete({ where: { id: entry.id } })
    return { success: true }
  }

  async pushTeamContentToGlobal(teamId: string, contentId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)

    // Chỉ leader (của chính team này), ADMIN hoặc MANAGER mới được đẩy ra kho tổng
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    const isLeader = team.leader_id === userId
    if (!isAdminOrManager && !isLeader) {
      throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể đẩy content ra kho tổng')
    }

    const entry = await this.prisma.teamContent.findUnique({
      where: { team_id_content_id: { team_id: teamId, content_id: contentId } },
    })
    if (!entry) throw new NotFoundException('Content không có trong kho team')

    // Xóa khỏi kho team, đảm bảo content ở trạng thái AVAILABLE trong kho tổng
    await this.prisma.$transaction([
      this.prisma.teamContent.delete({ where: { id: entry.id } }),
      this.prisma.content.update({
        where: { id: contentId },
        data: { status: 'AVAILABLE' },
      }),
    ])

    return { success: true, message: 'Content đã được đẩy ra kho tổng' }
  }

  // ─── Direct Editor Assignment ─────────────────────────────────────────────

  async setMemberEditorDirect(
    teamId: string,
    userId: string,
    isEditor: boolean,
    approverId: string,
    approverRoles: string[],
  ) {
    const isLeaderOnly =
      approverRoles.includes('LEADER') &&
      !approverRoles.includes('ADMIN') &&
      !approverRoles.includes('MANAGER')

    if (isLeaderOnly) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } })
      if (team?.leader_id !== approverId)
        throw new ForbiddenException('LEADER chỉ được quản lý team của mình')
      const member = await this.prisma.teamMember.findFirst({
        where: { team_id: teamId, user_id: userId },
      })
      if (!member)
        throw new ForbiddenException('Người dùng không trong team này')
    }

    const existing = await this.prisma.editorApproval.findFirst({
      where: { user_id: userId },
    })

    const newStatus: ApprovalStatus = isEditor ? 'APPROVED' : 'REJECTED'

    if (existing) {
      return this.prisma.editorApproval.update({
        where: { id: existing.id },
        data: {
          status: newStatus as any,
          approved_by_id: approverId,
          approved_at: new Date(),
          note: null,
        },
        include: { user: { select: { id: true, full_name: true, email: true } } },
      })
    } else {
      return this.prisma.editorApproval.create({
        data: {
          user_id: userId,
          status: newStatus as any,
          approved_by_id: approverId,
          approved_at: new Date(),
        },
        include: { user: { select: { id: true, full_name: true, email: true } } },
      })
    }
  }

  // ─── Editor Approvals ─────────────────────────────────────────────────────

  async getEditorApprovals(status?: string) {
    return this.prisma.editorApproval.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        user: { select: { id: true, full_name: true, email: true } },
        approved_by: { select: { id: true, full_name: true } },
      },
      orderBy: { created_at: 'desc' },
    })
  }

  async requestEditorApproval(userId: string) {
    const existing = await this.prisma.editorApproval.findFirst({
      where: { user_id: userId, status: 'PENDING' },
    })
    if (existing) throw new ConflictException('Approval request already pending')
    return this.prisma.editorApproval.create({
      data: { user_id: userId },
      include: { user: { select: { id: true, full_name: true, email: true } } },
    })
  }

  async reviewEditorApproval(approvalId: string, dto: EditorApprovalDto, approverId: string) {
    const approval = await this.prisma.editorApproval.findUnique({ where: { id: approvalId } })
    if (!approval) throw new NotFoundException('Approval not found')
    if (approval.status !== 'PENDING') throw new ConflictException('Approval already reviewed')

    return this.prisma.editorApproval.update({
      where: { id: approvalId },
      data: {
        status: dto.action as any,
        approved_by_id: approverId,
        approved_at: new Date(),
        note: dto.note,
      },
      include: { user: { select: { id: true, full_name: true } } },
    })
  }
}

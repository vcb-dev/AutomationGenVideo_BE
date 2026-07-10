import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException,
} from '@nestjs/common'
import { DateTime } from 'luxon'
import { PrismaService } from '../../../common/prisma/prisma.service'
import { CreateTeamDto, UpdateTeamDto, EditorApprovalDto } from './team.dto'
import { CreateTeamProductDto, UpdateTeamProductDto, CreateTeamContentDto, UpdateTeamContentDto, CreateTeamSourceDto, UpdateTeamSourceDto } from '../catalog/catalog.dto'
import { Prisma, UserRole } from '@prisma/client'
import { recomputeUserTeamFieldsBatch, seedEditorKpiForMembers, TEAM_TX_OPTIONS } from '../../../common/utils/team-membership.util'
import { resolveProductSnapshot, resolveContentSnapshot } from '../../../common/utils/catalog-resolve.util'

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

@Injectable()
export class TaskAutoTeamsService {
  constructor(private prisma: PrismaService) {}

  /** Tháng hiện tại (yyyy-MM) theo giờ VN — dùng để tự thêm item mới đẩy lên kho tổng vào kho tháng đang chạy */
  private currentMonth(): string {
    return DateTime.now().setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM')
  }

  private teamInclude = {
    leader: { select: { id: true, full_name: true, email: true } },
    // Chỉ hiện thành viên đang hoạt động — tài khoản bị Admin/Leader vô hiệu hóa ở
    // HR-management không được hiện như đang tham gia team bên trang Nhiệm vụ.
    members: {
      where: { user: { is_active: true } },
      include: { user: { select: { id: true, full_name: true, email: true, roles: true } } },
    },
    _count: { select: { members: true, tasks: true } },
  }

  /**
   * Đồng bộ User.team/team_leader_id (phái sinh) cho danh sách user bị ảnh hưởng bởi một thay đổi
   * Team/TeamMember. PHẢI gọi với transaction client của chính thao tác ghi membership đó — nếu
   * chạy tách rời (this.prisma), hai luồng cùng sửa team của một user (tab Teams ở đây vs
   * HR-management ở users.service) có thể recompute đè nhau bằng snapshot cũ, làm cột team
   * lúc hiện lúc mất cho tới lần thay đổi team kế tiếp.
   */
  private async syncAffectedUsers(db: PrismaService | Prisma.TransactionClient, userIds: Iterable<string>) {
    await recomputeUserTeamFieldsBatch(db, [...new Set(userIds)])
  }

  async findAll() {
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
          include: { assignee: { select: { id: true, full_name: true } } },
        },
        team_kpis: { orderBy: { month: 'desc' }, take: 3, include: { allocations: true } },
      },
    })
    if (!team) throw new NotFoundException('Team not found')
    return team
  }

  async create(dto: CreateTeamDto, creatorId: string) {
    const existing = await this.prisma.team.findUnique({ where: { name: dto.name } })
    if (existing) throw new ConflictException('Team name already exists')

    // Leader cũng là thành viên của team (cùng invariant với luồng HR-management) — nếu chỉ
    // set leader_id mà không có TeamMember, các field phái sinh User.team/team_leader_id của
    // leader sẽ không nhìn thấy team này.
    const memberIds = [...new Set([...(dto.member_ids ?? []), ...(dto.leader_id ? [dto.leader_id] : [])])]

    // Ghi membership + seed KPI + recompute field phái sinh trong CÙNG transaction — xem syncAffectedUsers.
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          name: dto.name,
          leader_id: dto.leader_id,
          is_active: dto.is_active ?? true,
          members: memberIds.length
            ? { create: memberIds.map(uid => ({ user_id: uid })) }
            : undefined,
        },
        include: this.teamInclude,
      })

      // Seed EditorKpi=0 tháng hiện tại cho member mới (chỉ role MEMBER) — cùng invariant với
      // luồng HR-management (assignUserToTeams), để member vào team từ màn nào cũng như nhau.
      await seedEditorKpiForMembers(tx, memberIds, [team.id], creatorId)
      await this.syncAffectedUsers(tx, memberIds)
      return team
    }, TEAM_TX_OPTIONS)
  }

  async update(id: string, dto: UpdateTeamDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(id)

    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    const isLeaderOnly = userRoles.includes('LEADER') && !isAdminOrManager

    if (isLeaderOnly && team.leader_id !== userId) {
      throw new ForbiddenException('LEADER chỉ được cập nhật team của mình')
    }

    const { member_ids, ...rest } = dto
    const previousMemberIds = (team as any).members?.map((m: any) => m.user_id) ?? []
    const previousLeaderId = team.leader_id

    if (isLeaderOnly) {
      if (member_ids !== undefined)    throw new ForbiddenException('LEADER không được thay đổi danh sách thành viên')
      if (rest.name !== undefined)     throw new ForbiddenException('LEADER không được đổi tên team')
      if (rest.is_active !== undefined) throw new ForbiddenException('LEADER không được thay đổi trạng thái team')
      if (rest.leader_id !== undefined) throw new ForbiddenException('LEADER không được thay đổi leader')
    }

    // Toàn bộ ghi membership + update team + recompute field phái sinh trong CÙNG một
    // interactive transaction (batch $transaction dạng mảng không nhận maxWait/timeout,
    // và không gói được recompute chung) — xem syncAffectedUsers.
    return this.prisma.$transaction(async (tx) => {
      if (member_ids !== undefined) {
        // createMany thay vì N lệnh create() riêng lẻ — team càng đông thành viên,
        // càng nhiều round-trip tuần tự tới DB.
        await tx.teamMember.deleteMany({ where: { team_id: id } })
        await tx.teamMember.createMany({ data: member_ids.map(uid => ({ team_id: id, user_id: uid })) })
        // Cùng invariant với luồng HR-management: member (role MEMBER) vào team thì có sẵn
        // dòng EditorKpi=0 tháng hiện tại, không phụ thuộc màn hình nào thực hiện thao tác.
        await seedEditorKpiForMembers(tx, member_ids, [id], userId)
      }

      const updated = await tx.team.update({
        where: { id },
        data: rest,
        include: this.teamInclude,
      })

      // Leader mới phải có TeamMember (cùng invariant với luồng HR) — nếu không, field phái
      // sinh User.team của leader sẽ không chứa team này dù leader_id đã trỏ vào họ.
      if (rest.leader_id) {
        await tx.teamMember.createMany({
          data: [{ team_id: id, user_id: rest.leader_id }],
          skipDuplicates: true,
        })
      }

      await this.syncAffectedUsers(tx, [
        ...previousMemberIds,
        ...(member_ids ?? []),
        ...(previousLeaderId ? [previousLeaderId] : []),
        ...(updated.leader_id ? [updated.leader_id] : []),
      ])

      return updated
    }, TEAM_TX_OPTIONS)
  }

  async remove(id: string) {
    const team = await this.findOne(id)
    const memberIds = (team as any).members?.map((m: any) => m.user_id) ?? []
    await this.prisma.$transaction(async (tx) => {
      await tx.team.delete({ where: { id } })
      await this.syncAffectedUsers(tx, memberIds)
    }, TEAM_TX_OPTIONS)
    return { success: true }
  }

  async addMember(teamId: string, userId: string) {
    await this.findOne(teamId)
    const existing = await this.prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } })
    if (existing) throw new ConflictException('User is already a member')
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.teamMember.create({ data: { team_id: teamId, user_id: userId } })
      await this.syncAffectedUsers(tx, [userId])
      return member
    }, TEAM_TX_OPTIONS)
  }

  async removeMember(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } })
    if (!member) throw new NotFoundException('Member not found in team')
    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.delete({ where: { id: member.id } })
      await this.syncAffectedUsers(tx, [userId])
    }, TEAM_TX_OPTIONS)
    return { success: true }
  }

  async listAllMembers(role?: string) {
    const roleEnum = role && Object.values(UserRole).includes(role as UserRole)
      ? (role as UserRole)
      : undefined
    return this.prisma.user.findMany({
      where: roleEnum ? { roles: { has: roleEnum } } : undefined,
      select: { id: true, full_name: true, email: true, roles: true, is_active: true },
      orderBy: { full_name: 'asc' },
    })
  }

  private teamProductInclude = {
    added_by:       { select: { id: true, full_name: true } },
    material:       { select: { id: true, name: true } },
    product_line:   { select: { id: true, name: true } },
    classification: { select: { id: true, name: true } },
    source_editor_product: {
      select: {
        id: true, sku: true, name: true, image_url: true, image_urls: true,
        price: true, market: true, price_segment: true, priority_score: true,
        material_id: true, product_line_id: true, classification_id: true, brand_type: true, is_active: true,
      },
    },
  }

  private teamContentInclude = {
    added_by:       { select: { id: true, full_name: true } },
    content_line:   { select: { id: true, name: true } },
    classification: { select: { id: true, name: true } },
    source_editor_content: {
      select: {
        id: true, title: true, body: true, script: true,
        file_content_url: true, voice_url: true, content_line_id: true, classification_id: true,
        brand_type: true, market: true, status: true,
        content_line: { select: { id: true, name: true } },
      },
    },
  }

  private assertCanManageProduct(team: any, userId: string, userRoles: string[], action: 'add' | 'edit' | 'delete') {
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (isAdminOrManager) return
    const isLeader = team.leader_id === userId
    if (action === 'add') {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      if (!isLeader && !isMember) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm sản phẩm')
    } else {
      if (!isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể thực hiện thao tác này')
    }
  }

  private assertCanManageContent(team: any, userId: string, userRoles: string[], action: 'add' | 'edit' | 'delete') {
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (isAdminOrManager) return
    const isLeader = team.leader_id === userId
    if (action === 'add') {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      if (!isLeader && !isMember) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm content')
    } else {
      if (!isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể thực hiện thao tác này')
    }
  }

  private teamMonthRange(month?: string) {
    if (!month) return {}
    const [y, m] = month.split('-').map(Number)
    return { added_at: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } }
  }

  async listTeamProducts(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC', month?: string, classificationId?: string) {
    await this.findOne(teamId)
    return this.prisma.teamProduct.findMany({
      where: {
        team_id: teamId,
        ...(brandType ? { brand_type: brandType } : {}),
        ...(classificationId ? { classification_id: classificationId } : {}),
        ...this.teamMonthRange(month),
      },
      include: this.teamProductInclude,
      // `added_at` không unique — nhiều dòng import/tạo cùng lúc có thể trùng millisecond,
      // nên phải có tiebreaker ổn định để thứ tự không đổi giữa các lần fetch/sau khi update.
      orderBy: [{ added_at: 'desc' }, { id: 'asc' }],
    })
  }

  async addTeamProduct(teamId: string, dto: CreateTeamProductDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageProduct(team, userId, userRoles, 'add')

    if (dto.source_product_id) {
      const source = await resolveProductSnapshot(this.prisma, dto.source_product_id)
      if (!source) throw new NotFoundException('Không tìm thấy sản phẩm gốc')

      return this.prisma.teamProduct.create({
        data: {
          team_id: teamId, source_product_id: source.id, sku: source.sku, name: source.name,
          brand_type: source.brand_type, image_url: source.image_url, image_urls: source.image_urls,
          price: source.price, market: source.market, price_segment: source.price_segment,
          priority_score: source.priority_score, material_id: source.material_id,
          product_line_id: source.product_line_id, classification_id: source.classification_id,
          is_active: source.is_active, added_by_id: userId,
        },
        include: this.teamProductInclude,
      })
    }

    if (!dto.name)       throw new BadRequestException('Tên sản phẩm là bắt buộc')
    if (!dto.brand_type) throw new BadRequestException('brand_type là bắt buộc khi tạo mới')
    const sku = dto.sku ?? `TEAM-${teamId.slice(0, 6)}-${Date.now()}`

    return this.prisma.teamProduct.create({
      data: {
        team_id: teamId, sku, name: dto.name, brand_type: dto.brand_type,
        image_url: dto.image_url, image_urls: dto.image_urls ?? [], price: dto.price,
        market: dto.market, price_segment: dto.price_segment, priority_score: dto.priority_score ?? 0,
        material_id: dto.material_id, product_line_id: dto.product_line_id,
        classification_id: dto.classification_id, is_active: dto.is_active ?? true,
        added_by_id: userId,
      },
      include: this.teamProductInclude,
    })
  }

  async updateTeamProduct(teamId: string, teamProductId: string, dto: UpdateTeamProductDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageProduct(team, userId, userRoles, 'edit')

    const entry = await this.prisma.teamProduct.findFirst({ where: { id: teamProductId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Sản phẩm không có trong kho team')

    return this.prisma.teamProduct.update({
      where: { id: teamProductId },
      data: {
        ...(dto.name !== undefined            && { name: dto.name }),
        ...(dto.brand_type !== undefined      && { brand_type: dto.brand_type }),
        ...(dto.image_url !== undefined       && { image_url: dto.image_url }),
        ...(dto.image_urls !== undefined      && { image_urls: dto.image_urls }),
        ...(dto.price !== undefined           && { price: dto.price }),
        ...(dto.market !== undefined          && { market: dto.market }),
        ...(dto.price_segment !== undefined   && { price_segment: dto.price_segment }),
        ...(dto.priority_score !== undefined  && { priority_score: dto.priority_score }),
        ...(dto.material_id !== undefined     && { material_id: dto.material_id }),
        ...(dto.product_line_id !== undefined && { product_line_id: dto.product_line_id }),
        ...(dto.classification_id !== undefined && { classification_id: dto.classification_id }),
        ...(dto.is_active !== undefined       && { is_active: dto.is_active }),
      },
      include: this.teamProductInclude,
    })
  }

  async removeTeamProduct(teamId: string, teamProductId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageProduct(team, userId, userRoles, 'delete')

    const entry = await this.prisma.teamProduct.findFirst({ where: { id: teamProductId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Sản phẩm không có trong kho team')
    await this.prisma.teamProduct.delete({ where: { id: teamProductId } })
    return { success: true }
  }

  async pushTeamProductToGlobal(teamId: string, teamProductId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    const isLeader = team.leader_id === userId
    if (!isAdminOrManager && !isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể đẩy sản phẩm ra kho tổng')

    const entry = await this.prisma.teamProduct.findFirst({ where: { id: teamProductId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Sản phẩm không có trong kho team')

    const existing = await this.prisma.product.findUnique({ where: { source_team_product_id: teamProductId } })
    if (existing) throw new ConflictException('Sản phẩm này đã được đẩy lên kho tổng')

    const product = await this.prisma.product.create({
      data: {
        source_team_product_id: teamProductId,
        brand_type:             entry.brand_type,
        priority_score:         entry.priority_score,
        is_active:              entry.is_active,
        product_line_id:        entry.product_line_id,
        classification_id:      entry.classification_id,
        added_by_id:            userId,
      },
    })
    // Thêm luôn vào kho tháng hiện tại — nếu không, sản phẩm vừa đẩy sẽ không hiện trong danh sách kho tổng tháng này
    await this.prisma.productWarehouse.create({
      data: { product_id: product.id, month: this.currentMonth() },
    })
    return { success: true, message: 'Đã đẩy sản phẩm lên kho tổng', product }
  }

  async listTeamContents(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC', month?: string, classificationId?: string) {
    await this.findOne(teamId)
    return this.prisma.teamContent.findMany({
      where: {
        team_id: teamId,
        ...(brandType ? { brand_type: brandType } : {}),
        ...(classificationId ? { classification_id: classificationId } : {}),
        ...this.teamMonthRange(month),
      },
      include: this.teamContentInclude,
      // Tiebreaker ổn định — xem giải thích ở listTeamProducts.
      orderBy: [{ added_at: 'desc' }, { id: 'asc' }],
    })
  }

  async addTeamContent(teamId: string, dto: CreateTeamContentDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageContent(team, userId, userRoles, 'add')

    if (dto.source_content_id) {
      const source = await resolveContentSnapshot(this.prisma, dto.source_content_id)
      if (!source) throw new NotFoundException('Không tìm thấy content gốc')

      return this.prisma.teamContent.create({
        data: {
          team_id: teamId, source_content_id: source.id, brand_type: source.brand_type,
          market: source.market ?? 'VIETNAM', title: source.title, body: source.body,
          script: source.script, file_content_url: source.file_content_url, voice_url: source.voice_url,
          content_line_id: source.content_line_id, classification_id: source.classification_id,
          status: 'AVAILABLE', added_by_id: userId,
        },
        include: this.teamContentInclude,
      })
    }

    return this.prisma.teamContent.create({
      data: {
        team_id: teamId, brand_type: dto.brand_type, market: dto.market ?? 'VIETNAM',
        title: dto.title, body: dto.body, script: dto.script, file_content_url: dto.file_content_url,
        voice_url: dto.voice_url, content_line_id: dto.content_line_id, classification_id: dto.classification_id,
        status: 'AVAILABLE',
        added_by_id: userId,
      },
      include: this.teamContentInclude,
    })
  }

  async updateTeamContent(teamId: string, teamContentId: string, dto: UpdateTeamContentDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageContent(team, userId, userRoles, 'edit')

    const entry = await this.prisma.teamContent.findFirst({ where: { id: teamContentId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Content không có trong kho team')

    return this.prisma.teamContent.update({
      where: { id: teamContentId },
      data: {
        ...(dto.brand_type !== undefined       && { brand_type: dto.brand_type }),
        ...(dto.market !== undefined           && { market: dto.market }),
        ...(dto.title !== undefined            && { title: dto.title }),
        ...(dto.body !== undefined             && { body: dto.body }),
        ...(dto.script !== undefined           && { script: dto.script }),
        ...(dto.file_content_url !== undefined && { file_content_url: dto.file_content_url }),
        ...(dto.voice_url !== undefined        && { voice_url: dto.voice_url }),
        ...(dto.content_line_id !== undefined  && { content_line_id: dto.content_line_id }),
        ...(dto.classification_id !== undefined && { classification_id: dto.classification_id }),
        ...(dto.status !== undefined           && { status: dto.status as any }),
      },
      include: this.teamContentInclude,
    })
  }

  async removeTeamContent(teamId: string, teamContentId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageContent(team, userId, userRoles, 'delete')

    const entry = await this.prisma.teamContent.findFirst({ where: { id: teamContentId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Content không có trong kho team')
    await this.prisma.teamContent.delete({ where: { id: teamContentId } })
    return { success: true }
  }

  async pushTeamContentToGlobal(teamId: string, teamContentId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    const isLeader = team.leader_id === userId
    if (!isAdminOrManager && !isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể đẩy content ra kho tổng')

    const entry = await this.prisma.teamContent.findFirst({ where: { id: teamContentId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Content không có trong kho team')

    const existing = await this.prisma.content.findUnique({ where: { source_team_content_id: teamContentId } })
    if (existing) throw new ConflictException('Content này đã được đẩy lên kho tổng')

    const content = await this.prisma.content.create({
      data: {
        source_team_content_id: teamContentId,
        brand_type:             entry.brand_type,
        classification_id:      entry.classification_id,
        added_by_id:            userId,
      },
    })
    // Thêm luôn vào kho tháng hiện tại — nếu không, content vừa đẩy sẽ không hiện trong danh sách kho tổng tháng này
    await this.prisma.contentWarehouse.create({
      data: { content_id: content.id, month: this.currentMonth() },
    })
    return { success: true, message: 'Đã đẩy content lên kho tổng', content }
  }

  private teamSourceInclude = {
    added_by:     { select: { id: true, full_name: true } },
    product:      { select: { id: true, name: true } },
    team_product: { select: { id: true, sku: true, name: true } },
    source_source: { select: { id: true, name: true } },
    source_editor_source: {
      select: {
        id: true, type: true, name: true, link: true, nas_link: true,
        code: true, brand_type: true, is_active: true, product_id: true,
        editor_product_id: true,
      },
    },
  }

  private async assertCanManageSource(team: any, userId: string, userRoles: string[], action: 'add' | 'edit' | 'delete') {
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (isAdminOrManager) return

    const scaleDataTeam = await this.prisma.team.findUnique({ where: { name: 'Scale Data' }, select: { id: true } })
    if (scaleDataTeam) {
      const isScaleData = await this.prisma.teamMember.findFirst({ where: { team_id: scaleDataTeam.id, user_id: userId }, select: { id: true } })
      if (isScaleData) return
    }

    const isLeader = team.leader_id === userId
    if (action === 'add') {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      if (!isLeader && !isMember) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm source')
    } else {
      if (!isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể thực hiện thao tác này')
    }
  }

  async listTeamSources(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC', productId?: string, teamProductId?: string, month?: string) {
    await this.findOne(teamId)
    return this.prisma.teamSource.findMany({
      where: {
        team_id: teamId,
        ...(brandType     ? { brand_type: brandType }          : {}),
        ...(productId     ? { product_id: productId }          : {}),
        ...(teamProductId ? { team_product_id: teamProductId } : {}),
        ...this.teamMonthRange(month),
      },
      include: this.teamSourceInclude,
      // Tiebreaker ổn định — xem giải thích ở listTeamProducts.
      orderBy: [{ added_at: 'desc' }, { id: 'asc' }],
    })
  }

  async addTeamSource(teamId: string, dto: CreateTeamSourceDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    await this.assertCanManageSource(team, userId, userRoles, 'add')

    if (dto.source_source_id) {
      const src = await this.prisma.source.findUnique({ where: { id: dto.source_source_id } })
      if (!src) throw new NotFoundException('Không tìm thấy source gốc')

      let linkedProductId: string | null = null
      if (src.product_id) {
        const exists = await this.prisma.product.findUnique({ where: { id: src.product_id }, select: { id: true } })
        linkedProductId = exists ? src.product_id : null
      }

      return this.prisma.teamSource.create({
        data: {
          team_id: teamId, source_source_id: src.id, brand_type: src.brand_type,
          type: src.type, name: src.name, link: src.link, nas_link: src.nas_link, code: src.code,
          product_id: linkedProductId, is_active: src.is_active, added_by_id: userId,
        },
        include: this.teamSourceInclude,
      })
    }

    if (!dto.name)       throw new BadRequestException('Tên source là bắt buộc khi tạo mới')
    if (!dto.link)       throw new BadRequestException('Link là bắt buộc khi tạo mới')
    if (!dto.type)       throw new BadRequestException('Loại source là bắt buộc khi tạo mới')
    if (!dto.brand_type) throw new BadRequestException('brand_type là bắt buộc khi tạo mới')
    return this.prisma.teamSource.create({
      data: {
        team_id: teamId, brand_type: dto.brand_type, type: dto.type as any,
        name: dto.name, link: dto.link, code: dto.code,
        product_id: dto.product_id || null, team_product_id: dto.team_product_id || null,
        is_active: dto.is_active ?? true, added_by_id: userId,
      },
      include: this.teamSourceInclude,
    })
  }

  async updateTeamSource(teamId: string, teamSourceId: string, dto: UpdateTeamSourceDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    await this.assertCanManageSource(team, userId, userRoles, 'edit')

    const entry = await this.prisma.teamSource.findFirst({ where: { id: teamSourceId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Source không có trong kho team')

    return this.prisma.teamSource.update({
      where: { id: teamSourceId },
      data: {
        ...(dto.brand_type !== undefined      && { brand_type: dto.brand_type }),
        ...(dto.type !== undefined            && { type: dto.type as any }),
        ...(dto.name !== undefined            && { name: dto.name }),
        ...(dto.link !== undefined            && { link: dto.link }),
        ...(dto.nas_link !== undefined        && { nas_link: dto.nas_link }),
        ...(dto.code !== undefined            && { code: dto.code }),
        ...(dto.product_id !== undefined      && { product_id:      dto.product_id      ?? null }),
        ...(dto.team_product_id !== undefined && { team_product_id: dto.team_product_id ?? null }),
        ...(dto.is_active !== undefined       && { is_active: dto.is_active }),
      },
      include: this.teamSourceInclude,
    })
  }

  async removeTeamSource(teamId: string, teamSourceId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    await this.assertCanManageSource(team, userId, userRoles, 'delete')

    const entry = await this.prisma.teamSource.findFirst({ where: { id: teamSourceId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Source không có trong kho team')
    await this.prisma.teamSource.delete({ where: { id: teamSourceId } })
    return { success: true }
  }

  async pushTeamSourceToGlobal(teamId: string, teamSourceId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    const isLeader = team.leader_id === userId
    if (!isAdminOrManager && !isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể đẩy source ra kho tổng')

    const entry = await this.prisma.teamSource.findFirst({ where: { id: teamSourceId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Source không có trong kho team')

    const existing = await this.prisma.source.findUnique({ where: { source_team_source_id: teamSourceId } })
    if (existing) throw new ConflictException('Source này đã được đẩy lên kho tổng')

    const source = await this.prisma.source.create({
      data: {
        source_team_source_id: teamSourceId,
        brand_type:            entry.brand_type,
        is_active:             entry.is_active,
        added_by_id:           userId,
      },
    })
    // Thêm luôn vào kho tháng hiện tại — nếu không, source vừa đẩy sẽ không hiện trong danh sách kho tổng tháng này
    await this.prisma.sourceWarehouse.create({
      data: { source_id: source.id, month: this.currentMonth() },
    })
    return { success: true, message: 'Đã đẩy source lên kho tổng', source }
  }

  async setMemberEditorDirect(teamId: string, userId: string, isEditor: boolean, approverId: string, approverRoles: string[]) {
    const isLeaderOnly = approverRoles.includes('LEADER') && !approverRoles.includes('ADMIN') && !approverRoles.includes('MANAGER')

    if (isLeaderOnly) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } })
      if (team?.leader_id !== approverId)
        throw new ForbiddenException('LEADER chỉ được quản lý team của mình')
      const member = await this.prisma.teamMember.findFirst({ where: { team_id: teamId, user_id: userId } })
      if (!member) throw new ForbiddenException('Người dùng không trong team này')
    }

    const existing = await this.prisma.editorApproval.findFirst({ where: { user_id: userId } })
    const newStatus: ApprovalStatus = isEditor ? 'APPROVED' : 'REJECTED'

    if (existing) {
      return this.prisma.editorApproval.update({
        where: { id: existing.id },
        data: { status: newStatus as any, approved_by_id: approverId, approved_at: new Date(), note: null },
        include: { user: { select: { id: true, full_name: true, email: true } } },
      })
    } else {
      return this.prisma.editorApproval.create({
        data: { user_id: userId, status: newStatus as any, approved_by_id: approverId, approved_at: new Date() },
        include: { user: { select: { id: true, full_name: true, email: true } } },
      })
    }
  }

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
    const existing = await this.prisma.editorApproval.findFirst({ where: { user_id: userId, status: 'PENDING' } })
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
      data: { status: dto.action as any, approved_by_id: approverId, approved_at: new Date(), note: dto.note },
      include: { user: { select: { id: true, full_name: true } } },
    })
  }

  async getMemberSourceStats(teamId: string, month?: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: { select: { id: true, full_name: true, email: true, image_url: true } },
          },
        },
      },
    })
    if (!team) throw new NotFoundException('Team not found')

    const memberIds = team.members.map(m => m.user_id)

    let startDate: Date, endDate: Date
    if (month) {
      const [year, mo] = month.split('-').map(Number)
      startDate = new Date(year, mo - 1, 1)
      endDate   = new Date(year, mo, 0, 23, 59, 59, 999)
    } else {
      const now = new Date()
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      endDate   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    }

    const [globalCounts, teamCounts] = await Promise.all([
      this.prisma.source.groupBy({
        by: ['added_by_id'],
        where: { added_by_id: { in: memberIds }, created_at: { gte: startDate, lte: endDate } },
        _count: { id: true },
      }),
      this.prisma.teamSource.groupBy({
        by: ['added_by_id'],
        where: { added_by_id: { in: memberIds }, added_at: { gte: startDate, lte: endDate } },
        _count: { id: true },
      }),
    ])

    const globalMap = new Map(globalCounts.map(g => [g.added_by_id, g._count.id]))
    const teamMap   = new Map(teamCounts.map(t => [t.added_by_id, t._count.id]))

    return team.members
      .map(m => ({
        user_id:        m.user_id,
        full_name:      m.user.full_name,
        email:          m.user.email,
        image_url:      m.user.image_url,
        global_sources: globalMap.get(m.user_id) ?? 0,
        team_sources:   teamMap.get(m.user_id) ?? 0,
        total:          (globalMap.get(m.user_id) ?? 0) + (teamMap.get(m.user_id) ?? 0),
      }))
      .sort((a, b) => b.total - a.total)
  }
}

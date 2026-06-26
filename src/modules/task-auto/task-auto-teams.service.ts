import {
  Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CreateTeamDto, UpdateTeamDto, EditorApprovalDto } from './dto/team.dto'
import { CreateTeamProductDto, UpdateTeamProductDto, CreateTeamContentDto, UpdateTeamContentDto, CreateTeamSourceDto, UpdateTeamSourceDto } from './dto/catalog.dto'
import { UserRole } from '@prisma/client'

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
    const roleEnum = role && Object.values(UserRole).includes(role as UserRole)
      ? (role as UserRole)
      : undefined
    return this.prisma.user.findMany({
      where: roleEnum ? { roles: { has: roleEnum } } : undefined,
      select: { id: true, full_name: true, email: true, roles: true, is_active: true },
      orderBy: { full_name: 'asc' },
    })
  }

  // ─── Shared include for TeamProduct ──────────────────────────────────────

  private teamProductInclude = {
    added_by:     { select: { id: true, full_name: true } },
    material:     { select: { id: true, name: true } },
    product_line: { select: { id: true, name: true } },
  }

  private teamContentInclude = {
    added_by:     { select: { id: true, full_name: true } },
    content_line: { select: { id: true, name: true } },
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

  // ─── Team Products ────────────────────────────────────────────────────────

  async listTeamProducts(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC') {
    await this.findOne(teamId)
    return this.prisma.teamProduct.findMany({
      where: { team_id: teamId, ...(brandType ? { brand_type: brandType } : {}) },
      include: this.teamProductInclude,
      orderBy: { added_at: 'desc' },
    })
  }

  async addTeamProduct(teamId: string, dto: CreateTeamProductDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageProduct(team, userId, userRoles, 'add')

    // Copy từ kho tổng
    if (dto.source_product_id) {
      const source = await this.prisma.product.findUnique({ where: { id: dto.source_product_id } })
      if (!source) throw new NotFoundException('Không tìm thấy sản phẩm gốc')

      return this.prisma.teamProduct.create({
        data: {
          team_id:           teamId,
          source_product_id: source.id,
          sku:               source.sku,
          name:              source.name,
          brand_type:        source.brand_type,
          image_url:         source.image_url,
          image_urls:        source.image_urls,
          price:             source.price,
          market:            source.market,
          price_segment:     source.price_segment,
          priority_score:    source.priority_score,
          material_id:       source.material_id,
          product_line_id:   source.product_line_id,
          is_active:         source.is_active,
          added_by_id:       userId,
        },
        include: this.teamProductInclude,
      })
    }

    // Tạo mới trực tiếp trong kho team
    if (!dto.name)       throw new BadRequestException('Tên sản phẩm là bắt buộc')
    if (!dto.brand_type) throw new BadRequestException('brand_type là bắt buộc khi tạo mới')
    const sku = dto.sku ?? `TEAM-${teamId.slice(0, 6)}-${Date.now()}`

    return this.prisma.teamProduct.create({
      data: {
        team_id:         teamId,
        sku,
        name:            dto.name,
        brand_type:      dto.brand_type,
        image_url:       dto.image_url,
        image_urls:      dto.image_urls ?? [],
        price:           dto.price,
        market:          dto.market,
        price_segment:   dto.price_segment,
        priority_score:  dto.priority_score ?? 0,
        material_id:     dto.material_id,
        product_line_id: dto.product_line_id,
        is_active:       dto.is_active ?? true,
        added_by_id:     userId,
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

    const productData = {
      name:            entry.name,
      image_url:       entry.image_url,
      image_urls:      entry.image_urls,
      price:           entry.price,
      market:          entry.market,
      price_segment:   entry.price_segment,
      priority_score:  entry.priority_score,
      material_id:     entry.material_id,
      product_line_id: entry.product_line_id,
      is_active:       entry.is_active,
    }

    // Nếu có source_product_id: kiểm tra và cập nhật product gốc trong kho tổng
    if (entry.source_product_id) {
      const existingGlobalProduct = await this.prisma.product.findUnique({
        where: { id: entry.source_product_id },
      })
      if (existingGlobalProduct) {
        const updated = await this.prisma.product.update({
          where: { id: entry.source_product_id },
          data: productData,
        })
        return { success: true, message: 'Đã cập nhật sản phẩm gốc trong kho tổng', product: updated }
      }
      // Product gốc đã bị xóa → xóa source_product_id cũ, tạo mới bên dưới
      await this.prisma.teamProduct.update({
        where: { id: teamProductId },
        data: { source_product_id: null },
      })
    }

    // Tạo mới trong kho tổng
    const existingSku = await this.prisma.product.findUnique({ where: { sku: entry.sku } })
    const finalSku = existingSku ? `${entry.sku}-${Date.now()}` : entry.sku

    const newProduct = await this.prisma.product.create({
      data: {
        sku:             finalSku,
        brand_type:      entry.brand_type,
        added_by_id:     userId,
        ...productData,
      },
    })
    // Ghi lại source để lần push sau biết đây là product đã được push
    await this.prisma.teamProduct.update({
      where: { id: teamProductId },
      data: { source_product_id: newProduct.id },
    })
    return { success: true, message: 'Đã tạo sản phẩm mới trong kho tổng', product: newProduct }
  }

  // ─── Team Contents ────────────────────────────────────────────────────────

  async listTeamContents(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC') {
    await this.findOne(teamId)
    return this.prisma.teamContent.findMany({
      where: { team_id: teamId, ...(brandType ? { brand_type: brandType } : {}) },
      include: this.teamContentInclude,
      orderBy: { added_at: 'desc' },
    })
  }

  async addTeamContent(teamId: string, dto: CreateTeamContentDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageContent(team, userId, userRoles, 'add')

    // Copy từ kho tổng
    if (dto.source_content_id) {
      const source = await this.prisma.content.findUnique({ where: { id: dto.source_content_id } })
      if (!source) throw new NotFoundException('Không tìm thấy content gốc')

      return this.prisma.teamContent.create({
        data: {
          team_id:           teamId,
          source_content_id: source.id,
          brand_type:        source.brand_type,
          market:            source.market ?? 'VIETNAM',
          title:             source.title,
          body:              source.body,
          script:            source.script,
          file_content_url:  source.file_content_url,
          voice_url:         source.voice_url,
          content_line_id:   source.content_line_id,
          status:            'AVAILABLE',
          added_by_id:       userId,
        },
        include: this.teamContentInclude,
      })
    }

    // Tạo mới
    return this.prisma.teamContent.create({
      data: {
        team_id:          teamId,
        brand_type:       dto.brand_type,
        market:           dto.market ?? 'VIETNAM',
        title:            dto.title,
        body:             dto.body,
        script:           dto.script,
        file_content_url: dto.file_content_url,
        voice_url:        dto.voice_url,
        content_line_id:  dto.content_line_id,
        status:           'AVAILABLE',
        added_by_id:      userId,
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

    // Nếu có source_content_id: cập nhật content gốc
    if (entry.source_content_id) {
      const updated = await this.prisma.content.update({
        where: { id: entry.source_content_id },
        data: {
          title:            entry.title,
          body:             entry.body,
          script:           entry.script,
          file_content_url: entry.file_content_url,
          voice_url:        entry.voice_url,
          content_line_id:  entry.content_line_id,
          status:           'AVAILABLE',
        },
      })
      return { success: true, message: 'Đã cập nhật content gốc trong kho tổng', content: updated }
    }

    // Không có source: tạo mới trong kho tổng
    const newContent = await this.prisma.content.create({
      data: {
        brand_type:       entry.brand_type,
        market:           entry.market as any,
        title:            entry.title,
        body:             entry.body,
        script:           entry.script,
        file_content_url: entry.file_content_url,
        voice_url:        entry.voice_url,
        content_line_id:  entry.content_line_id,
        status:           'AVAILABLE',
        added_by_id:      userId,
      },
    })
    await this.prisma.teamContent.update({
      where: { id: teamContentId },
      data: { source_content_id: newContent.id },
    })
    return { success: true, message: 'Đã tạo content mới trong kho tổng', content: newContent }
  }

  // ─── Team Sources ─────────────────────────────────────────────────────────

  private teamSourceInclude = {
    added_by:     { select: { id: true, full_name: true } },
    product:      { select: { id: true, name: true } },
    team_product: { select: { id: true, sku: true, name: true } },
    source_source: { select: { id: true, name: true } },
  }

  private assertCanManageSource(team: any, userId: string, userRoles: string[], action: 'add' | 'edit' | 'delete') {
    const isAdminOrManager = userRoles.includes('ADMIN') || userRoles.includes('MANAGER')
    if (isAdminOrManager) return
    const isLeader = team.leader_id === userId
    if (action === 'add') {
      const isMember = team.members?.some((m: any) => m.user_id === userId)
      if (!isLeader && !isMember) throw new ForbiddenException('Chỉ thành viên trong team mới có thể thêm source')
    } else {
      if (!isLeader) throw new ForbiddenException('Chỉ leader hoặc quản lý mới có thể thực hiện thao tác này')
    }
  }

  async listTeamSources(teamId: string, brandType?: 'DO_DA' | 'TRANG_SUC', productId?: string, teamProductId?: string) {
    await this.findOne(teamId)
    return this.prisma.teamSource.findMany({
      where: {
        team_id: teamId,
        ...(brandType      ? { brand_type: brandType }           : {}),
        ...(productId      ? { product_id: productId }           : {}),
        ...(teamProductId  ? { team_product_id: teamProductId }  : {}),
      },
      include: this.teamSourceInclude,
      orderBy: { added_at: 'desc' },
    })
  }

  async addTeamSource(teamId: string, dto: CreateTeamSourceDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageSource(team, userId, userRoles, 'add')

    // Copy từ kho tổng
    if (dto.source_source_id) {
      const src = await this.prisma.source.findUnique({ where: { id: dto.source_source_id } })
      if (!src) throw new NotFoundException('Không tìm thấy source gốc')

      // Kiểm tra product liên kết còn tồn tại không (tránh FK violation nếu đã bị xóa)
      let linkedProductId: string | null = null
      if (src.product_id) {
        const exists = await this.prisma.product.findUnique({ where: { id: src.product_id }, select: { id: true } })
        linkedProductId = exists ? src.product_id : null
      }

      return this.prisma.teamSource.create({
        data: {
          team_id:          teamId,
          source_source_id: src.id,
          brand_type:       src.brand_type,
          type:             src.type,
          name:             src.name,
          link:             src.link,
          code:             src.code,
          product_id:       linkedProductId,
          is_active:        src.is_active,
          added_by_id:      userId,
        },
        include: this.teamSourceInclude,
      })
    }

    // Tạo mới trực tiếp
    if (!dto.name)       throw new BadRequestException('Tên source là bắt buộc khi tạo mới')
    if (!dto.link)       throw new BadRequestException('Link là bắt buộc khi tạo mới')
    if (!dto.type)       throw new BadRequestException('Loại source là bắt buộc khi tạo mới')
    if (!dto.brand_type) throw new BadRequestException('brand_type là bắt buộc khi tạo mới')
    return this.prisma.teamSource.create({
      data: {
        team_id:         teamId,
        brand_type:      dto.brand_type,
        type:            dto.type as any,
        name:            dto.name,
        link:            dto.link,
        code:            dto.code,
        product_id:      dto.product_id || null,
        team_product_id: dto.team_product_id || null,
        is_active:       dto.is_active ?? true,
        added_by_id:     userId,
      },
      include: this.teamSourceInclude,
    })
  }

  async updateTeamSource(teamId: string, teamSourceId: string, dto: UpdateTeamSourceDto, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageSource(team, userId, userRoles, 'edit')

    const entry = await this.prisma.teamSource.findFirst({ where: { id: teamSourceId, team_id: teamId } })
    if (!entry) throw new NotFoundException('Source không có trong kho team')

    return this.prisma.teamSource.update({
      where: { id: teamSourceId },
      data: {
        ...(dto.brand_type !== undefined && { brand_type: dto.brand_type }),
        ...(dto.name       !== undefined && { name:       dto.name }),
        ...(dto.link       !== undefined && { link:       dto.link }),
        ...(dto.code       !== undefined && { code:       dto.code }),
        ...(dto.product_id      !== undefined && { product_id:      dto.product_id      ?? null }),
        ...(dto.team_product_id !== undefined && { team_product_id: dto.team_product_id ?? null }),
        ...(dto.is_active       !== undefined && { is_active:       dto.is_active }),
      },
      include: this.teamSourceInclude,
    })
  }

  async removeTeamSource(teamId: string, teamSourceId: string, userId: string, userRoles: string[]) {
    const team = await this.findOne(teamId)
    this.assertCanManageSource(team, userId, userRoles, 'delete')

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

    // Nếu có source_source_id: cập nhật source gốc trong kho tổng (nếu còn tồn tại)
    if (entry.source_source_id) {
      const globalSource = await this.prisma.source.findUnique({ where: { id: entry.source_source_id } })
      if (globalSource) {
        let linkedProductId: string | null = null
        if (entry.product_id) {
          const exists = await this.prisma.product.findUnique({ where: { id: entry.product_id }, select: { id: true } })
          linkedProductId = exists ? entry.product_id : null
        }
        // Fallback: source liên kết qua team_product → tìm global product qua source_product_id
        if (!linkedProductId && entry.team_product_id) {
          const tp = await this.prisma.teamProduct.findUnique({
            where: { id: entry.team_product_id },
            select: { source_product_id: true },
          })
          linkedProductId = tp?.source_product_id ?? null
        }
        const updated = await this.prisma.source.update({
          where: { id: entry.source_source_id },
          data: {
            name:       entry.name,
            link:       entry.link,
            code:       entry.code,
            product_id: linkedProductId,
            is_active:  entry.is_active,
          },
        })
        return { success: true, message: 'Đã cập nhật source gốc trong kho tổng', source: updated }
      }
      // Global source bị xóa → xóa source_source_id cũ, tạo mới bên dưới
      await this.prisma.teamSource.update({
        where: { id: teamSourceId },
        data: { source_source_id: null },
      })
    }

    // Không có source gốc: tạo mới trong kho tổng
    // Kiểm tra product liên kết còn tồn tại không trước khi tạo global source
    let globalProductId: string | null = null
    if (entry.product_id) {
      const exists = await this.prisma.product.findUnique({ where: { id: entry.product_id }, select: { id: true } })
      globalProductId = exists ? entry.product_id : null
    }
    // Fallback: source liên kết qua team_product → tìm global product qua source_product_id
    if (!globalProductId && entry.team_product_id) {
      const tp = await this.prisma.teamProduct.findUnique({
        where: { id: entry.team_product_id },
        select: { source_product_id: true },
      })
      globalProductId = tp?.source_product_id ?? null
    }

    const newSource = await this.prisma.source.create({
      data: {
        brand_type:  entry.brand_type,
        type:        entry.type,
        name:        entry.name,
        link:        entry.link,
        code:        entry.code,
        product_id:  globalProductId,
        is_active:   entry.is_active,
        added_by_id: userId,
      },
    })
    // Ghi lại source_source_id để lần push sau biết đã push
    await this.prisma.teamSource.update({
      where: { id: teamSourceId },
      data: { source_source_id: newSource.id },
    })
    return { success: true, message: 'Đã tạo source mới trong kho tổng', source: newSource }
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

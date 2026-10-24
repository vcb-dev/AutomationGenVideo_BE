import {
  BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { UserRole } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../../common/prisma/prisma.service'
import { recomputeUserTeamFieldsBatch, seedEditorKpiForMembers } from '../../../common/utils/team-membership.util'
import { unaccent } from '../../../common/utils/unaccent.util'

export type HrmMemberKind = 'CONTENT' | 'EDITOR'

export interface HrmProject {
  id: string
  name: string
  status: string
}

export interface HrmEmployee {
  id: string
  email: string | null
  fullName: string | null
  displayName: string | null
  employeeCode: string | null
  employeeIdentifier: string | null
  jobTitle: string | null
  avatarUrl: string | null
  teams: { name: string }[]
  projects: { id: string }[]
}

export interface SyncTeam {
  id: string
  name: string
  is_active: boolean
  hrm_project_id: string | null
  leader_id: string | null
  members: { user_id: string; is_content_creator: boolean }[]
}

export interface SyncUser {
  id: string
  email: string
  full_name: string
  employee_id: string | null
  hrm_employee_id: string | null
  is_active: boolean
  deleted: boolean
  editor_approved: boolean
}

export interface HrmSyncMember {
  user_id: string | null
  hrm_employee_id: string | null
  full_name: string
  email: string | null
  kind: HrmMemberKind | null
  inactive?: boolean
}

export type HrmProjectLinkStatus = 'LINKED' | 'CHOSEN' | 'SUGGESTED' | 'NEW' | 'SKIP'

export interface HrmSyncProjectPlan {
  project_id: string
  project_name: string
  status: HrmProjectLinkStatus
  team_id: string | null
  team_name: string | null
  rename: boolean
  rename_conflict: boolean
  add: HrmSyncMember[]
  remove: HrmSyncMember[]
  keep: HrmSyncMember[]
  flag_updates: { user_id: string; is_content_creator: boolean }[]
}

export interface HrmSyncPlan {
  projects: HrmSyncProjectPlan[]
  accounts_to_create: (HrmSyncMember & {
    email: string
    hrm_employee_id: string
    avatar_url: string | null
    possible_matches: { user_id: string; full_name: string; email: string }[]
  })[]
  user_links: { user_id: string; hrm_employee_id: string }[]
  editor_approvals: string[]
  skipped: { hrm_employee_id: string; full_name: string; email: string | null; reason: string }[]
  errors: string[]
}

export interface HrmSyncInput {
  projects: HrmProject[]
  employees: HrmEmployee[]
  teams: SyncTeam[]
  users: SyncUser[]
  /** project_id → team_id | 'NEW' | 'SKIP' cho dự án chưa gắn team */
  choices: Record<string, string>
  /** hrm_employee_id → user_id: dùng tài khoản có sẵn (khác email) thay vì tạo mới */
  accountLinks: Record<string, string>
  suggestUnlinked: boolean
}

const NEW_TEAM = 'NEW'
const SKIP = 'SKIP'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HRM_SYNC_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 }
const NAME_MATCH_SCORE = 1_000_000

function fold(s: string | null | undefined): string {
  return unaccent(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function hrmMemberKind(e: Pick<HrmEmployee, 'jobTitle' | 'teams'>): HrmMemberKind | null {
  const title = fold(e.jobTitle)
  const teams = e.teams.map((t) => fold(t.name))
  if (/\bcontent\b/.test(title) || teams.includes('content')) return 'CONTENT'
  if (/\b(editor|media)\b/.test(title) || teams.includes('editor')) return 'EDITOR'
  return null
}

function namesOverlap(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 2 && short.every((t) => long.includes(t))
}

function hrmDisplayName(e: HrmEmployee): string {
  const raw = (e.displayName || e.fullName || e.email || e.id).trim().replace(/\s+/g, ' ')
  return raw === raw.toUpperCase() ? raw.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : raw
}

export function buildHrmSyncPlan(input: HrmSyncInput): HrmSyncPlan {
  const errors: string[] = []
  const projects = [...input.projects].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const projectIds = new Set(projects.map((p) => p.id))

  const employeeById = new Map(input.employees.map((e) => [e.id, e]))
  const desiredByProject = new Map<string, Map<string, HrmMemberKind>>(projects.map((p) => [p.id, new Map()]))
  for (const e of input.employees) {
    const kind = hrmMemberKind(e)
    if (!kind) continue
    for (const p of e.projects) desiredByProject.get(p.id)?.set(e.id, kind)
  }
  const desiredEmployeeIds = new Set([...desiredByProject.values()].flatMap((m) => [...m.keys()]))

  const liveUsers = input.users.filter((u) => !u.deleted)
  const userById = new Map(input.users.map((u) => [u.id, u]))
  const byHrmId = new Map(liveUsers.filter((u) => u.hrm_employee_id).map((u) => [u.hrm_employee_id!, u]))
  const byEmail = new Map(liveUsers.map((u) => [u.email.trim().toLowerCase(), u]))
  const deletedEmails = new Set(input.users.filter((u) => u.deleted).map((u) => u.email.trim().toLowerCase()))
  const byCode = new Map<string, SyncUser>()
  for (const u of liveUsers) if (u.employee_id?.trim()) byCode.set(u.employee_id.trim().toUpperCase(), u)
  const agvByName = new Map<string, SyncUser[]>()
  for (const u of liveUsers) agvByName.set(fold(u.full_name), [...(agvByName.get(fold(u.full_name)) ?? []), u])
  const hrmNameCount = new Map<string, number>()
  for (const e of input.employees) {
    const n = fold(e.fullName || e.displayName)
    if (n) hrmNameCount.set(n, (hrmNameCount.get(n) ?? 0) + 1)
  }

  const matched = new Map<string, SyncUser>()
  const claimed = new Set<string>()
  const free = (u: SyncUser | undefined, hrmId: string) =>
    u && !claimed.has(u.id) && (!u.hrm_employee_id || u.hrm_employee_id === hrmId) ? u : undefined
  for (const [id, userId] of Object.entries(input.accountLinks)) {
    const live = userById.get(userId)
    const u = desiredEmployeeIds.has(id) && live && !live.deleted ? free(live, id) : undefined
    if (u) {
      matched.set(id, u)
      claimed.add(u.id)
    } else {
      const name = employeeById.get(id) ? hrmDisplayName(employeeById.get(id)!) : id
      errors.push(`Tài khoản chọn cho "${name}" không dùng được (đã xoá hoặc đã gắn nhân sự HRM khác)`)
    }
  }
  for (const id of desiredEmployeeIds) {
    if (matched.has(id)) continue
    const e = employeeById.get(id)!
    const u = free(byHrmId.get(id), id)
      ?? free(byEmail.get((e.email ?? '').trim().toLowerCase()), id)
      ?? free(byCode.get((e.employeeCode ?? '').trim().toUpperCase()), id)
      ?? free(byCode.get((e.employeeIdentifier ?? '').trim().toUpperCase()), id)
    if (u) {
      matched.set(id, u)
      claimed.add(u.id)
    }
  }
  for (const id of desiredEmployeeIds) {
    if (matched.has(id)) continue
    const name = fold(employeeById.get(id)!.fullName || employeeById.get(id)!.displayName)
    const candidates = agvByName.get(name) ?? []
    if (!name || hrmNameCount.get(name) !== 1 || candidates.length !== 1) continue
    const u = free(candidates[0], id)
    if (u) {
      matched.set(id, u)
      claimed.add(u.id)
    }
  }

  const linkedTeamByProject = new Map(input.teams.filter((t) => t.hrm_project_id).map((t) => [t.hrm_project_id!, t]))
  const teamById = new Map(input.teams.map((t) => [t.id, t]))
  const usedTeamIds = new Set<string>()
  const target = new Map<string, { status: HrmProjectLinkStatus; team: SyncTeam | null }>()

  for (const p of projects) {
    const linked = linkedTeamByProject.get(p.id)
    if (linked) {
      target.set(p.id, { status: 'LINKED', team: linked })
      usedTeamIds.add(linked.id)
    }
  }
  for (const p of projects) {
    if (target.has(p.id)) continue
    const choice = input.choices[p.id]
    if (choice === undefined) continue
    if (choice === NEW_TEAM || choice === SKIP) {
      target.set(p.id, { status: choice === NEW_TEAM ? 'NEW' : 'SKIP', team: null })
      continue
    }
    const team = teamById.get(choice)
    if (!team) errors.push(`Không tìm thấy team đã chọn cho dự án "${p.name}"`)
    else if (usedTeamIds.has(team.id) || (team.hrm_project_id && projectIds.has(team.hrm_project_id))) {
      errors.push(`Team "${team.name}" đã gắn với dự án khác — không gắn thêm cho "${p.name}" được`)
    } else {
      target.set(p.id, { status: 'CHOSEN', team })
      usedTeamIds.add(team.id)
    }
  }
  for (const id of Object.keys(input.choices)) {
    if (!projectIds.has(id)) errors.push(`Dự án ${id} không còn hoạt động bên HRM`)
  }

  const open = projects.filter((p) => !target.has(p.id))
  if (input.suggestUnlinked) {
    const candidates = input.teams.filter((t) => t.is_active && !t.hrm_project_id && !usedTeamIds.has(t.id))
    const scored = open.map((p) => {
      const userIds = new Set([...desiredByProject.get(p.id)!.keys()].flatMap((e) => matched.get(e)?.id ?? []))
      const scores = candidates
        .map((t) => ({
          team: t,
          score: fold(t.name) === fold(p.name)
            ? NAME_MATCH_SCORE
            : t.members.filter((m) => userIds.has(m.user_id)).length,
        }))
        .sort((a, b) => b.score - a.score)
      return { project: p, best: scores[0], runnerUp: scores[1]?.score ?? 0 }
    })
    scored.sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0))
    for (const { project, best, runnerUp } of scored) {
      if (best && best.score >= 2 && best.score > runnerUp && !usedTeamIds.has(best.team.id)) {
        target.set(project.id, { status: 'SUGGESTED', team: best.team })
        usedTeamIds.add(best.team.id)
      }
    }
    for (const p of open) if (!target.has(p.id)) target.set(p.id, { status: 'NEW', team: null })
  } else {
    for (const p of open) target.set(p.id, { status: 'SKIP', team: null })
  }

  const finalNameOwner = new Map(input.teams.map((t) => [fold(t.name), t.id]))
  for (const p of projects) {
    if (target.get(p.id)!.status !== 'NEW') continue
    if (finalNameOwner.has(fold(p.name))) errors.push(`Đã có team tên "${p.name}" — chọn gắn vào team đó thay vì tạo mới`)
  }

  const skipped: HrmSyncPlan['skipped'] = []
  const accounts = new Map<string, HrmSyncPlan['accounts_to_create'][number]>()
  const activeEmployeeIds = new Set(
    projects.filter((p) => target.get(p.id)!.status !== 'SKIP').flatMap((p) => [...desiredByProject.get(p.id)!.keys()]),
  )
  for (const id of activeEmployeeIds) {
    if (matched.has(id)) continue
    const e = employeeById.get(id)!
    const email = (e.email ?? '').trim().toLowerCase()
    const base = { hrm_employee_id: id, full_name: hrmDisplayName(e), email: email || null }
    if (!email.includes('@')) skipped.push({ ...base, reason: 'HRM chưa có email' })
    else if (deletedEmails.has(email)) skipped.push({ ...base, reason: 'Tài khoản dùng email này đã bị xoá ở AGV' })
    else if (byEmail.has(email)) skipped.push({ ...base, reason: 'Email đã thuộc tài khoản AGV gắn với nhân sự HRM khác' })
    else {
      const tokens = fold(e.fullName || e.displayName).split(' ').filter(Boolean)
      const possible = liveUsers
        .filter((u) => !claimed.has(u.id) && !u.hrm_employee_id && namesOverlap(tokens, fold(u.full_name).split(' ').filter(Boolean)))
        .slice(0, 5)
        .map((u) => ({ user_id: u.id, full_name: u.full_name, email: u.email }))
      accounts.set(id, {
        user_id: null, hrm_employee_id: id, full_name: base.full_name, email,
        kind: desiredKindOf(id), avatar_url: e.avatarUrl ?? null, possible_matches: possible,
      })
    }
  }

  function desiredKindOf(employeeId: string): HrmMemberKind | null {
    for (const m of desiredByProject.values()) if (m.has(employeeId)) return m.get(employeeId)!
    return null
  }

  const toMember = (u: SyncUser, kind: HrmMemberKind | null): HrmSyncMember => ({
    user_id: u.id, hrm_employee_id: u.hrm_employee_id, full_name: u.full_name, email: u.email, kind,
    ...(u.is_active ? {} : { inactive: true }),
  })

  const plans: HrmSyncProjectPlan[] = projects.map((p) => {
    const { status, team } = target.get(p.id)!
    const plan: HrmSyncProjectPlan = {
      project_id: p.id, project_name: p.name, status,
      team_id: team?.id ?? null, team_name: team?.name ?? null,
      rename: false, rename_conflict: false, add: [], remove: [], keep: [], flag_updates: [],
    }
    if (status === 'SKIP') return plan

    if (team && team.name !== p.name) {
      const owner = finalNameOwner.get(fold(p.name))
      if (owner && owner !== team.id) plan.rename_conflict = true
      else plan.rename = true
    }

    const desiredUserKinds = new Map<string, HrmMemberKind>()
    for (const [employeeId, kind] of desiredByProject.get(p.id)!) {
      const u = matched.get(employeeId)
      if (u) desiredUserKinds.set(u.id, kind)
      else if (accounts.has(employeeId)) plan.add.push(accounts.get(employeeId)!)
    }
    const current = new Map((team?.members ?? []).map((m) => [m.user_id, m]))
    for (const [userId, kind] of desiredUserKinds) {
      const u = userById.get(userId)!
      const membership = current.get(userId)
      if (!membership) plan.add.push(toMember(u, kind))
      else {
        plan.keep.push(toMember(u, kind))
        if (membership.is_content_creator !== (kind === 'CONTENT')) {
          plan.flag_updates.push({ user_id: userId, is_content_creator: kind === 'CONTENT' })
        }
      }
    }
    for (const m of team?.members ?? []) {
      if (desiredUserKinds.has(m.user_id) || m.user_id === team!.leader_id) continue
      const u = userById.get(m.user_id)
      plan.remove.push(u ? toMember(u, null) : { user_id: m.user_id, hrm_employee_id: null, full_name: m.user_id, email: null, kind: null })
    }
    return plan
  })

  const editorApprovals = new Set<string>()
  const userLinks: HrmSyncPlan['user_links'] = []
  for (const id of activeEmployeeIds) {
    const u = matched.get(id)
    if (!u) continue
    if (!u.hrm_employee_id) userLinks.push({ user_id: u.id, hrm_employee_id: id })
    if (desiredKindOf(id) === 'EDITOR' && !u.editor_approved) editorApprovals.add(u.id)
  }

  return {
    projects: plans,
    accounts_to_create: [...accounts.values()],
    user_links: userLinks,
    editor_approvals: [...editorApprovals],
    skipped,
    errors,
  }
}

export interface HrmSyncResult {
  teams_created: number
  teams_linked: number
  teams_renamed: number
  members_added: number
  members_removed: number
  accounts_created: number
  editors_approved: number
  skipped: HrmSyncPlan['skipped']
}

@Injectable()
export class HrmTeamSyncService {
  private readonly logger = new Logger(HrmTeamSyncService.name)
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private hrmConfig() {
    const rawBase = this.config.get<string>('VCB_HRM_BASE_URL')?.trim().replace(/\/$/, '')
    const baseUrl = rawBase && !/^https?:\/\//i.test(rawBase) ? `https://${rawBase}` : rawBase
    const apiKey = this.config.get<string>('VCB_HRM_API_KEY')?.trim()
    return baseUrl && apiKey ? { baseUrl, apiKey } : null
  }

  private async fetchHrm<T>(path: string): Promise<T> {
    const cfg = this.hrmConfig()
    if (!cfg) throw new ServiceUnavailableException('Chưa cấu hình VCB_HRM_BASE_URL / VCB_HRM_API_KEY')
    let res: Response
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        headers: { 'X-API-Key': cfg.apiKey },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e: any) {
      throw new BadGatewayException(`Không kết nối được HRM: ${e?.message ?? e}`)
    }
    if (!res.ok) throw new BadGatewayException(`HRM trả lỗi ${res.status} ở ${path.split('?')[0]}`)
    return (await res.json()) as T
  }

  private async loadInput(
    choices: Record<string, string>,
    accountLinks: Record<string, string>,
    suggestUnlinked: boolean,
  ): Promise<HrmSyncInput> {
    for (const [projectId, choice] of Object.entries(choices)) {
      if (!UUID_RE.test(projectId) || (choice !== NEW_TEAM && choice !== SKIP && !UUID_RE.test(choice))) {
        throw new BadRequestException('Lựa chọn gắn team không hợp lệ')
      }
    }
    for (const [employeeId, userId] of Object.entries(accountLinks)) {
      if (!UUID_RE.test(employeeId) || !UUID_RE.test(String(userId))) {
        throw new BadRequestException('Lựa chọn tài khoản có sẵn không hợp lệ')
      }
    }
    const { data: projects } = await this.fetchHrm<{ data: HrmProject[] }>('/public/v1/projects?status=ACTIVE')
    const employees: HrmEmployee[] = []
    for (let page = 1; ; page++) {
      const res = await this.fetchHrm<{ data: HrmEmployee[]; total: number }>(`/public/v1/employees?pageSize=500&page=${page}`)
      employees.push(...res.data)
      if (!res.data.length || employees.length >= res.total) break
    }

    const [teams, users] = await Promise.all([
      this.prisma.team.findMany({
        select: {
          id: true, name: true, is_active: true, hrm_project_id: true, leader_id: true,
          members: { select: { user_id: true, is_content_creator: true } },
        },
      }),
      this.prisma.user.findMany({
        select: {
          id: true, email: true, full_name: true, employee_id: true, hrm_employee_id: true, is_active: true,
          deleted_at: true,
          editor_approvals: { where: { status: 'APPROVED' }, select: { id: true }, take: 1 },
        },
      }),
    ])
    return {
      projects,
      employees,
      teams,
      users: users.map(({ deleted_at, editor_approvals, ...u }) => ({
        ...u, deleted: !!deleted_at, editor_approved: editor_approvals.length > 0,
      })),
      choices,
      accountLinks,
      suggestUnlinked,
    }
  }

  async preview(choices: Record<string, string>, accountLinks: Record<string, string>): Promise<HrmSyncPlan> {
    return buildHrmSyncPlan(await this.loadInput(choices, accountLinks, true))
  }

  async apply(
    choices: Record<string, string>,
    accountLinks: Record<string, string>,
    actorId: string | null,
  ): Promise<HrmSyncResult> {
    if (this.running) throw new ConflictException('Đang đồng bộ HRM, thử lại sau ít phút')
    this.running = true
    try {
      const plan = buildHrmSyncPlan(await this.loadInput(choices, accountLinks, false))
      if (plan.errors.length) throw new BadRequestException(plan.errors.join('. '))
      return await this.applyPlan(plan, actorId)
    } finally {
      this.running = false
    }
  }

  private async applyPlan(plan: HrmSyncPlan, actorId: string | null): Promise<HrmSyncResult> {
    const result: HrmSyncResult = {
      teams_created: 0, teams_linked: 0, teams_renamed: 0, members_added: 0, members_removed: 0,
      accounts_created: plan.accounts_to_create.length, editors_approved: 0, skipped: plan.skipped,
    }
    await this.prisma.$transaction(async (tx) => {
      const createdUserIds = new Map<string, string>()
      if (plan.accounts_to_create.length) {
        const rows = plan.accounts_to_create.map((a) => ({
          id: randomUUID(), email: a.email, full_name: a.full_name, roles: [UserRole.MEMBER],
          hrm_employee_id: a.hrm_employee_id, image_url: a.avatar_url,
        }))
        await tx.user.createMany({ data: rows })
        for (const r of rows) createdUserIds.set(r.hrm_employee_id, r.id)
      }
      if (plan.user_links.length) {
        await tx.$executeRaw`
          UPDATE users u SET hrm_employee_id = v.hrm_id::uuid
          FROM unnest(${plan.user_links.map((l) => l.user_id)}::text[], ${plan.user_links.map((l) => l.hrm_employee_id)}::text[]) AS v(uid, hrm_id)
          WHERE u.id::text = v.uid
        `
      }
      const resolveUserId = (m: HrmSyncMember) => m.user_id ?? createdUserIds.get(m.hrm_employee_id!)!

      const affected = new Set<string>()
      for (const p of plan.projects) {
        if (p.status === 'SKIP') continue
        let teamId = p.team_id
        let leaderId: string | null = null
        if (p.status === 'NEW') {
          teamId = (await tx.team.create({ data: { name: p.project_name, hrm_project_id: p.project_id } })).id
          result.teams_created++
        } else {
          const linking = p.status !== 'LINKED'
          if (linking || p.rename) {
            const updated = await tx.team.update({
              where: { id: teamId! },
              data: {
                ...(linking ? { hrm_project_id: p.project_id, is_active: true } : {}),
                ...(p.rename ? { name: p.project_name } : {}),
              },
              select: { leader_id: true },
            })
            leaderId = updated.leader_id
            if (linking) result.teams_linked++
            if (p.rename) result.teams_renamed++
          } else {
            leaderId = (await tx.team.findUnique({ where: { id: teamId! }, select: { leader_id: true } }))?.leader_id ?? null
          }
          if (p.rename) {
            const members = await tx.teamMember.findMany({ where: { team_id: teamId! }, select: { user_id: true } })
            members.forEach((m) => affected.add(m.user_id))
          }
        }

        if (p.remove.length) {
          const ids = p.remove.map((m) => m.user_id!)
          await tx.teamMember.deleteMany({ where: { team_id: teamId!, user_id: { in: ids } } })
          ids.forEach((id) => affected.add(id))
          result.members_removed += ids.length
        }
        if (p.add.length) {
          const rows = p.add.map((m) => ({ team_id: teamId!, user_id: resolveUserId(m), is_content_creator: m.kind === 'CONTENT' }))
          await tx.teamMember.createMany({ data: rows, skipDuplicates: true })
          rows.forEach((r) => affected.add(r.user_id))
          result.members_added += rows.length
          const setBy = actorId ?? leaderId
          if (setBy) await seedEditorKpiForMembers(tx, rows.map((r) => r.user_id), [teamId!], setBy)
        }
        for (const value of [true, false]) {
          const ids = p.flag_updates.filter((f) => f.is_content_creator === value).map((f) => f.user_id)
          if (ids.length) {
            await tx.teamMember.updateMany({ where: { team_id: teamId!, user_id: { in: ids } }, data: { is_content_creator: value } })
          }
        }
      }

      const approveIds = [
        ...plan.editor_approvals,
        ...plan.accounts_to_create.filter((a) => a.kind === 'EDITOR').map((a) => createdUserIds.get(a.hrm_employee_id)!),
      ]
      if (approveIds.length) {
        const approval = { status: 'APPROVED' as const, approved_by_id: actorId, approved_at: new Date(), note: 'Đồng bộ từ HRM' }
        const withRow = new Set(
          (await tx.editorApproval.findMany({ where: { user_id: { in: approveIds } }, select: { user_id: true } })).map((r) => r.user_id),
        )
        if (withRow.size) await tx.editorApproval.updateMany({ where: { user_id: { in: [...withRow] } }, data: approval })
        const fresh = approveIds.filter((id) => !withRow.has(id))
        if (fresh.length) await tx.editorApproval.createMany({ data: fresh.map((user_id) => ({ user_id, ...approval })) })
        result.editors_approved = approveIds.length
      }

      await recomputeUserTeamFieldsBatch(tx, [...affected])
    }, HRM_SYNC_TX_OPTIONS)
    return result
  }

  @Cron('0 30 6 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledSync(): Promise<void> {
    if (!this.prisma.isHealthy || !this.hrmConfig()) return
    if (!(await this.prisma.team.count({ where: { hrm_project_id: { not: null } } }))) return
    try {
      const r = await this.apply({}, {}, null)
      this.logger.log(
        `[HrmTeamSync] +${r.members_added}/-${r.members_removed} thành viên, ${r.accounts_created} tài khoản mới, ` +
        `${r.teams_renamed} team đổi tên, ${r.skipped.length} nhân sự bỏ qua`,
      )
    } catch (e: any) {
      this.logger.warn(`[HrmTeamSync] lỗi: ${e?.message ?? e}`)
    }
  }
}

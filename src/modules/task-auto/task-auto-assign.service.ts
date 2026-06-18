import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { AssignmentRunStatus } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { UpdateAutoAssignSettingDto } from './dto/settings.dto'

// ── Constants ────────────────────────────────────────────────────────────────

const DEADLINE_WORKING_DAYS = 1
const DEFAULT_TZ = 'Asia/Ho_Chi_Minh'
const FILL_STRATEGY: 'CAPACITY' | 'RATIO' = 'CAPACITY'

// ── Data structures ──────────────────────────────────────────────────────────

type EditorSlot = {
  userId: string
  remainingDaily: number
  remainingMonthly: number
  extraDailyTarget: number      // daily target cho task thêm
  extraMonthlyRemaining: number // KPI thêm còn lại tháng này
}

type Candidate = {
  contentId: string
  productId: string
  contentLineId: string | null
  productLineId: string | null
  priorityScore: number
}

type QuotaItem = { key: string; weight: number }

type Pairing = { editorId: string; candidate: Candidate }

type TeamResult = {
  assigned: number
  extraAssigned: number
  skipped: number
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function isSunday(d: DateTime): boolean {
  return d.weekday === 7
}

function monthKey(d: DateTime): string {
  return d.toFormat('yyyy-MM')
}

// Deadline: bỏ qua Chủ nhật, tính ngày làm việc tiếp theo
function addWorkingDays(d: DateTime, n: number): DateTime {
  let r = d
  let left = n
  while (left > 0) {
    r = r.plus({ days: 1 })
    if (!isSunday(r)) left--
  }
  return r
}

// Đếm số ngày Thứ 2–Thứ 7 còn lại trong tháng (kể cả hôm nay)
function remainingWeekdays(today: DateTime): number {
  const last = today.endOf('month').startOf('day')
  let count = 0
  let d = today.startOf('day')
  while (d <= last) {
    if (!isSunday(d)) count++
    d = d.plus({ days: 1 })
  }
  return count
}

// Largest Remainder: phân chia `total` số nguyên theo tỉ lệ weight
function largestRemainder(total: number, items: QuotaItem[]): Map<string, number> {
  const out = new Map<string, number>()
  if (total <= 0 || !items.length) return out
  const sumW = items.reduce((s, i) => s + Math.max(0, i.weight), 0)
  if (sumW <= 0) return out
  const rows = items.map(i => {
    const exact = (total * Math.max(0, i.weight)) / sumW
    return { key: i.key, floor: Math.floor(exact), rem: exact - Math.floor(exact) }
  })
  let left = total - rows.reduce((s, r) => s + r.floor, 0)
  rows.sort((a, b) => (b.rem - a.rem) || (a.key < b.key ? -1 : 1))
  // left <= rows.length nên vòng lặp này không bao giờ lặp lại
  for (let i = 0; i < left; i++) rows[i].floor++
  for (const r of rows) out.set(r.key, r.floor)
  return out
}

// Tính KPI ngày cho ngày thường (Thứ 2–Thứ 7).
// Chủ nhật KHÔNG dùng hàm này — dùng EditorWeekendKpi trực tiếp.
function deriveDailyTarget(
  monthlyTarget: number,
  doneThisMonth: number,
  today: DateTime,
): number {
  const remaining = Math.max(0, monthlyTarget - doneThisMonth)
  if (remaining === 0) return 0
  const weekdays = remainingWeekdays(today)
  if (weekdays <= 0) return remaining
  return Math.min(remaining, Math.ceil(remaining / weekdays))
}

// ── Per-editor pair selection ─────────────────────────────────────────────────
//
// Thuật toán content-first (đảm bảo tỉ lệ tuyến nội dung luôn được tôn trọng):
//
//  PASS 1 — Content-line quota:
//    Với mỗi tuyến nội dung (theo tỉ lệ KPI team), lấy đúng số slot đã tính.
//    Trong mỗi slot, ưu tiên candidate có product khớp product-line quota,
//    sau đó fallback sang bất kỳ product nào trong tuyến content đó.
//
//  PASS 2 — Product-only (khi không có content quota):
//    Chọn theo product-line quota trước, rồi bất kỳ.
//
//  RELAXED PASS (CAPACITY): lấp đầy slot còn thiếu bằng bất kỳ candidate chưa dùng.
//
// candidates đã được lọc theo lịch sử của editor → không cần dedup global.

function selectPairsForEditor(
  candidates: Candidate[],
  contentQuota: Map<string, number>,
  productQuota: Map<string, number>,
  need: number,
  fillStrategy: 'CAPACITY' | 'RATIO',
): Candidate[] {
  const selected: Candidate[] = []
  const chosen = new Set<string>()
  const remP = new Map(productQuota)
  const contentConstrained = contentQuota.size > 0
  const productConstrained = productQuota.size > 0

  const pairKey = (c: Candidate) => `${c.contentId}:${c.productId}`

  const take = (c: Candidate) => {
    selected.push(c)
    chosen.add(pairKey(c))
    need--
    if (productConstrained && c.productLineId) {
      remP.set(c.productLineId, (remP.get(c.productLineId) ?? 0) - 1)
    }
  }

  if (contentConstrained) {
    // PASS 1: Content-first — đảm bảo đúng tỉ lệ tuyến nội dung
    for (const [lineId, slots] of contentQuota) {
      const lineCandidates = candidates.filter(c => c.contentLineId === lineId)
      let taken = 0

      // Sub-pass A: ưu tiên candidate có product khớp product-line quota
      if (productConstrained) {
        for (const c of lineCandidates) {
          if (taken >= slots || need === 0) break
          if (chosen.has(pairKey(c))) continue
          if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0) {
            take(c); taken++
          }
        }
      }

      // Sub-pass B: lấp nốt slot của tuyến này bằng bất kỳ product
      for (const c of lineCandidates) {
        if (taken >= slots || need === 0) break
        if (chosen.has(pairKey(c))) continue
        take(c); taken++
      }
    }
  } else if (productConstrained) {
    // PASS 2: Không có content quota → chọn theo product quota
    for (const c of candidates) {
      if (need === 0) break
      if (chosen.has(pairKey(c))) continue
      if (c.productLineId != null && (remP.get(c.productLineId) ?? 0) > 0) take(c)
    }
  }

  // RELAXED PASS: lấp đầy bằng cặp bất kỳ chưa dùng (chỉ khi CAPACITY)
  if (fillStrategy === 'CAPACITY' && need > 0) {
    for (const c of candidates) {
      if (need === 0) break
      if (chosen.has(pairKey(c))) continue
      take(c)
    }
  }

  return selected
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TaskAutoAssignService {
  private readonly logger = new Logger(TaskAutoAssignService.name)

  constructor(private prisma: PrismaService) {}

  // ── Settings ─────────────────────────────────────────────────────────────

  async getSettings() {
    return this.prisma.autoAssignSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    })
  }

  async updateSettings(dto: UpdateAutoAssignSettingDto, userId: string) {
    return this.prisma.autoAssignSetting.upsert({
      where: { id: 1 },
      create: { id: 1, ...dto, updated_by: userId },
      update: { ...dto, updated_by: userId },
    })
  }

  async getRuns(limit = 50) {
    return this.prisma.assignmentRun.findMany({
      orderBy: { run_at: 'desc' },
      take: limit,
    })
  }

  // ── Cron ─────────────────────────────────────────────────────────────────

  @Cron('* * * * *', { name: 'task-auto-assign' })
  async cronCheck() {
    try {
      const settings = await this.prisma.autoAssignSetting.findUnique({ where: { id: 1 } })
      if (!settings) {
        this.logger.warn('cronCheck: no settings row found (id=1)')
        return
      }
      if (!settings.is_active) return

      const now = DateTime.now().setZone(settings.timezone || DEFAULT_TZ)
      if (isSunday(now) && !settings.weekend_enabled) return

      const [hh, mm] = (settings.schedule_time || '17:00').split(':').map(Number)
      if (now.hour !== hh || now.minute !== mm) return

      this.logger.log(`cronCheck: time matched ${settings.schedule_time} in ${settings.timezone} — checking dedup`)

      const windowStart = now.startOf('minute').toJSDate()
      const windowEnd = new Date(windowStart.getTime() + 60_000)
      const recentRun = await this.prisma.assignmentRun.findFirst({
        where: { run_at: { gte: windowStart, lt: windowEnd } },
      })
      if (recentRun) {
        this.logger.log(`cronCheck: skipped — run ${recentRun.id} already exists this minute (status: ${recentRun.status})`)
        return
      }

      this.logger.log('cronCheck: launching runDailyAssignment')
      // forceRun=true: the minute-window recentRun check above already prevents
      // double-execution; forceRun skips the day-level existingDone check so a
      // manual "Chạy ngay" earlier in the day doesn't block the scheduled run.
      await this.runDailyAssignment(now, true)
    } catch (err) {
      this.logger.error('Cron check failed', err)
    }
  }

  async triggerManually(): Promise<{ assigned: number; skipped: number; runId: string }> {
    const now = DateTime.now().setZone(DEFAULT_TZ)
    return this.runDailyAssignment(now, true)
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  async runDailyAssignment(
    now: DateTime = DateTime.now().setZone(DEFAULT_TZ),
    forceRun = false,
  ): Promise<{ assigned: number; skipped: number; runId: string }> {
    const settings = await this.prisma.autoAssignSetting.findUnique({ where: { id: 1 } })
    if (!settings?.is_active) return { assigned: 0, skipped: 0, runId: '' }

    const sundayEnabled = settings?.weekend_enabled ?? true
    if (isSunday(now) && !sundayEnabled) return { assigned: 0, skipped: 0, runId: '' }

    if (!forceRun) {
      const dayStart = now.startOf('day').toJSDate()
      const dayEnd = now.endOf('day').toJSDate()
      const existingDone = await this.prisma.assignmentRun.findFirst({
        where: { status: AssignmentRunStatus.DONE, run_at: { gte: dayStart, lte: dayEnd } },
      })
      if (existingDone) {
        this.logger.log(`Assignment already done today (run ${existingDone.id}), skipping`)
        return { assigned: 0, skipped: 0, runId: existingDone.id }
      }
    }

    const run = await this.prisma.assignmentRun.create({ data: { status: AssignmentRunStatus.RUNNING } })
    const month = monthKey(now)
    const monthStart = now.startOf('month').toJSDate()
    const deadline = addWorkingDays(now, DEADLINE_WORKING_DAYS).toJSDate()

    try {
      const teams = await this.prisma.team.findMany({ where: { is_active: true } })
      let totalAssigned = 0
      let totalExtra = 0
      const details: Record<string, any> = {}

      for (const team of teams) {
        const result = await this.processTeam(
          team.id, now, month, monthStart, run.id, deadline,
        )
        totalAssigned += result.assigned
        totalExtra += result.extraAssigned
        details[team.id] = { team_name: team.name, ...result }
      }

      await this.prisma.assignmentRun.update({
        where: { id: run.id },
        data: {
          status: AssignmentRunStatus.DONE,
          total_assigned: totalAssigned + totalExtra,
          total_skipped: 0,
          details: { ...details, _totals: { auto_assigned: totalAssigned, extra_assigned: totalExtra } } as any,
          finished_at: new Date(),
        },
      })

      this.logger.log(`Run ${run.id} DONE: auto=${totalAssigned} extra=${totalExtra}`)
      return { assigned: totalAssigned + totalExtra, skipped: 0, runId: run.id }
    } catch (err) {
      this.logger.error(`Run ${run.id} FAILED`, err)
      await this.prisma.assignmentRun.update({
        where: { id: run.id },
        data: {
          status: AssignmentRunStatus.FAILED,
          error_msg: err instanceof Error ? err.message : String(err),
          finished_at: new Date(),
        },
      }).catch(() => null)
      throw err
    }
  }

  // ── Per-team orchestration ────────────────────────────────────────────────
  //
  // Luồng mới:
  //  1. Lấy editors đủ điều kiện + dailyTarget
  //  2. Load base candidates (content × team products)
  //  3. Load quota allocations từ TeamKpi
  //  4. Với MỖI editor:
  //     a. Lọc candidates bỏ cặp editor đã từng có task
  //     b. Tính quota riêng cho editor theo dailyTarget của họ
  //     c. Chọn dailyTarget cặp theo quota
  //  5. Persist tất cả pairings (không lock ContentProduct)

  private async processTeam(
    teamId: string,
    now: DateTime,
    month: string,
    monthStart: Date,
    runId: string,
    deadline: Date,
  ): Promise<TeamResult> {
    // 1. Editors đủ điều kiện
    const editors = await this.getEligibleEditors(teamId, now, month, monthStart)
    if (!editors.length) {
      this.logger.log(`Team ${teamId}: no eligible editors`)
      return { assigned: 0, extraAssigned: 0, skipped: 0 }
    }

    // 2. Base candidates: tất cả (content, product) hợp lệ của team
    const baseCandidates = await this.getBaseCandidates(teamId)
    if (!baseCandidates.length) {
      this.logger.log(`Team ${teamId}: no candidates (check team products & content)`)
      return { assigned: 0, extraAssigned: 0, skipped: 0 }
    }

    // 3. Quota allocations từ TeamKpi tháng này
    const { contentItems, productItems } = await this.getQuotaAllocations(teamId, month)
    this.logger.log(
      `Team ${teamId}: contentAllocs=[${contentItems.map(i => `${i.key}:${i.weight}%`).join(',')}] ` +
      `productAllocs=[${productItems.map(i => `${i.key}:${i.weight}%`).join(',')}]`,
    )

    // 4a. Per-editor auto task selection
    const allPairings: Pairing[] = []

    for (const editor of editors) {
      if (editor.remainingDaily <= 0) continue

      const existingPairs = await this.getEditorExistingPairs(editor.userId)
      const available = baseCandidates.filter(
        c => !existingPairs.has(`${c.contentId}:${c.productId}`),
      )

      if (!available.length) {
        this.logger.log(`Team ${teamId} editor ${editor.userId}: all auto pairs already assigned`)
        continue
      }

      const contentQuota = contentItems.length
        ? largestRemainder(editor.remainingDaily, contentItems)
        : new Map<string, number>()
      const productQuota = productItems.length
        ? largestRemainder(editor.remainingDaily, productItems)
        : new Map<string, number>()

      const selected = selectPairsForEditor(
        available, contentQuota, productQuota, editor.remainingDaily, FILL_STRATEGY,
      )

      this.logger.log(
        `Team ${teamId} editor ${editor.userId}: autoTarget=${editor.remainingDaily} selected=${selected.length}`,
      )

      for (const candidate of selected) {
        allPairings.push({ editorId: editor.userId, candidate })
      }
    }

    // 4b. Extra tasks — không cần cặp content×product, chỉ tạo N task trống
    let extraAssigned = 0
    for (const editor of editors) {
      if (editor.extraDailyTarget <= 0) continue
      extraAssigned += await this.createExtraTasksForEditor(
        editor.userId, teamId, runId, deadline, editor.extraDailyTarget, now,
      )
    }

    // 5. Persist auto pairings
    const assigned = await this.persistPairings(teamId, runId, deadline, allPairings)

    return { assigned, extraAssigned, skipped: 0 }
  }

  // ── Eligible editors ──────────────────────────────────────────────────────
  //
  // Điều kiện:
  //  - user.is_active = true
  //  - Có EditorApproval status=APPROVED
  //  - Có EditorKpi tháng này, total_target > 0
  //  - remainingDaily > 0 (sau khi tính KPI ngày)

  private async getEligibleEditors(
    teamId: string,
    now: DateTime,
    month: string,
    monthStart: Date,
  ): Promise<EditorSlot[]> {
    // Load toàn bộ Sunday KPI cho ngày hôm nay một lần (tránh N queries trong loop)
    const todayStr = now.toFormat('yyyy-MM-dd')
    const sundayKpiMap = isSunday(now)
      ? new Map(
          (await this.prisma.editorWeekendKpi.findMany({
            where: { date: todayStr },
            select: { user_id: true, kpi: true },
          })).map(k => [k.user_id, k.kpi]),
        )
      : new Map<string, number>()

    const members = await this.prisma.teamMember.findMany({
      where: { team_id: teamId },
      include: {
        user: {
          select: {
            id: true,
            is_active: true,
            editor_approvals: { where: { status: 'APPROVED' }, select: { id: true } },
            editor_kpis: { where: { month }, select: { total_target: true, kpi_extra: true } },
          },
        },
      },
    })

    const slots: EditorSlot[] = []

    for (const member of members) {
      const u = member.user
      if (!u.is_active || !u.editor_approvals.length) continue

      const kpi = u.editor_kpis[0]
      if (!kpi || (kpi.total_target <= 0 && (kpi.kpi_extra ?? 0) <= 0)) continue

      // Đếm task AUTO đã gán tháng này (không tính extra, không tính CANCELLED)
      const assignedThisMonth = await this.prisma.task.count({
        where: {
          assignee_id: u.id,
          is_extra: false,
          assigned_at: { gte: monthStart },
          status: { not: 'CANCELLED' },
        },
      })

      const remainingMonthly = Math.max(0, kpi.total_target - assignedThisMonth)

      // Chủ nhật: dùng KPI riêng từ EditorWeekendKpi (leader set cho từng người)
      // Ngày thường (Thứ 2–Thứ 7): chia đều KPI còn lại trên số ngày thường còn lại
      const dailyTarget = isSunday(now)
        ? (sundayKpiMap.get(u.id) ?? 0)
        : deriveDailyTarget(kpi.total_target, assignedThisMonth, now);
      const remainingDaily = Math.max(0, Math.min(dailyTarget, remainingMonthly));

      // KPI thêm: chỉ giao vào ngày thường (Thứ 2–Thứ 7)
      const assignedExtraThisMonth = await this.prisma.task.count({
        where: {
          assignee_id: u.id,
          is_extra: true,
          assigned_at: { gte: monthStart },
          status: { not: 'CANCELLED' },
        },
      });
      const monthlyExtra = Math.max(0, kpi.kpi_extra ?? 0);
      const extraMonthlyRemaining = Math.max(0, monthlyExtra - assignedExtraThisMonth);
      const extraDailyTarget =
        !isSunday(now) && monthlyExtra > 0
          ? Math.min(
              extraMonthlyRemaining,
              deriveDailyTarget(monthlyExtra, assignedExtraThisMonth, now),
            )
          : 0;

      this.logger.log(
        `Editor ${u.id}: autoTarget=${remainingDaily}/${kpi.total_target} ` +
        `extraTarget=${extraDailyTarget}/${monthlyExtra} (kpi_extra=${kpi.kpi_extra ?? 0})`,
      )

      if (remainingDaily > 0 || extraDailyTarget > 0) {
        slots.push({ userId: u.id, remainingDaily, remainingMonthly, extraDailyTarget, extraMonthlyRemaining })
      }
    }

    return slots
  }

  // ── Base candidates ───────────────────────────────────────────────────────
  //
  // Tất cả (content, product) hợp lệ của team — KHÔNG lọc theo ContentProduct.status
  // Việc lọc theo lịch sử cụ thể từng editor sẽ được làm ở processTeam

  private async getBaseCandidates(teamId: string): Promise<Candidate[]> {
    const [contents, teamProducts] = await Promise.all([
      this.prisma.content.findMany({
        where: { status: { not: 'ARCHIVED' } },
        select: { id: true, content_line_id: true, created_at: true },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.teamProduct.findMany({
        where: { team_id: teamId },
        select: {
          product: {
            select: { id: true, product_line_id: true, priority_score: true, is_active: true },
          },
        },
      }),
    ])

    const products = teamProducts.map(tp => tp.product).filter(p => p.is_active)
    if (!contents.length || !products.length) return []

    // Sản phẩm ưu tiên cao hơn xếp trước
    const sortedProducts = [...products].sort((a, b) => b.priority_score - a.priority_score)
    const candidates: Candidate[] = []

    for (const product of sortedProducts) {
      for (const content of contents) {
        candidates.push({
          contentId: content.id,
          productId: product.id,
          contentLineId: content.content_line_id,
          productLineId: product.product_line_id,
          priorityScore: product.priority_score,
        })
      }
    }

    return candidates
  }

  // ── Editor existing pairs ─────────────────────────────────────────────────
  //
  // Trả về Set của "contentId:productId" mà editor đã từng được gán task
  // (bất kỳ trạng thái nào — CANCELLED cũng được tính để tránh tái gán)

  private async getEditorExistingPairs(editorId: string): Promise<Set<string>> {
    const tasks = await this.prisma.task.findMany({
      where: { assignee_id: editorId, product_id: { not: null }, is_extra: false },
      select: { content_id: true, product_id: true },
    })
    return new Set(tasks.map(t => `${t.content_id}:${t.product_id}`))
  }

  // ── Quota allocations ─────────────────────────────────────────────────────
  //
  // Trả về raw items để có thể gọi largestRemainder(editorDailyTarget, items)
  // → mỗi editor nhận quota riêng tỉ lệ với dailyTarget của họ

  private async getQuotaAllocations(
    teamId: string,
    month: string,
  ): Promise<{ contentItems: QuotaItem[]; productItems: QuotaItem[] }> {
    const teamKpi = await this.prisma.teamKpi.findUnique({
      where: { team_id_month: { team_id: teamId, month } },
      include: { allocations: true },
    })

    if (!teamKpi) return { contentItems: [], productItems: [] }

    const contentItems = teamKpi.allocations
      .filter(a => a.type === 'CONTENT_LINE' && a.content_line_id != null)
      .map(a => ({ key: a.content_line_id!, weight: a.percent }))

    const productItems = teamKpi.allocations
      .filter(a => a.type === 'PRODUCT_LINE' && a.product_line_id != null)
      .map(a => ({ key: a.product_line_id!, weight: a.percent }))

    return { contentItems, productItems }
  }

  // ── Persist pairings ──────────────────────────────────────────────────────
  //
  // KHÔNG còn lock ContentProduct.
  // Mỗi editor nhận task riêng — nhiều editor có thể có cùng (content, product).
  // Uniqueness đã được đảm bảo ở bước getEditorExistingPairs().

  private async persistPairings(
    teamId: string,
    runId: string,
    deadline: Date,
    pairings: Pairing[],
  ): Promise<number> {
    let created = 0

    for (const { editorId, candidate } of pairings) {
      try {
        await this.prisma.$transaction(async tx => {
          const outroSource = await tx.source.findFirst({
            where: { product_id: candidate.productId, type: 'OUTRO', is_active: true },
            select: { id: true },
          })

          const task = await tx.task.create({
            data: {
              team_id: teamId,
              content_id: candidate.contentId,
              product_id: candidate.productId,
              content_line_id: candidate.contentLineId,
              source_outro_id: outroSource?.id ?? null,
              status: 'ASSIGNED',
              assignee_id: editorId,
              assigned_at: new Date(),
              deadline,
              is_auto: true,
              is_extra: false,
              run_id: runId,
            },
          })

          await tx.taskAssignment.create({
            data: { task_id: task.id, user_id: editorId, deadline, run_id: runId },
          })

          await tx.notification.create({
            data: {
              user_id: editorId,
              type: 'TASK_ASSIGNED',
              title: 'Task mới được phân công tự động',
              body: `Bạn có task mới cần hoàn thành trước ${deadline.toLocaleDateString('vi-VN')}.`,
              task_id: task.id,
            },
          })

          created++
        })
      } catch (err) {
        this.logger.warn(
          `Failed to persist pairing editor=${editorId} content=${candidate.contentId} product=${candidate.productId}`,
          err,
        )
      }
    }

    return created
  }

  // ── Extra tasks ───────────────────────────────────────────────────────────
  //
  // Không cặp content×product — tạo N task trống, editor tự nộp kết quả.
  // Kiểm tra hôm nay đã tạo bao nhiêu để tránh tạo thừa khi trigger lại.

  private async createExtraTasksForEditor(
    editorId: string,
    teamId: string,
    runId: string,
    deadline: Date,
    extraDailyTarget: number,
    now: DateTime,
  ): Promise<number> {
    const todayStart = now.startOf('day').toJSDate()

    const alreadyToday = await this.prisma.task.count({
      where: { assignee_id: editorId, is_extra: true, assigned_at: { gte: todayStart } },
    })

    const toCreate = Math.max(0, extraDailyTarget - alreadyToday)
    if (toCreate === 0) return 0

    let created = 0
    for (let i = 0; i < toCreate; i++) {
      try {
        const task = await this.prisma.task.create({
          data: {
            team_id: teamId,
            content_id: null,
            product_id: null,
            status: 'ASSIGNED',
            assignee_id: editorId,
            assigned_at: new Date(),
            deadline,
            is_auto: true,
            is_extra: true,
            run_id: runId,
          },
        })

        await this.prisma.taskAssignment.create({
          data: { task_id: task.id, user_id: editorId, deadline, run_id: runId },
        })

        await this.prisma.notification.create({
          data: {
            user_id: editorId,
            type: 'TASK_ASSIGNED',
            title: 'Task thêm được phân công tự động',
            body: `Bạn có task thêm mới cần hoàn thành trước ${deadline.toLocaleDateString('vi-VN')}.`,
            task_id: task.id,
          },
        })

        created++
      } catch (err) {
        this.logger.warn(`Failed to create extra task for editor=${editorId}`, err)
      }
    }

    this.logger.log(`Editor ${editorId}: created ${created}/${toCreate} extra tasks`)
    return created
  }
}

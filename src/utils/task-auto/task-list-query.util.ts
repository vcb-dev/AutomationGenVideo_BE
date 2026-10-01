import { QueryTaskDto } from '../../modules/task-auto/tasks/dto/task.dto'
import { parseTeamIdFilter } from '../../common/utils/team-membership.util'

// Khoảng ngày lọc theo hạn chót; task chưa có hạn chót thì tính theo ngày tạo thay thế — dùng chung
// cho danh sách task (buildTaskListWhere) và getHeaderCounts(), tránh lệch ngữ nghĩa giữa 2 nơi.
export function buildDeadlineRangeAnd(from?: string, to?: string) {
  if (!from && !to) return null
  const rangeStart = from ? new Date(`${from}T00:00:00+07:00`) : undefined
  const rangeEnd = to ? new Date(`${to}T23:59:59.999+07:00`) : undefined
  const bounds: { gte?: Date; lte?: Date } = {}
  if (rangeStart) bounds.gte = rangeStart
  if (rangeEnd) bounds.lte = rangeEnd
  return {
    OR: [
      { deadline: bounds },
      { deadline: null, created_at: bounds },
    ],
  }
}

/** Tạo cùng một Prisma where cho danh sách task và file export. */
export function buildTaskListWhere(q: QueryTaskDto) {
  const where: any = {}
  const and: any[] = []
  // Trạng thái coi như "xong việc" — task ở đây không tính trễ hạn dù deadline đã qua.
  // Phải khớp isOverdue() ở FE (src/components/task-auto/helpers.ts và PersonalDashboard.tsx).
  const doneStatuses = ['APPROVED', 'CANCELLED']

  const teamIdFilter = parseTeamIdFilter(q.team_id)
  if (teamIdFilter) where.team_id = teamIdFilter
  if (q.assignee_id) where.assignee_id = q.assignee_id
  if (q.task_type === 'auto') where.task_type = 'AUTO'
  if (q.task_type === 'extra') where.task_type = 'EXTRA'

  if (q.overdue === 'true') {
    // Cột "Quá hạn" ảo (Kanban): không phải 1 status thật nên bỏ qua q.status/deadline_from/to/
    // deadline_date/month — trễ hạn tự neo theo thời điểm hiện tại, không phải khoảng ngày lọc thêm.
    and.push({ deadline: { lt: new Date() } })
    and.push({ status: { notIn: doneStatuses } })
  } else {
    if (q.status) where.status = q.status
    if (q.deadline_from || q.deadline_to) {
      and.push(buildDeadlineRangeAnd(q.deadline_from, q.deadline_to)!)
    } else if (q.deadline_date) {
      const dayStart = new Date(`${q.deadline_date}T00:00:00+07:00`)
      const dayEnd = new Date(`${q.deadline_date}T23:59:59.999+07:00`)
      // Task có deadline rơi vào ngày lọc; task chưa có deadline thì tính theo ngày tạo thay thế.
      and.push({
        OR: [
          { deadline: { gte: dayStart, lte: dayEnd } },
          { deadline: null, created_at: { gte: dayStart, lte: dayEnd } },
        ],
      })
    } else if (q.month) {
      const start = new Date(`${q.month}-01`)
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
      where.created_at = { gte: start, lt: end }
    }

    if (q.exclude_overdue === 'true') {
      // Task trễ hạn giờ dồn về cột "Quá hạn" riêng — loại khỏi các cột trạng thái khác
      // (trừ APPROVED/CANCELLED, vốn không tính trễ hạn) để tránh hiển thị trùng 2 nơi.
      and.push({
        OR: [
          { deadline: null },
          { deadline: { gte: new Date() } },
          { status: { in: doneStatuses } },
        ],
      })
    }
  }
  if (q.search) {
    where.content = { title: { contains: q.search, mode: 'insensitive' } }
  }
  if (q.reviewed_from || q.reviewed_to) {
    const bounds: { gte?: Date; lte?: Date } = {}
    if (q.reviewed_from) bounds.gte = new Date(`${q.reviewed_from}T00:00:00+07:00`)
    if (q.reviewed_to) bounds.lte = new Date(`${q.reviewed_to}T23:59:59.999+07:00`)
    where.reviewed_at = bounds
  }
  if (and.length) where.AND = and

  return where
}

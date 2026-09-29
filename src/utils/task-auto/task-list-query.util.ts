import { QueryTaskDto } from '../../modules/task-auto/tasks/dto/task.dto'
import { parseTeamIdFilter } from '../../common/utils/team-membership.util'

function buildDeadlineRange(from?: string, to?: string) {
  if (!from && !to) return null

  const rangeStart = from
    ? new Date(`${from}T00:00:00+07:00`)
    : undefined
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
  const doneStatuses = ['APPROVED', 'CANCELLED']

  const teamIdFilter = parseTeamIdFilter(q.team_id)
  if (teamIdFilter) where.team_id = teamIdFilter
  if (q.assignee_id) where.assignee_id = q.assignee_id
  if (q.task_type === 'auto') where.task_type = 'AUTO'
  if (q.task_type === 'extra') where.task_type = 'EXTRA'

  if (q.overdue === 'true') {
    and.push({ deadline: { lt: new Date() } })
    and.push({ status: { notIn: doneStatuses } })
  } else {
    if (q.status) where.status = q.status
    if (q.deadline_from || q.deadline_to) {
      and.push(buildDeadlineRange(q.deadline_from, q.deadline_to)!)
    } else if (q.deadline_date) {
      const dayStart = new Date(`${q.deadline_date}T00:00:00+07:00`)
      const dayEnd = new Date(`${q.deadline_date}T23:59:59.999+07:00`)
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
    if (q.reviewed_from) {
      bounds.gte = new Date(`${q.reviewed_from}T00:00:00+07:00`)
    }
    if (q.reviewed_to) {
      bounds.lte = new Date(`${q.reviewed_to}T23:59:59.999+07:00`)
    }
    where.reviewed_at = bounds
  }
  if (and.length) where.AND = and

  return where
}

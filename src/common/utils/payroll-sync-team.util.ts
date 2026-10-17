import { Prisma } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hệ thống lương lấy team từ HRM (team lương = dự án HRM) nên gọi các endpoint payroll-sync bằng
 * id dự án HRM; id team AGV vẫn dùng được. Hai cột đều unique và đều là UUID ngẫu nhiên nên không
 * thể trỏ nhầm sang hai team khác nhau.
 */
export function payrollSyncTeamWhere(idOrHrmProjectId: string): Prisma.TeamWhereInput {
  return UUID_RE.test(idOrHrmProjectId)
    ? { OR: [{ id: idOrHrmProjectId }, { hrm_project_id: idOrHrmProjectId }] }
    : { id: idOrHrmProjectId };
}

export const PAYROLL_SYNC_TEAM_SELECT = {
  id: true,
  name: true,
  hrm_project_id: true,
} satisfies Prisma.TeamSelect;

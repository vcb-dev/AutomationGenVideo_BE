import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../../common/prisma/prisma.service'

/**
 * Tự phục hồi field phái sinh User.team từ nguồn sự thật team_members/teams.
 *
 * Vì sao cần: có writer NGOÀI repo (job sync HR/Lark chạy ~13:00-13:35 giờ VN hằng ngày,
 * đã ghi nhận 2026-07-10) ghi đè users.team = null cho user có lark_employee_record_id —
 * làm trang Hiệu suất (seed roster từ users.team) mất thành viên dù trang Đội nhóm
 * (đọc team_members) vẫn đủ. Chừng nào job đó chưa được sửa, cron này kéo users.team
 * về đúng giá trị phái sinh.
 *
 * Chỉ sửa user ĐANG CÓ membership (INNER JOIN team_members) — user có team gán tay nhưng
 * không có membership (dữ liệu cũ trước migration, vd team "Đồ Da") được giữ nguyên.
 * Cùng công thức string_agg với recomputeUserTeamFieldsBatch (team-membership.util.ts).
 */
@Injectable()
export class TeamDerivedSyncService implements OnModuleInit {
  private readonly logger = new Logger(TeamDerivedSyncService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Tự chữa ngay khi boot (không chặn startup) — nếu wipe xảy ra lúc app không chạy cron.
    this.resyncDriftedUserTeams().catch((e) =>
      this.logger.warn(`[TeamDerivedSync] resync on boot failed: ${e?.message ?? e}`),
    )
  }

  /** Mỗi 30 phút (phút 10 và 40 — tránh trùng khung 13:00-13:35 job ngoài đang chạy dở). */
  @Cron('0 10,40 * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async resyncDriftedUserTeams(): Promise<void> {
    if (!this.prisma.isHealthy) return
    const n = await this.prisma.$executeRaw`
      UPDATE users u
      SET team = sub.expected_team
      FROM (
        SELECT tm.user_id, string_agg(t.name, ',' ORDER BY t.name) AS expected_team
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        GROUP BY tm.user_id
      ) sub
      WHERE u.id = sub.user_id
        AND COALESCE(u.team, '') IS DISTINCT FROM sub.expected_team
    `
    if (n > 0) {
      this.logger.warn(
        `[TeamDerivedSync] Resynced users.team cho ${n} user — có writer ngoài đang ghi đè field phái sinh (nghi job sync HR/Lark ngoài repo).`,
      )
    }
  }
}

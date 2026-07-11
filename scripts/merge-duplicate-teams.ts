/**
 * Migration một lần: gộp các dòng `teams` trùng lặp (cùng team khái niệm nhưng tên chuỗi
 * khác biến thể — dấu gạch ngang/khoảng trắng) về 1 dòng chuẩn (canonical).
 *
 * Bối cảnh: `resolveTeamsByName` (team-membership.util.ts) upsert Team theo TÊN CHÍNH XÁC,
 * trong khi dashboard (lark.service.ts normalizeTeamKey) so khớp team đã bỏ dấu + bỏ gạch
 * ngang. Hệ quả: nhiều tên khác biến thể của "Global Thái Lan 1" tạo ra nhiều dòng `Team`
 * vật lý riêng biệt. "Quản lý nhân sự" (getTeamMembers) chỉ liệt kê member theo Team.leader_id
 * CHÍNH XÁC nên member gắn vào dòng trùng không hiện, dù dashboard (so chuỗi) vẫn hiện đúng.
 *
 * Đã kiểm tra: trong toàn bộ các bảng có FK trỏ tới teams.id (tasks, team_kpis,
 * team_kpi_snapshots, editor_kpis, team_products, team_contents, team_sources, channels,
 * action_items, case_studies, clone_videos, content_videos, editor_performance,
 * huyk_channels, meeting_sessions, team_push_requests) — CHỈ `team_members` có dữ liệu tham
 * chiếu tới 2 dòng trùng dưới đây. An toàn để gộp, không mất lịch sử KPI/task/kho hàng.
 *
 * Chạy: npx ts-node scripts/merge-duplicate-teams.ts
 */
import { PrismaClient } from '@prisma/client';
import { recomputeUserTeamFieldsBatch } from '../src/common/utils/team-membership.util';

const prisma = new PrismaClient();

// canonical = dòng có nhiều member nhất / có leader hợp lệ, được giữ lại.
// duplicates = các dòng bị gộp vào canonical rồi xoá.
const MERGE_GROUPS: Array<{ canonicalId: string; canonicalName: string; duplicateIds: string[] }> = [
    {
        canonicalId: '9e4d0427-3df6-40d3-9b51-5ac0357aad3f', // "Global- Thái Lan 1" — 10 members, leader Tuân Nguyễn
        canonicalName: 'Global- Thái Lan 1',
        duplicateIds: [
            '179a18e8-ceaf-48ab-9545-9b6f4a947c5e', // "Global Thái Lan 1" (không gạch) — 9 members, cùng leader
            '2d826151-d252-49bb-8ff5-a57a21fb6a5f', // "Global Thái Lan" (mồ côi, leader_id null) — 1 member
        ],
    },
];

async function main() {
    for (const group of MERGE_GROUPS) {
        console.log(`\n=== Gộp về "${group.canonicalName}" (${group.canonicalId}) ===`);

        const affectedUserIds = new Set<string>();

        await prisma.$transaction(async (tx) => {
            const canonical = await tx.team.findUnique({ where: { id: group.canonicalId } });
            if (!canonical) throw new Error(`Canonical team ${group.canonicalId} không tồn tại`);

            for (const dupId of group.duplicateIds) {
                const dup = await tx.team.findUnique({ where: { id: dupId }, include: { members: true } });
                if (!dup) {
                    console.log(`  (bỏ qua ${dupId} — không còn tồn tại)`);
                    continue;
                }
                console.log(`  Dòng trùng "${dup.name}" (${dupId}): ${dup.members.length} member`);

                // Chuyển member chưa có ở canonical; member đã có (do đã comma-join 2 tên)
                // thì bỏ qua bản ghi trùng thay vì vi phạm unique(team_id, user_id).
                for (const m of dup.members) {
                    affectedUserIds.add(m.user_id);
                    const existing = await tx.teamMember.findUnique({
                        where: { team_id_user_id: { team_id: group.canonicalId, user_id: m.user_id } },
                    });
                    if (existing) {
                        await tx.teamMember.delete({ where: { id: m.id } });
                    } else {
                        await tx.teamMember.update({ where: { id: m.id }, data: { team_id: group.canonicalId } });
                    }
                }

                // Đã xác nhận trước (script inspect-team-footprint.js) không còn bảng nào khác
                // tham chiếu tới dòng trùng này — an toàn xoá thẳng.
                await tx.team.delete({ where: { id: dupId } });
                console.log(`  Đã xoá dòng trùng "${dup.name}"`);
            }
        }, { maxWait: 10_000, timeout: 20_000 });

        if (affectedUserIds.size) {
            await recomputeUserTeamFieldsBatch(prisma, [...affectedUserIds]);
            console.log(`  Đã resync users.team cho ${affectedUserIds.size} user bị ảnh hưởng`);
        }
    }

    console.log('\n=== Xong. Kiểm tra lại ===');
    const remaining = await prisma.$queryRawUnsafe(`
    SELECT t.id, t.name, t.leader_id, lu.email AS leader_email,
           (SELECT count(*)::int FROM team_members tm WHERE tm.team_id = t.id) AS member_count
    FROM teams t LEFT JOIN users lu ON lu.id = t.leader_id
    WHERE t.name ILIKE '%thái lan%'
    ORDER BY t.name
  `) as any[];
    remaining.forEach((t) => console.log(t.id, '|', JSON.stringify(t.name), '| leader:', t.leader_email || '(none)', '| members:', t.member_count));

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

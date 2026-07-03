import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const serverPrisma = new PrismaClient({
    datasources: { db: { url: process.env.SERVER_DATABASE_URL } },
});

async function backfill() {
    try {
        const users = await serverPrisma.user.findMany({
            select: { id: true, team: true, roles: true, full_name: true },
        });

        const byTeam = new Map<string, typeof users>();
        for (const u of users) {
            if (!u.team) continue;
            if (!byTeam.has(u.team)) byTeam.set(u.team, []);
            byTeam.get(u.team)!.push(u);
        }

        let linked = 0;
        for (const [team, members] of byTeam) {
            const leaders = members.filter((m) => m.roles.includes('LEADER' as any));
            if (leaders.length !== 1) {
                if (leaders.length > 1) {
                    console.warn(`Skip team "${team}": ${leaders.length} leaders found (${leaders.map(l => l.full_name).join(', ')}), ambiguous.`);
                } else {
                    console.warn(`Skip team "${team}": no leader found among ${members.length} members.`);
                }
                continue;
            }
            const leader = leaders[0];
            const teamMates = members.filter((m) => m.id !== leader.id);
            if (teamMates.length === 0) continue;

            await serverPrisma.user.updateMany({
                where: { id: { in: teamMates.map((m) => m.id) } },
                data: { team_leader_id: leader.id },
            });
            console.log(`Team "${team}": linked ${teamMates.length} members -> leader ${leader.full_name}`);
            linked += teamMates.length;
        }

        console.log(`DONE: linked team_leader_id for ${linked} users total.`);
    } catch (error: any) {
        console.error('BACKFILL ERROR:', error.message);
    } finally {
        await serverPrisma.$disconnect();
    }
}

backfill();

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.SERVER_DATABASE_URL } } });

    const targetMonthNum = 5;
    const monthFormats = [`T${targetMonthNum}`, `Tháng ${targetMonthNum}`, `${targetMonthNum}`, targetMonthNum < 10 ? `0${targetMonthNum}` : `${targetMonthNum}`];

    // Simulate Admin access: no team filter
    let membersWhere: any = {};

    const allKpis = await prisma.larkKPI.findMany({
        where: {
            ...membersWhere,
            month: { in: monthFormats }
        },
        orderBy: { revenue_month: 'desc' }
    });

    console.log('Total fetched for T5:', allKpis.length);

    const activeKpis = allKpis.filter(k => k.state?.toLowerCase().trim() !== 'off');
    console.log('Active fetched for T5:', activeKpis.length);

    const totalVideo = activeKpis.reduce((sum, k) => sum + (k.completed_month || 0), 0);

    const latestMembers = new Map();
    activeKpis.forEach(k => {
        const nameKey = k.name?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
        const key = k.name?.trim() || k.id;
        if (!latestMembers.has(key)) {
            const contribution = totalVideo > 0 ? Math.round(((k.completed_month || 0) / totalVideo) * 100) : 0;
            latestMembers.set(key, {
                name: k.name,
                team: k.team || null,
                video: `${k.completed_month || 0} (${contribution}% đóng góp)`,
                traffic: Number(k.traffic_month || 0).toLocaleString('vi-VN'),
                revenue: Number(k.revenue_month || 0).toLocaleString('vi-VN'),
                isLeader: k.tag?.toLowerCase().includes('leader') || false
            });
        }
    });

    const membersList = Array.from(latestMembers.values());
    console.log('Total members deduplicated:', membersList.length);

    const huyenCam = membersList.find(m => m.name.includes('Cam'));
    console.log('Huyen Cam entry:', huyenCam);

    const k1Members = membersList.filter(m => m.team === 'Team K1');
    console.log('Team K1 members list:', k1Members);

    await prisma.$disconnect();
}

test();

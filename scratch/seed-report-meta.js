const { PrismaClient, PeriodType, BrandType } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log("Seeding default Teams and ReportPeriods...");

    // 1. Create default teams
    const teamNames = ['K1', 'K2', 'K3', 'K4', 'K5'];
    for (const name of teamNames) {
      await prisma.team.upsert({
        where: { name },
        update: {},
        create: {
          name,
          brand_type: BrandType.TRANG_SUC,
          market: "VIETNAM",
          is_active: true
        }
      });
      console.log(`✅ Team created: ${name}`);
    }

    // 2. Create default periods for July 2026
    const periods = [
      {
        type: PeriodType.MONTH,
        label: "Tháng 7/2026",
        start_date: new Date("2026-07-01T00:00:00Z"),
        end_date: new Date("2026-07-31T23:59:59Z")
      },
      {
        type: PeriodType.WEEK,
        label: "Tuần 1 - T7/2026",
        start_date: new Date("2026-07-01T00:00:00Z"),
        end_date: new Date("2026-07-07T23:59:59Z")
      },
      {
        type: PeriodType.WEEK,
        label: "Tuần 2 - T7/2026",
        start_date: new Date("2026-07-08T00:00:00Z"),
        end_date: new Date("2026-07-14T23:59:59Z")
      },
      {
        type: PeriodType.WEEK,
        label: "Tuần 3 - T7/2026",
        start_date: new Date("2026-07-15T00:00:00Z"),
        end_date: new Date("2026-07-21T23:59:59Z")
      },
      {
        type: PeriodType.WEEK,
        label: "Tuần 4 - T7/2026",
        start_date: new Date("2026-07-22T00:00:00Z"),
        end_date: new Date("2026-07-31T23:59:59Z")
      }
    ];

    for (const p of periods) {
      await prisma.reportPeriod.upsert({
        where: {
          type_start_date: {
            type: p.type,
            start_date: p.start_date
          }
        },
        update: {
          label: p.label,
          end_date: p.end_date
        },
        create: {
          type: p.type,
          label: p.label,
          start_date: p.start_date,
          end_date: p.end_date
        }
      });
      console.log(`✅ Period created: ${p.label} (${p.type})`);
    }

    console.log("🎉 Seeding complete!");
  } catch (err) {
    console.error("❌ Seeding failed:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();

/**
 * Seed team_products cho team "Global - JP1" — nguồn: Bảng tính không có tiêu đề - Trang tính1.csv
 * (import ngày 2026-07-14).
 *
 * Chỉ map 2 field có sẵn/rõ nghĩa trong bảng team_products: sku (cột SKU) và name
 * (cột Tên SP). Các cột Phân loại sản phẩm (Main/Secondary/Test) và Dòng sản phẩm
 * (GMV/Traffic) không được map vì đó là field phân loại (classification_id /
 * product_line_id) chưa được đối chiếu/tạo sẵn trong DB, nên bỏ qua để tránh đoán sai.
 *
 * Team/User được match theo NAME/EMAIL (không hardcode UUID) vì id giữa local và
 * server không giống nhau (teams/team_members không được sync giữa 2 DB).
 *
 * Idempotent: bỏ qua sku đã tồn tại sẵn cho team này, chạy lại nhiều lần an toàn.
 *
 * Cách chạy trên server:
 *   npx ts-node prisma/seed_team_products_global_jp1.ts
 *
 * Yêu cầu: biến môi trường DATABASE_URL trỏ đúng database server cần seed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEAM_NAME = 'Global - JP1';
const ADDED_BY_EMAIL = 'toanvan1112001@gmail.com'; // leader team Global - JP1

const DATA: { sku: string; name: string }[] = [
  {
    "sku": "NM101",
    "name": "Nhẫn tàng hình"
  },
  {
    "sku": "N101220",
    "name": "Nhẫn xoay bánh răng"
  },
  {
    "sku": "N300999",
    "name": "Nhẫn mắt mèo"
  },
  {
    "sku": "N400128",
    "name": "Nhẫn tàng hình đá xanh"
  },
  {
    "sku": "N610005",
    "name": "Nhẫn công chúa"
  },
  {
    "sku": "N620112",
    "name": "Nhẫn mắt thần Horus"
  },
  {
    "sku": "N001361",
    "name": "Nhẫn xoay cỏ 4 lá"
  },
  {
    "sku": "N001347",
    "name": "Nhẫn hành tinh"
  },
  {
    "sku": "D400545",
    "name": "Dây chuyền đá nhảy"
  },
  {
    "sku": "TS505",
    "name": "Nhẫn mèo tôm"
  },
  {
    "sku": "TS516",
    "name": "Nhẫn mắt ngựa xi vàng"
  },
  {
    "sku": "N620137",
    "name": "Nhẫn xoay đá saphire"
  },
  {
    "sku": "TS515",
    "name": "Kiềng mắt mèo vàng"
  },
  {
    "sku": "TS513",
    "name": "Nhẫn mắt mèo vàng"
  },
  {
    "sku": "N610001",
    "name": "Nhẫn tàng hình cầu vồng"
  },
  {
    "sku": "K400013",
    "name": "Kiềng mắt mèo bạc"
  },
  {
    "sku": "MD64",
    "name": "Dây chuyền cỏ 4 lá 2 dáng"
  },
  {
    "sku": "N00360",
    "name": "Nhẫn Kim Hoa"
  },
  {
    "sku": "N610036",
    "name": "Nhẫn Lam Ngọc"
  },
  {
    "sku": "TS517",
    "name": "Nhẫn tàng hình đá đỏ"
  },
  {
    "sku": "CT02",
    "name": "Nhẫn tàng hình xanh lục"
  },
  {
    "sku": "TS514",
    "name": "Nhẫn Sweets Hearts"
  },
  {
    "sku": "TS530",
    "name": "Dây chuyền lá phong"
  }
];

async function main() {
  console.log(`🌱 Seed ${DATA.length} team_products cho team "${TEAM_NAME}"\n`);

  const team = await prisma.team.findFirst({ where: { name: TEAM_NAME } });
  if (!team) throw new Error(`Không tìm thấy team "${TEAM_NAME}"`);

  const addedBy = await prisma.user.findFirst({ where: { email: ADDED_BY_EMAIL } });
  if (!addedBy) throw new Error(`Không tìm thấy user email "${ADDED_BY_EMAIL}"`);

  const existing = await prisma.teamProduct.findMany({
    where: { team_id: team.id },
    select: { sku: true },
  });
  const existingSkus = new Set(existing.map((p) => p.sku));

  const toInsert = DATA.filter((r) => !existingSkus.has(r.sku));
  const skipped = DATA.length - toInsert.length;

  if (toInsert.length === 0) {
    console.log(`Không có gì để insert (${skipped} sku đã tồn tại sẵn).`);
    return;
  }

  const result = await prisma.teamProduct.createMany({
    data: toInsert.map((r) => ({
      team_id: team.id,
      brand_type: 'TRANG_SUC' as const,
      market: 'GLOBAL',
      sku: r.sku,
      name: r.name,
      added_by_id: addedBy.id,
    })),
  });

  console.log(`Inserted: ${result.count} | Skipped (đã tồn tại): ${skipped}`);
}

main()
  .catch((e) => {
    console.error('[seed_team_products_global_jp1] failed:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed team_products cho team "Global - Indo" — nguồn: TÊN MÃ SẢN PHẨM GLOBAL - Trang tính1.csv
 * (đã import vào DB local ngày 2026-07-09, file này để chạy lại trên server).
 *
 * Chỉ map 2 field có sẵn/rõ nghĩa trong bảng team_products: sku (cột SKU) và name
 * (cột TÊN SẢN PHẨM). Cột NHÓM SẢN PHẨM không được map (tương tự nhóm chủ đề ở
 * seed content trước) vì đó là field phân loại (product_line_id) chưa được đối
 * chiếu/tạo sẵn trong DB, nên bỏ qua để tránh đoán sai.
 *
 * Team/User được match theo NAME/EMAIL (không hardcode UUID) vì id giữa local và
 * server không giống nhau (teams/team_members không được sync giữa 2 DB).
 *
 * Idempotent: bỏ qua sku đã tồn tại sẵn cho team này, chạy lại nhiều lần an toàn.
 *
 * Cách chạy trên server:
 *   npx ts-node prisma/seed_team_products_global_indo.ts
 *
 * Yêu cầu: biến môi trường DATABASE_URL trỏ đúng database server cần seed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEAM_NAME = 'Global - Indo';
const ADDED_BY_EMAIL = 'lenhngockhanh@gmail.com'; // leader team Global - Indo

const DATA: { sku: string; name: string }[] = [
  {
    "sku": "B400815",
    "name": "Bông Tai 6 Chấu"
  },
  {
    "sku": "MD64",
    "name": "Dây Chuyền Cỏ 4 Lá 2 dáng"
  },
  {
    "sku": "D000995",
    "name": "Dây Chuyền Cỏ 4 Lá"
  },
  {
    "sku": "D000993",
    "name": "Dây Chuyền Cỏ 4 Lá Xi Vàng Hồng"
  },
  {
    "sku": "D400545",
    "name": "Dây Chuyền Đá Nhảy Bạc"
  },
  {
    "sku": "D000994",
    "name": "Dây Chuyền Hoa Tử Đằng"
  },
  {
    "sku": "D000904",
    "name": "Dây Chuyền Hồ Điệp Phát Sáng"
  },
  {
    "sku": "D401024",
    "name": "Dây Chuyền Kim Cương Vuông"
  },
  {
    "sku": "D000856",
    "name": "Dây Chuyền Liên Hoa"
  },
  {
    "sku": "D400413",
    "name": "Dây Chuyền Mặt Trăng"
  },
  {
    "sku": "D401042",
    "name": "Dây Chuyền Mặt Xoắn"
  },
  {
    "sku": "D000984",
    "name": "Dây Chuyền Tình Yêu Vĩnh Cửu"
  },
  {
    "sku": "D400782",
    "name": "Dây Chuyền Trái Tim Đá Nhảy Xanh"
  },
  {
    "sku": "D401016",
    "name": "Dây Chuyền Trái Tim Màu Hồng"
  },
  {
    "sku": "D401043",
    "name": "Dây Chuyền Vô Cực"
  },
  {
    "sku": "K400013",
    "name": "Kiềng Mắt Mèo"
  },
  {
    "sku": "L001257",
    "name": "Kiềng Tay Hoa Linh Lan"
  },
  {
    "sku": "L001347",
    "name": "Kiềng Tay Mắt Mèo"
  },
  {
    "sku": "K400001",
    "name": "Kiềng Trơn Xoắn"
  },
  {
    "sku": "L300109",
    "name": "Lắc Tay Bạc Áo Giáp"
  },
  {
    "sku": "L001274",
    "name": "Lắc Tay Bi Mắt Mèo"
  },
  {
    "sku": "L400356",
    "name": "Lắc Tay Công Chúa Tóc Mây"
  },
  {
    "sku": "L400745",
    "name": "Lắc Tay Đá Tròn Dạng Xích Dây Rút"
  },
  {
    "sku": "L400236",
    "name": "Lắc Tay Hoa Linh Lan"
  },
  {
    "sku": "L401038",
    "name": "Lắc Tay Hoa Tử Đặng"
  },
  {
    "sku": "L001346",
    "name": "Lắc Tay Mãng Xà"
  },
  {
    "sku": "L000963",
    "name": "Lắc Tay Tam Sinh Tam Thế"
  },
  {
    "sku": "L100943",
    "name": "Lắc Tay Tennis"
  },
  {
    "sku": "L100944",
    "name": "Lắc Tay Tennis"
  },
  {
    "sku": "L001268",
    "name": "Lắc Tay Xi Vàng Hồng Cỏ 4 Lá"
  },
  {
    "sku": "N000903",
    "name": "Nhẫn Bạc Nữ Moissanite 6li"
  },
  {
    "sku": "N000905",
    "name": "Nhẫn Bạc Nữ Nguyệt Quế"
  },
  {
    "sku": "N001198",
    "name": "Nhẫn Bạch Xà Mắt Xanh"
  },
  {
    "sku": "N100925",
    "name": "Nhẫn Báo Panthera"
  },
  {
    "sku": "N400025",
    "name": "Nhẫn Bướm Bạc Hở"
  },
  {
    "sku": "N610155",
    "name": "Nhẫn Chế Tác"
  },
  {
    "sku": "N001361",
    "name": "Nhẫn Cỏ 4 Lá Xoay"
  },
  {
    "sku": "N610005",
    "name": "Nhẫn Công Chúa"
  },
  {
    "sku": "N100005",
    "name": "Nhẫn Đá Đen"
  },
  {
    "sku": "N400710",
    "name": "Nhẫn Đóa Hoa"
  },
  {
    "sku": "N001347",
    "name": "Nhẫn Hành Tinh"
  },
  {
    "sku": "N400198",
    "name": "Nhẫn Hoa 6 Chấu"
  },
  {
    "sku": "N000030",
    "name": "Nhẫn Hồ Ly"
  },
  {
    "sku": "N000968",
    "name": "Nhẫn Kim Cương Đóa Hoa"
  },
  {
    "sku": "N610188",
    "name": "Nhẫn Kim Vũ"
  },
  {
    "sku": "N400067",
    "name": "Nhẫn Mắt Mèo"
  },
  {
    "sku": "N300999",
    "name": "Nhẫn Mắt Mèo"
  },
  {
    "sku": "N301001",
    "name": "Nhẫn Mắt Mèo"
  },
  {
    "sku": "N401099",
    "name": "Nhẫn Mắt Mèo"
  },
  {
    "sku": "N620112",
    "name": "Nhẫn Mắt Thần Horus"
  },
  {
    "sku": "N400041",
    "name": "Nhẫn Mắt Thiên Thần"
  },
  {
    "sku": "N630001",
    "name": "Nhẫn Nắm Tay"
  },
  {
    "sku": "N401501",
    "name": "Nhẫn Nơ Đính Đá"
  },
  {
    "sku": "CT01",
    "name": "Nhẫn Rainbow"
  },
  {
    "sku": "NM101",
    "name": "Nhẫn Tàng Hình"
  },
  {
    "sku": "N100924",
    "name": "Nhẫn Tàng Hình"
  },
  {
    "sku": "N400128",
    "name": "Nhẫn Tàng Hình Đá CZ Xanh Dương"
  },
  {
    "sku": "CT02",
    "name": "Nhẫn Tàng Hình Đá Xanh Lục"
  },
  {
    "sku": "N610001",
    "name": "Nhẫn Tàng Hình Rainbow Sapphire"
  },
  {
    "sku": "N620003",
    "name": "Nhẫn Thiên Mã Nhãn"
  },
  {
    "sku": "N102221",
    "name": "Nhẫn XO"
  },
  {
    "sku": "CT03",
    "name": "Nhẫn Xoay Bánh Răng"
  },
  {
    "sku": "N100886",
    "name": "Nhẫn Xoay Lục Tự Đà La Ni"
  },
  {
    "sku": "N101220",
    "name": "Nhẫn Xoay Răng Cưa"
  },
  {
    "sku": "N400039",
    "name": "Nhẫn Xoắn Đá Oval"
  },
  {
    "sku": "D400544",
    "name": "Nhẫn Xoắn Đá Oval"
  },
  {
    "sku": "MT01",
    "name": "Vòng Tay Bạc Nữ Cỏ Bốn Lá May Mắn"
  },
  {
    "sku": "N610215",
    "name": "Nhẫn Hoàng Quang"
  },
  {
    "sku": "N610004",
    "name": "Nhẫn sánh duyên"
  },
  {
    "sku": "N610006",
    "name": "Nhẫn Kim Hoa S925 đính Moissaite -  Viễn Chí Bảo - N610006"
  },
  {
    "sku": "N610009",
    "name": "Nhẫn Kim Sa S925 đính đá Moissanite 7 li - N610009"
  },
  {
    "sku": "N610189",
    "name": "Nhẫn Nguyệt Quang Kiều S925 đính Moissanite - N610189"
  },
  {
    "sku": "N610033",
    "name": "Nhẫn đá vuông S925 Moissanite"
  },
  {
    "sku": "N610179",
    "name": "Nhẫn Kim Vương Chi Hoa đá oval"
  },
  {
    "sku": "N464001",
    "name": "Nhẫn trái tim tình yêu đôi S925 đính đá - N464001"
  },
  {
    "sku": "N610055",
    "name": "Nhẫn xoay Rainbown S925 đính đá Sapphire - N610055"
  },
  {
    "sku": "N610159",
    "name": "Nhẫn nữ đính đá chủ CZ lấp lánh S925 - N610159"
  },
  {
    "sku": "N610183",
    "name": "Nhẫn đá Emerald S925 đá xanh - N610183"
  },
  {
    "sku": "N610008",
    "name": "Nhẫn sánh đôi đính S925 đính đá Moissanite - N610008"
  },
  {
    "sku": "N620125",
    "name": "Nhẫn Đế Vương Xanh S925 đính đá - N620125"
  },
  {
    "sku": "N610239",
    "name": "Nhẫn Hồng Tâm Nguyệt S925 đính đá - N610239"
  },
  {
    "sku": "N610038",
    "name": "Nhẫn Lam Quang s925 đính đá Spinel tổng hợp - N610038"
  },
  {
    "sku": "N610224",
    "name": "Nhẫn vũ điệu thiên nga S925 đính đá Moissanite - N610224"
  },
  {
    "sku": "N464006",
    "name": "Nhẫn Trái Tim Biển Xanh S925 đính đá - N464006"
  },
  {
    "sku": "N610035",
    "name": "Nhẫn đá hồng S925 - N610035"
  },
  {
    "sku": "N464008",
    "name": "Nhẫn Ánh Nguyệt Phù Dung S925 đính đá - N464008"
  },
  {
    "sku": "N620008",
    "name": "Nhẫn nam Đế Vương S925 đính đá moissanite - N620008"
  },
  {
    "sku": "N329014",
    "name": "Nhẫn Nhẫn Huyền Lam Đế S925 đính Topaz xanh - N329014"
  },
  {
    "sku": "N610036",
    "name": "Nhẫn Lam Ngọc Vĩnh Cửu s925 đính đá moissanite - N610036"
  },
  {
    "sku": "N620012",
    "name": "Nhẫn boss S925 đính Moissanite - N620012"
  },
  {
    "sku": "N400125",
    "name": "Nhẫn đại dương xanh S925 - N400125"
  },
  {
    "sku": "N610187",
    "name": "Nhẫn Hoàng Kim Đế Vương S925 đính đá - N610187"
  },
  {
    "sku": "N610333",
    "name": "Nhẫn hoa diên vĩ S925 đính Moissanite - N610333"
  },
  {
    "sku": "N610256",
    "name": "Nhẫn hoa hồng dây leo S925 đính đá moissanite - N610256"
  },
  {
    "sku": "N400126",
    "name": "Nhẫn Vòng xoắn vô cực S925"
  },
  {
    "sku": "N610250",
    "name": "Nhẫn nguyệt viên"
  },
  {
    "sku": "N610251",
    "name": "Nhẫn Nguyệt Uyển"
  },
  {
    "sku": "N610252",
    "name": "Nhẫn Kim Uyển"
  },
  {
    "sku": "N610253",
    "name": "Nhẫn Mộc Tâm"
  },
  {
    "sku": "N610254",
    "name": "Nhẫn Tinh Ấn"
  },
  {
    "sku": "N610255",
    "name": "Nhẫn Ánh Sương"
  },
  {
    "sku": "N610257",
    "name": "Nhẫn Tinh Uyển"
  },
  {
    "sku": "N610017",
    "name": "Nhẫn Kim Vũ Phiến"
  },
  {
    "sku": "N610110",
    "name": "Nhẫn cỏ 4 lá xoay"
  },
  {
    "sku": "N610233",
    "name": "Nhẫn Vĩnh Ái Lưu Quang"
  },
  {
    "sku": "N610246",
    "name": "Nhẫn tàng hình đá xanh lá"
  },
  {
    "sku": "L300103",
    "name": "Lắc tay Liên Châu"
  },
  {
    "sku": "N464002",
    "name": "Nhẫn ngọc hồng lựu"
  },
  {
    "sku": "N00360",
    "name": "Nhẫn Kim Hoa"
  },
  {
    "sku": "TS505",
    "name": "Nhẫn Mèo Tôm"
  },
  {
    "sku": "LTS507",
    "name": "Lắc Tennis đá hồng"
  },
  {
    "sku": "TS514",
    "name": "Nhẫn Sweet Heart"
  },
  {
    "sku": "TS517",
    "name": "Nhẫn tàng hình đá đỏ"
  },
  {
    "sku": "TS515",
    "name": "Kiềng tay mắt mèo vàng"
  },
  {
    "sku": "TS513",
    "name": "Nhẫn mắt mèo vàng"
  },
  {
    "sku": "TS516",
    "name": "Nhẫn mắt ngựa vàng"
  },
  {
    "sku": "N3112",
    "name": "Nhẫn nơ đính đá chủ"
  },
  {
    "sku": "N620137",
    "name": "Nhẫn xoay đá Saphire"
  },
  {
    "sku": "TS518",
    "name": "Nhẫn Đính Đá"
  },
  {
    "sku": "TS520",
    "name": "Dây chuyền trái tim đỏ"
  },
  {
    "sku": "N0012",
    "name": "Nhấn Kim Sa"
  },
  {
    "sku": "TS527",
    "name": "Nhẫn xoay bánh răng đính đá 2 màu"
  },
  {
    "sku": "TS531",
    "name": "nhẫn đôi cánh thiên thần"
  },
  {
    "sku": "TS532",
    "name": "Nhẫn vương miện"
  },
  {
    "sku": "MD400006",
    "name": "Dây chuyền trái tim đỏ"
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
    console.error('[seed_team_products_global_indo] failed:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

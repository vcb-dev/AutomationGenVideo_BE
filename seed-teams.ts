import { PrismaClient, BrandType } from "@prisma/client";

const prisma = new PrismaClient();

const teams: {
  id: string;
  name: string;
  brand_type: BrandType;
  market: string;
}[] = [
  {
    id: "8d391267-4b2e-47d2-b012-c8052874a0d5",
    name: "Đồ Da",
    brand_type: BrandType.DO_DA,
    market: "VIETNAM",
  },
  {
    id: "4249680c-fdda-4056-b724-7b39cee12d0b",
    name: "Global - JP1",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "a0dd48c7-a942-4f2e-bc01-ae36815d52e9",
    name: "Global - Indo",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "739815ac-1320-4ddf-a92b-67db15657d45",
    name: "Team K1",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "6dc4825b-3810-4172-86ee-0ad6c8979266",
    name: "Team K0",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "9b32d044-0a81-4b6a-ac20-0f65cf73349c",
    name: "Team K4",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "76eb6ef2-da15-4de3-a554-9b0bef1cda4d",
    name: "MEDIA",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "7b297c9d-5900-4f37-ade8-9cf010877b83",
    name: "Scale Data",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "1ff66064-3404-415b-9ec5-a9d1cc89c348",
    name: "Team K2",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "9d8f8bed-ede2-4a5e-8578-b84a715a5d22",
    name: "Team K3",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "df5c8b0e-63b1-4fb6-9b61-19d51643eef4",
    name: "AFF 02",
    brand_type: BrandType.DO_DA,
    market: "VIETNAM",
  },
  {
    id: "6ac8fa83-bf18-42fc-8ee1-30793f3d3f32",
    name: "Đá Quý - NamBling",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "1496294e-a89b-4b82-b288-a0a1e9b5fcc8",
    name: "Team ADS",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "6f8c76da-af33-4525-ad34-cd091290759d",
    name: "Global- Thái Lan 1",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "21e20aeb-b7ea-4df9-9b74-57d65216c9c1",
    name: "Global - Thái Lan 2",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "a95357a4-c48a-47eb-93c9-e93b90b8e328",
    name: "AFF 01",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "9b3465eb-e571-42c5-abaf-0d11645945f4",
    name: "Đá Quý - Chung Thợ Đá",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "f6d78246-55ed-49e9-b1de-9b591dbb4fbb",
    name: "Global Thái Lan",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "da19217f-6213-4d34-b03b-d1cb27f0b644",
    name: "Global Đài Loan",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
  {
    id: "47611823-d0bd-4f42-8bc3-254b030d2408",
    name: "MEDIA CHUNG",
    brand_type: BrandType.TRANG_SUC,
    market: "VIETNAM",
  },
];

async function main() {
  console.log(`🌱 Seeding ${teams.length} teams...\n`);

  for (const t of teams) {
    await prisma.team.upsert({
      where: { name: t.name },
      update: {
        brand_type: t.brand_type,
        market: t.market,
        is_active: true,
      },
      create: {
        id: t.id,
        name: t.name,
        brand_type: t.brand_type,
        market: t.market,
        is_active: true,
      },
    });
    console.log(`✅ Team upserted: ${t.name}`);
  }

  console.log("\n🎉 Done seeding teams.");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding teams:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

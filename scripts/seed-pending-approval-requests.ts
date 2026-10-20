import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Bắt đầu tạo danh sách phiếu mượn chờ duyệt (PENDING_APPROVAL) ---');

  // Lấy bộ phận Media
  const mediaDept = await prisma.memsDepartment.findFirst({
    where: { code: 'MEDIA' },
  });
  if (!mediaDept) throw new Error('Không tìm thấy bộ phận MEDIA');

  // Lấy người dùng
  const memberNvMedia = await prisma.user.findFirst({
    where: { email: 'nvmedia@gmail.com' },
  });
  const memberQuoc = await prisma.user.findFirst({
    where: { email: 'doanhquoc2712@gmail.com' },
  });

  if (!memberNvMedia || !memberQuoc) {
    throw new Error('Không tìm thấy tài khoản nvmedia hoặc Đỗ Anh Quốc');
  }

  // Lấy các model
  const modelTamron = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Tamron' } },
  });
  const modelSd128 = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: '128GB' } },
  });
  const modelSd64 = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: '64GB' } },
  });
  const modelMacro = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Macro 90' } },
  });

  if (!modelTamron || !modelSd128 || !modelSd64 || !modelMacro) {
    throw new Error('Không tìm thấy đủ model thiết bị');
  }

  const now = new Date();

  // Xoá các phiếu test trùng mã nếu đã có
  const testCodes = [
    'REQ-20261021-001',
    'REQ-20261022-002',
    'REQ-20261023-003',
    'REQ-20261021-004',
  ];
  await prisma.memsBorrowRequest.deleteMany({
    where: { request_code: { in: testCodes } },
  });

  // ========================================================
  // PHIẾU 1: Ghi hình TVC Quảng cáo (1 cấp duyệt, có ảnh lens)
  // ========================================================
  const req1From = new Date(now.getTime() + 24 * 3600 * 1000);
  const req1To = new Date(now.getTime() + 36 * 3600 * 1000);
  const req1 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261021-001',
      owner_id: memberNvMedia.id,
      department_id: mediaDept.id,
      project: 'Ghi Hình TVC Quảng Cáo Mỹ Phẩm Cao Cấp',
      place: 'Phim trường Hà Đông, Hà Nội',
      purpose: 'WORK',
      from_time: req1From,
      to_time: req1To,
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Quay TVC quảng cáo sản phẩm mới, cần ống kính zoom đa dụng khẩu f/2.8 và thẻ nhớ tốc độ cao để quay 4K 120fps.',
        photos: [
          'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
        ],
      }),
      lines: {
        create: [
          {
            model_id: modelTamron.id,
            quantity: 1,
            status: 'RESERVED',
            reservations: {
              create: [
                {
                  model_id: modelTamron.id,
                  from_time: req1From,
                  to_time: req1To,
                  buffer_to_time: new Date(req1To.getTime() + 2 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
          {
            model_id: modelSd128.id,
            quantity: 1,
            status: 'RESERVED',
            reservations: {
              create: [
                {
                  model_id: modelSd128.id,
                  from_time: req1From,
                  to_time: req1To,
                  buffer_to_time: new Date(req1To.getTime() + 2 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Đã tạo Phiếu 1 [TVC Mỹ Phẩm - 1 cấp duyệt, 2 thiết bị]:', req1.request_code);

  // ========================================================
  // PHIẾU 2: Việc riêng cá nhân (PERSONAL - 2 cấp duyệt: Leader & Admin)
  // ========================================================
  const req2From = new Date(now.getTime() + 48 * 3600 * 1000);
  const req2To = new Date(now.getTime() + 72 * 3600 * 1000);
  const req2 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261022-002',
      owner_id: memberQuoc.id,
      department_id: mediaDept.id,
      project: 'Chụp Ảnh Kỷ Yếu & Sự Kiện Gia Đình Cuối Tuần',
      place: 'Khu đô thị Ecopark, Hưng Yên',
      purpose: 'PERSONAL', // Kích hoạt quy trình 2 cấp duyệt
      from_time: req2From,
      to_time: req2To,
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Em xin mượn ống kính Macro chụp ảnh kỷ yếu gia đình cuối tuần. Cam kết bảo quản cẩn thận và trả đúng hạn ạ.',
        photos: [
          'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=800&q=80',
        ],
      }),
      lines: {
        create: [
          {
            model_id: modelMacro.id,
            quantity: 1,
            status: 'RESERVED',
            reservations: {
              create: [
                {
                  model_id: modelMacro.id,
                  from_time: req2From,
                  to_time: req2To,
                  buffer_to_time: new Date(req2To.getTime() + 2 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Đã tạo Phiếu 2 [Việc riêng - 2 cấp duyệt Leader + Admin]:', req2.request_code);

  // ========================================================
  // PHIẾU 3: Mượn dài ngày (> 7 ngày - Cảnh báo mượn dài)
  // ========================================================
  const req3From = new Date(now.getTime() + 72 * 3600 * 1000);
  const req3To = new Date(now.getTime() + (72 + 200) * 3600 * 1000); // ~8 ngày
  const req3 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261023-003',
      owner_id: memberNvMedia.id,
      department_id: mediaDept.id,
      project: 'Chuyến Công Tác Phim Tài Liệu Tây Bắc',
      place: 'Mù Cang Chải, Yên Bái & Sa Pa, Lào Cai',
      purpose: 'WORK',
      from_time: req3From,
      to_time: req3To,
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Đoàn làm phim đi công tác Tây Bắc dài ngày theo kế hoạch sản xuất. Thiết bị được bảo quản trong vali chống ẩm chuyên dụng.',
        photos: [],
      }),
      lines: {
        create: [
          {
            model_id: modelSd64.id,
            quantity: 1,
            status: 'RESERVED',
            reservations: {
              create: [
                {
                  model_id: modelSd64.id,
                  from_time: req3From,
                  to_time: req3To,
                  buffer_to_time: new Date(req3To.getTime() + 2 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Đã tạo Phiếu 3 [Mượn dài ngày > 7 ngày - Có cảnh báo]:', req3.request_code);

  // ========================================================
  // PHIẾU 4: Phỏng vấn khẩn cấp (Cần duyệt gấp trong ngày)
  // ========================================================
  const req4From = new Date(now.getTime() + 18 * 3600 * 1000);
  const req4To = new Date(now.getTime() + 22 * 3600 * 1000);
  const req4 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261021-004',
      owner_id: memberQuoc.id,
      department_id: mediaDept.id,
      project: 'Ghi Hình Phỏng Vấn Đột Xuất Tại Trụ Sở Đối Tác',
      place: 'Tòa nhà Lotte Center, Ba Đình, Hà Nội',
      purpose: 'WORK',
      from_time: req4From,
      to_time: req4To,
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Đối tác sắp xếp lịch phỏng vấn đột xuất vào chiều ngày mai, em xin mượn gấp thẻ nhớ và lens để tác nghiệp.',
        photos: [],
      }),
      lines: {
        create: [
          {
            model_id: modelSd128.id,
            quantity: 1,
            status: 'RESERVED',
            reservations: {
              create: [
                {
                  model_id: modelSd128.id,
                  from_time: req4From,
                  to_time: req4To,
                  buffer_to_time: new Date(req4To.getTime() + 2 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Đã tạo Phiếu 4 [Phỏng vấn đột xuất - Duyệt gấp]:', req4.request_code);

  console.log('--- Hoàn tất tạo thêm 4 phiếu mượn chờ duyệt thành công! ---');
}

main()
  .catch((e) => {
    console.error('Lỗi khi tạo phiếu chờ duyệt:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

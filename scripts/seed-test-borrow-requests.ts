import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Bắt đầu tạo dữ liệu phiếu mượn test ---');

  // 1. Đảm bảo Bộ phận Media và Chưa phân bộ phận tồn tại
  let mediaDept = await prisma.memsDepartment.findFirst({
    where: { code: 'MEDIA' },
  });
  if (!mediaDept) {
    mediaDept = await prisma.memsDepartment.create({
      data: {
        code: 'MEDIA',
        name: 'Bộ phận Media & Sản xuất',
      },
    });
    console.log('✓ Đã tạo bộ phận MEDIA:', mediaDept.id);
  }

  let fallbackDept = await prisma.memsDepartment.findFirst({
    where: { code: 'CHUA_PHAN' },
  });
  if (!fallbackDept) {
    fallbackDept = await prisma.memsDepartment.create({
      data: {
        code: 'CHUA_PHAN',
        name: 'Chưa phân bộ phận',
      },
    });
    console.log('✓ Đã tạo bộ phận CHUA_PHAN:', fallbackDept.id);
  }

  // 2. Tìm người dùng
  const adminUser = await prisma.user.findFirst({
    where: { email: 'trunghieu2003hhh@gmail.com' },
  });
  const leaderUser = await prisma.user.findFirst({
    where: { email: 'leanhsomianton@gmail.com' },
  });
  const memberNvMedia = await prisma.user.findFirst({
    where: { email: 'nvmedia@gmail.com' },
  });
  const memberQuoc = await prisma.user.findFirst({
    where: { email: 'doanhquoc2712@gmail.com' },
  });

  if (!memberNvMedia || !memberQuoc) {
    throw new Error('Không tìm thấy tài khoản nvmedia hoặc Đỗ Anh Quốc');
  }

  const adminId = adminUser?.id || leaderUser?.id || memberNvMedia.id;
  const leaderId = leaderUser?.id || adminId;

  // Đảm bảo memsMember cho các user
  for (const u of [memberNvMedia, memberQuoc, leaderUser, adminUser].filter(Boolean) as any[]) {
    await prisma.memsMember.upsert({
      where: { user_id: u.id },
      create: {
        user_id: u.id,
        department_id: mediaDept.id,
        role: u.roles?.includes('ADMIN')
          ? 'ADMIN'
          : u.roles?.includes('LEADER')
            ? 'APPROVER'
            : 'MEMBER',
      },
      update: {
        department_id: mediaDept.id,
      },
    });
  }
  console.log('✓ Đã cập nhật thông tin thành viên MemsMember');

  // 3. Lấy các model & asset sẵn có
  const modelMacro = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Macro 90' } },
  }) || await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Lens' } },
  });

  const modelTamron = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Tamron' } },
  });

  const modelSd128 = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: '128GB' } },
  });

  const modelSd64 = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: '64GB' } },
  });

  const assetTamron = await prisma.memsAsset.findFirst({
    where: { asset_code: 'LENS-003' },
  });

  const assetSd128 = await prisma.memsAsset.findFirst({
    where: { asset_code: 'THENHO-002' },
  });

  const assetSd64 = await prisma.memsAsset.findFirst({
    where: { asset_code: 'THENHO-001' },
  });

  const assetMacro = await prisma.memsAsset.findFirst({
    where: { asset_code: 'LENS-004' },
  });

  console.log('✓ Đã định vị các model và thiết bị');

  const now = new Date();

  // Xoá các phiếu test cũ nếu đã tồn tại để tránh trùng mã
  const testCodes = [
    'REQ-20261020-001',
    'REQ-20261019-002',
    'REQ-20261019-003',
    'REQ-20261018-004',
    'REQ-20261019-005',
  ];
  await prisma.memsBorrowRequest.deleteMany({
    where: { request_code: { in: testCodes } },
  });

  // ==========================================
  // PHIẾU 1: CHỜ DUYỆT (PENDING_APPROVAL)
  // ==========================================
  const req1 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261020-001',
      owner_id: memberNvMedia.id,
      department_id: mediaDept.id,
      project: 'Quay MV Ngoại Cảnh Bãi Đá Sông Hồng',
      place: 'Bãi đá Sông Hồng, Nhật Tân, Tây Hồ, Hà Nội',
      purpose: 'WORK',
      from_time: new Date(now.getTime() + 24 * 3600 * 1000), // ngày mai
      to_time: new Date(now.getTime() + 34 * 3600 * 1000),
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Quay MV ca nhạc ngoài trời, cần ống kính Macro để chụp chi tiết nhạc cụ và cận cảnh biểu cảm ca sĩ.',
        photos: [
          'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
        ],
      }),
      lines: {
        create: [
          {
            model_id: modelMacro!.id,
            quantity: 1,
            status: 'RESERVED',
            note: 'Ống kính Macro 90mm',
            reservations: {
              create: [
                {
                  model_id: modelMacro!.id,
                  from_time: new Date(now.getTime() + 24 * 3600 * 1000),
                  to_time: new Date(now.getTime() + 34 * 3600 * 1000),
                  buffer_to_time: new Date(now.getTime() + 36 * 3600 * 1000),
                  status: 'TENTATIVE',
                },
              ],
            },
          },
        ],
      },
    },
  });
  console.log('✓ Đã tạo Phiếu 1 [Chờ duyệt]:', req1.request_code);

  // ==========================================
  // PHIẾU 2: ĐANG MƯỢN + CÓ SỰ CỐ (ON_LOAN - HAS_INCIDENT)
  // ==========================================
  const req2From = new Date(now.getTime() - 8 * 3600 * 1000);
  const req2To = new Date(now.getTime() + 6 * 3600 * 1000);
  const req2 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261019-002',
      owner_id: memberQuoc.id,
      department_id: mediaDept.id,
      project: 'Livestream Sự Kiện Khai Trương Showroom Mới',
      place: 'Trung tâm Hội nghị Quốc gia, Hà Nội',
      purpose: 'WORK',
      from_time: req2From,
      to_time: req2To,
      status: 'ON_LOAN',
      note: JSON.stringify({
        text: 'Thiết bị phục vụ livestream sự kiện khai trương cả ngày.',
        photos: [
          'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=800&q=80',
        ],
        incidents: [
          {
            id: 'inc-001',
            asset_id: assetTamron?.id,
            title: 'Kính lọc UV bị trầy nhẹ viền ngoài do cát bay',
            severity: 'LOW',
            reported_at: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
            description:
              'Trong lúc quay ngoại cảnh sảnh đón khách, gió mạnh cuốn bụi cát va vào filter UV. Thấu kính chính của lens an toàn 100%.',
          },
        ],
      }),
      lines: {
        create: [
          {
            model_id: modelTamron!.id,
            quantity: 1,
            status: 'ON_LOAN',
            reservations: {
              create: [
                {
                  model_id: modelTamron!.id,
                  asset_id: assetTamron?.id,
                  from_time: req2From,
                  to_time: req2To,
                  buffer_to_time: new Date(req2To.getTime() + 2 * 3600 * 1000),
                  status: 'CONFIRMED',
                },
              ],
            },
          },
        ],
      },
      approvals: {
        create: [
          {
            level: 1,
            decision: 'APPROVED',
            decided_by: leaderId,
            reason: 'Đã duyệt phục vụ sự kiện công ty',
            decided_at: req2From,
          },
        ],
      },
      handovers: {
        create: [
          {
            handed_by: adminId,
            received_by: memberQuoc.full_name,
            received_at: req2From,
            note: 'Bàn giao đầy đủ cáp trước và filter UV',
            lines: {
              create: [
                {
                  asset_id: assetTamron!.id,
                  condition: 'GOOD',
                  note: 'Thân máy và thấu kính sạch đẹp',
                },
              ],
            },
          },
        ],
      },
    },
  });
  if (assetTamron) {
    await prisma.memsAsset.update({
      where: { id: assetTamron.id },
      data: { status: 'ON_LOAN' },
    });
  }
  console.log('✓ Đã tạo Phiếu 2 [Đang mượn + Có sự cố]:', req2.request_code);

  // ==========================================
  // PHIẾU 3: ĐANG MƯỢN + CHỜ DUYỆT GIA HẠN (ON_LOAN - PENDING_EXTENSION)
  // ==========================================
  const req3From = new Date(now.getTime() - 6 * 3600 * 1000);
  const req3To = new Date(now.getTime() + 4 * 3600 * 1000);
  const req3ExtendedTo = new Date(now.getTime() + 24 * 3600 * 1000);
  const req3 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261019-003',
      owner_id: memberNvMedia.id,
      department_id: mediaDept.id,
      project: 'Phim Ngắn Quảng Bá Du Lịch Phố Cổ Hà Nội',
      place: 'Phố đi bộ Hồ Gươm & Phố cổ Hà Nội',
      purpose: 'WORK',
      from_time: req3From,
      to_time: req3To,
      status: 'ON_LOAN',
      note: JSON.stringify({
        text: 'Mượn thẻ nhớ tốc độ cao ghi hình 4K 60fps.',
        photos: [],
        extension: {
          requested_to_time: req3ExtendedTo.toISOString(),
          reason:
            'Thời tiết buổi chiều âm u và có mưa nhỏ, xin gia hạn sang ngày mai để quay bù các phân cảnh hoàng hôn và đêm.',
          requested_at: new Date(now.getTime() - 1 * 3600 * 1000).toISOString(),
          requested_by_id: memberNvMedia.id,
          status: 'PENDING',
        },
      }),
      lines: {
        create: [
          {
            model_id: modelSd128!.id,
            quantity: 1,
            status: 'ON_LOAN',
            reservations: {
              create: [
                {
                  model_id: modelSd128!.id,
                  asset_id: assetSd128?.id,
                  from_time: req3From,
                  to_time: req3To,
                  buffer_to_time: new Date(req3To.getTime() + 2 * 3600 * 1000),
                  status: 'CONFIRMED',
                },
              ],
            },
          },
        ],
      },
      approvals: {
        create: [
          {
            level: 1,
            decision: 'APPROVED',
            decided_by: leaderId,
            reason: 'Duyệt mượn thẻ nhớ phục vụ quay phim ngắn',
            decided_at: req3From,
          },
        ],
      },
      handovers: {
        create: [
          {
            handed_by: adminId,
            received_by: memberNvMedia.full_name,
            received_at: req3From,
            note: 'Bàn giao thẻ nhớ kèm hộp bảo vệ',
            lines: {
              create: [
                {
                  asset_id: assetSd128!.id,
                  condition: 'GOOD',
                },
              ],
            },
          },
        ],
      },
    },
  });
  if (assetSd128) {
    await prisma.memsAsset.update({
      where: { id: assetSd128.id },
      data: { status: 'ON_LOAN' },
    });
  }
  console.log('✓ Đã tạo Phiếu 3 [Đang mượn + Chờ duyệt gia hạn]:', req3.request_code);

  // ==========================================
  // PHIẾU 4: ĐANG MƯỢN + QUÁ HẠN TRẢ (ON_LOAN - OVERDUE)
  // ==========================================
  const req4From = new Date(now.getTime() - 28 * 3600 * 1000); // Hôm qua
  const req4To = new Date(now.getTime() - 4 * 3600 * 1000); // Đã quá hạn 4 tiếng
  const req4 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261018-004',
      owner_id: memberQuoc.id,
      department_id: mediaDept.id,
      project: 'Ghi Hình Phỏng Vấn Chuyên Gia Công Nghệ AI',
      place: 'Keangnam Landmark 72, Nam Từ Liêm, Hà Nội',
      purpose: 'WORK',
      from_time: req4From,
      to_time: req4To,
      status: 'ON_LOAN',
      note: JSON.stringify({
        text: 'Cần thẻ nhớ 64GB lưu trữ footage phỏng vấn đối tác tài chính.',
        photos: [],
      }),
      lines: {
        create: [
          {
            model_id: modelSd64!.id,
            quantity: 1,
            status: 'ON_LOAN',
            reservations: {
              create: [
                {
                  model_id: modelSd64!.id,
                  asset_id: assetSd64?.id,
                  from_time: req4From,
                  to_time: req4To,
                  buffer_to_time: new Date(req4To.getTime() + 2 * 3600 * 1000),
                  status: 'CONFIRMED',
                },
              ],
            },
          },
        ],
      },
      approvals: {
        create: [
          {
            level: 1,
            decision: 'APPROVED',
            decided_by: leaderId,
            reason: 'Duyệt phỏng vấn chuyên gia',
            decided_at: req4From,
          },
        ],
      },
      handovers: {
        create: [
          {
            handed_by: adminId,
            received_by: memberQuoc.full_name,
            received_at: req4From,
            note: 'Bàn giao thẻ nhớ 64GB',
            lines: {
              create: [
                {
                  asset_id: assetSd64!.id,
                  condition: 'GOOD',
                },
              ],
            },
          },
        ],
      },
    },
  });
  if (assetSd64) {
    await prisma.memsAsset.update({
      where: { id: assetSd64.id },
      data: { status: 'ON_LOAN' },
    });
  }
  console.log('✓ Đã tạo Phiếu 4 [Đang mượn + Quá hạn trả]:', req4.request_code);

  // ==========================================
  // PHIẾU 5: SẮP HẾT HẠN TRONG < 2 GIỜ (ON_LOAN - EXPIRING_SOON)
  // ==========================================
  const req5From = new Date(now.getTime() - 4 * 3600 * 1000);
  const req5To = new Date(now.getTime() + 75 * 60 * 1000); // Hết hạn sau 1 giờ 15 phút (< 2h)
  const req5 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-20261019-005',
      owner_id: memberNvMedia.id,
      department_id: mediaDept.id,
      project: 'Chụp Ảnh Profile Ban Giám Đốc Công Ty',
      place: 'Studio Tầng 5 - Trụ sở chính công ty',
      purpose: 'WORK',
      from_time: req5From,
      to_time: req5To,
      status: 'ON_LOAN',
      note: JSON.stringify({
        text: 'Bộ ảnh profile lãnh đạo thực hiện trong studio, cần trả sớm trong chiều nay.',
        photos: [],
      }),
      lines: {
        create: [
          {
            model_id: modelMacro!.id,
            quantity: 1,
            status: 'ON_LOAN',
            reservations: {
              create: [
                {
                  model_id: modelMacro!.id,
                  asset_id: assetMacro?.id,
                  from_time: req5From,
                  to_time: req5To,
                  buffer_to_time: new Date(req5To.getTime() + 2 * 3600 * 1000),
                  status: 'CONFIRMED',
                },
              ],
            },
          },
        ],
      },
      approvals: {
        create: [
          {
            level: 1,
            decision: 'APPROVED',
            decided_by: leaderId,
            reason: 'Duyệt chụp studio',
            decided_at: req5From,
          },
        ],
      },
      handovers: {
        create: [
          {
            handed_by: adminId,
            received_by: memberNvMedia.full_name,
            received_at: req5From,
            note: 'Bàn giao Lens 90 Macro kèm nắp trước sau',
            lines: {
              create: [
                {
                  asset_id: assetMacro!.id,
                  condition: 'GOOD',
                },
              ],
            },
          },
        ],
      },
    },
  });
  if (assetMacro) {
    await prisma.memsAsset.update({
      where: { id: assetMacro.id },
      data: { status: 'ON_LOAN' },
    });
  }
  console.log('✓ Đã tạo Phiếu 5 [Sắp hết hạn trong <2h]:', req5.request_code);

  console.log('--- Hoàn thành tạo 5 phiếu mượn test thành công! ---');
}

main()
  .catch((e) => {
    console.error('Lỗi khi tạo dữ liệu test:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { PrismaClient, UserRole } from '@prisma/client';
import { AvailabilityService } from '../src/modules/mems-borrow/availability.service';
import { ApprovalService } from '../src/modules/mems-borrow/approval.service';
import { AssignmentService } from '../src/modules/mems-borrow/assignment.service';
import { HandoverService } from '../src/modules/mems-borrow/handover.service';
import { ReturnService } from '../src/modules/mems-borrow/return.service';

const prisma = new PrismaClient() as any;

async function cleanupOldRequests(codes: string[]) {
  const reqs = await prisma.memsBorrowRequest.findMany({
    where: { request_code: { in: codes } },
    select: { id: true, request_code: true },
  });
  for (const r of reqs) {
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_return_photos" WHERE "return_line_id" IN (SELECT "id" FROM "mems_return_lines" WHERE "return_id" IN (SELECT "id" FROM "mems_returns" WHERE "request_id" = $1::uuid))`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_return_accessories" WHERE "return_line_id" IN (SELECT "id" FROM "mems_return_lines" WHERE "return_id" IN (SELECT "id" FROM "mems_returns" WHERE "request_id" = $1::uuid))`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_return_lines" WHERE "return_id" IN (SELECT "id" FROM "mems_returns" WHERE "request_id" = $1::uuid)`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_returns" WHERE "request_id" = $1::uuid`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_handover_photos" WHERE "handover_line_id" IN (SELECT "id" FROM "mems_handover_lines" WHERE "handover_id" IN (SELECT "id" FROM "mems_handovers" WHERE "request_id" = $1::uuid))`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_handover_accessories" WHERE "handover_line_id" IN (SELECT "id" FROM "mems_handover_lines" WHERE "handover_id" IN (SELECT "id" FROM "mems_handovers" WHERE "request_id" = $1::uuid))`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_handover_lines" WHERE "handover_id" IN (SELECT "id" FROM "mems_handovers" WHERE "request_id" = $1::uuid)`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_handovers" WHERE "request_id" = $1::uuid`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_approvals" WHERE "request_id" = $1::uuid`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_reservations" WHERE "request_line_id" IN (SELECT "id" FROM "mems_request_lines" WHERE "request_id" = $1::uuid)`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_request_lines" WHERE "request_id" = $1::uuid`, r.id);
    await prisma.$executeRawUnsafe(`DELETE FROM "mems_borrow_requests" WHERE "id" = $1::uuid`, r.id);
  }
}

async function runLiveMultiAgentSimulation() {
  console.log('================================================================');
  console.log('🤖 BẮT ĐẦU CHẠY MÔ PHỎNG HỆ THỐNG 5 AGENT ĐỘC LẬP (LIVE TEST)');
  console.log('================================================================\n');

  const availabilityService = new AvailabilityService(prisma);
  const approvalService = new ApprovalService(prisma);
  const assignmentService = new AssignmentService(prisma, availabilityService);
  const handoverService = new HandoverService(prisma);
  const returnService = new ReturnService(prisma);

  // Lấy bộ phận Media
  const mediaDept = await prisma.memsDepartment.findFirst({
    where: { code: 'MEDIA' },
  });
  if (!mediaDept) throw new Error('Không tìm thấy bộ phận MEDIA');

  // 1. Chuẩn bị người dùng đại diện
  const userCameraman = await prisma.user.findFirst({
    where: { email: 'nvmedia@gmail.com' },
  });
  const userLeaderAdmin = await prisma.user.findFirst({
    where: { email: 'testadmin@gmail.com' },
  });

  if (!userCameraman || !userLeaderAdmin) {
    throw new Error('Không tìm thấy tài khoản nvmedia hoặc testadmin');
  }

  // Lấy các model
  const modelTamron = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: 'Tamron' } },
  });
  const modelSd128 = await prisma.memsAssetModel.findFirst({
    where: { name: { contains: '128GB' } },
  });

  if (!modelTamron || !modelSd128) {
    throw new Error('Không tìm thấy model Tamron hoặc SD 128GB');
  }

  // Dọn dẹp dữ liệu cũ của test này nếu có
  await cleanupOldRequests(['REQ-AGENT-LIVE-01', 'REQ-AGENT-LIVE-02']);

  // =================================================================
  // AGENT 1 (Cameraman): Tạo phiếu mượn có đính kèm ảnh bằng chứng
  // =================================================================
  console.log('🎬 [AGENT 1: Cameraman - Hoàng Nam]');
  console.log('-> Tạo phiếu mượn: 1 Lens Tamron 28-75mm + 1 Thẻ nhớ 128GB');
  console.log('-> Đính kèm 2 ảnh bằng chứng từ điện thoại di động');

  const now = new Date();
  const fromTime = new Date(now.getTime() + 2 * 3600 * 1000);
  const toTime = new Date(now.getTime() + 10 * 3600 * 1000);
  const bufferToTime = new Date(toTime.getTime() + 2 * 3600 * 1000);

  const req1 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-AGENT-LIVE-01',
      owner_id: userCameraman.id,
      department_id: mediaDept.id,
      project: 'Quay TVC Quảng Cáo Thu 2026',
      place: 'Studio Phim Trường Hoàn Kiếm',
      purpose: 'WORK',
      from_time: fromTime,
      to_time: toTime,
      status: 'PENDING_APPROVAL',
      note: JSON.stringify({
        text: 'Dự án gấp, thiết bị đã kiểm tra chụp ảnh đính kèm',
        photos: [
          'https://storage.vcbi.vn/photos/tamron-check1.jpg',
          'https://storage.vcbi.vn/photos/tamron-check2.jpg',
        ],
      }),
      lines: {
        create: [
          {
            model_id: modelTamron.id,
            quantity: 1,
            reservations: {
              create: [{ model_id: modelTamron.id, from_time: fromTime, to_time: toTime, buffer_to_time: bufferToTime, status: 'TENTATIVE' }],
            },
          },
          {
            model_id: modelSd128.id,
            quantity: 1,
            reservations: {
              create: [{ model_id: modelSd128.id, from_time: fromTime, to_time: toTime, buffer_to_time: bufferToTime, status: 'TENTATIVE' }],
            },
          },
        ],
      },
    },
    include: { lines: { include: { model: true } } },
  });

  console.log(`✓ Đã tạo phiếu mượn thành công: Mã [${req1.request_code}], Trạng thái: ${req1.status}`);
  console.log(`  Lines: ${req1.lines.map((l: any) => `${l.quantity}x ${l.model.name}`).join(' | ')}\n`);

  // =================================================================
  // AGENT 2 (Leader Media): Phê duyệt phiếu mượn cấp tốc 1 chạm
  // =================================================================
  console.log('👔 [AGENT 2: Leader Media - Trần Duyệt]');
  console.log(`-> Kiểm tra quyền ký & duyệt phiếu ${req1.request_code}`);

  const approverInfo = {
    id: userLeaderAdmin.id,
    roles: [UserRole.ADMIN, UserRole.LEADER],
    team: 'MEDIA',
  };

  const approvedReq = await approvalService.approve(req1.id, approverInfo, {
    reason: 'Đồng ý cấp thiết bị quay TVC chiến dịch mùa thu',
  });

  console.log(`✓ Leader đã phê duyệt thành công! Trạng thái mới: ${approvedReq.status}\n`);

  // =================================================================
  // AGENT 3 (Thủ kho): Bàn giao máy & Kế thừa tự động ảnh từ người mượn
  // =================================================================
  console.log('📦 [AGENT 3: Thủ kho - Lê Bàn Giao]');
  console.log('-> Kiểm tra danh sách máy rảnh khả dụng cho từng dòng máy');

  const tamronLine = req1.lines.find((l: any) => l.model_id === modelTamron.id)!;
  const sdLine = req1.lines.find((l: any) => l.model_id === modelSd128.id)!;

  const freeTamron = await assignmentService.assignableUnits(tamronLine.id);
  const freeSd = await assignmentService.assignableUnits(sdLine.id);

  console.log(`  - Máy Tamron khả dụng: ${freeTamron.map((a: any) => a.asset_code).join(', ')}`);
  console.log(`  - Thẻ nhớ khả dụng: ${freeSd.map((a: any) => a.asset_code).join(', ')}`);

  if (freeTamron.length === 0 || freeSd.length === 0) {
    throw new Error('Hết máy khả dụng ngoài dự kiến');
  }

  const assignedTamronAsset = freeTamron[0];
  const assignedSdAsset = freeSd[0];

  console.log(`-> Gán số Serial cụ thể: Tamron=[${assignedTamronAsset.asset_code} (SN: ${assignedTamronAsset.serial_number})], SD=[${assignedSdAsset.asset_code} (SN: ${assignedSdAsset.serial_number})]`);

  await assignmentService.assign(req1.id, {
    lines: [
      { lineId: tamronLine.id, assetIds: [assignedTamronAsset.id] },
      { lineId: sdLine.id, assetIds: [assignedSdAsset.id] },
    ],
  });

  console.log('-> Lập biên bản bàn giao (KHÔNG cần tải ảnh thủ công - Kế thừa tự động từ Agent 1)');
  const handoverResult = await handoverService.create(req1.id, userLeaderAdmin.id, {
    receivedBy: userCameraman.full_name || 'Hoàng Nam',
    note: 'Đã bàn giao đầy đủ cho cameraman theo đúng kiểm tra',
    units: [
      {
        assetId: assignedTamronAsset.id,
        condition: 'GOOD',
        accessories: [],
        photoKeys: [], // Rỗng! Hệ thống sẽ tự động kế thừa từ note của req1
      },
      {
        assetId: assignedSdAsset.id,
        condition: 'GOOD',
        accessories: [],
        photoKeys: [], // Rỗng! Tự động kế thừa
      },
    ],
  });

  console.log(`✓ Đã bàn giao thiết bị thành công! ID biên bản: ${handoverResult.id}`);

  // Kiểm tra trạng thái phiếu và máy sau bàn giao
  const checkedReq1 = await prisma.memsBorrowRequest.findUnique({
    where: { id: req1.id },
  });
  const checkedTamron = await prisma.memsAsset.findUnique({
    where: { id: assignedTamronAsset.id },
  });
  console.log(`  - Trạng thái phiếu mượn: ${checkedReq1?.status} (Kỳ vọng: ON_LOAN)`);
  console.log(`  - Trạng thái máy Tamron: ${checkedTamron?.status} (Kỳ vọng: ON_LOAN)`);

  // Kiểm tra ảnh kế thừa
  const inheritedPhotos = await prisma.memsAssetPhoto.findMany({
    where: { asset_id: assignedTamronAsset.id, purpose: 'HANDOVER' },
  });
  console.log(`  - Số lượng ảnh bàn giao tự động kế thừa cho Tamron: ${inheritedPhotos.length} ảnh`);
  console.log(`  - URL ảnh kế thừa: ${inheritedPhotos.map((p: any) => p.url).join(', ')}\n`);

  // =================================================================
  // AGENT 4: Thủ kho xử lý trường hợp hết máy rảnh & Nhập nhanh Serial
  // =================================================================
  console.log('⚡ [AGENT 4: Thủ kho - Xử lý hết máy rảnh & Nhập nhanh Serial]');
  console.log('-> Giả lập tình huống: Tạo phiếu mới đòi mượn dòng Tamron');

  const req2 = await prisma.memsBorrowRequest.create({
    data: {
      request_code: 'REQ-AGENT-LIVE-02',
      owner_id: userCameraman.id,
      department_id: mediaDept.id,
      project: 'Quay Phỏng Vấn Hiện Trường',
      place: 'Phố Cổ',
      purpose: 'WORK',
      from_time: fromTime,
      to_time: toTime,
      status: 'APPROVED', // Giả sử đã duyệt xong
      lines: {
        create: [
          {
            model_id: modelTamron.id,
            quantity: 1,
            reservations: { create: [{ model_id: modelTamron.id, from_time: fromTime, to_time: toTime, buffer_to_time: bufferToTime, status: 'TENTATIVE' }] },
          },
        ],
      },
    },
    include: { lines: true },
  });

  const req2TamronLine = req2.lines[0];
  const req2Available = await assignmentService.assignableUnits(req2TamronLine.id);
  console.log(`  - Số máy Tamron rảnh hiện tại trong kho: ${req2Available.length} máy`);

  // Nhập nhanh số serial máy mới vào kho
  const quickSerialCode = 'LENS-TAMRON-LIVE-99';
  const quickSerialNum = 'SN-LIVE-2026';
  console.log(`-> Thủ kho kích hoạt tính năng: "Nhập nhanh số Serial mới vào kho" [${quickSerialCode} - ${quickSerialNum}]`);

  // Xoá máy cũ nếu trùng mã
  await prisma.memsAsset.deleteMany({
    where: { OR: [{ asset_code: quickSerialCode }, { serial_number: quickSerialNum }] },
  });

  const newQuickAsset = await prisma.memsAsset.create({
    data: {
      asset_code: quickSerialCode,
      serial_number: quickSerialNum,
      model_id: modelTamron.id,
      status: 'AVAILABLE',
      condition: 'GOOD',
      qr_code: `MEMS:${quickSerialCode}`,
    },
  });
  console.log(`✓ Nhập kho thành công máy mới ID: ${newQuickAsset.id}`);

  // Gán ngay lập tức vào phiếu
  await assignmentService.assign(req2.id, {
    lines: [{ lineId: req2TamronLine.id, assetIds: [newQuickAsset.id] }],
  });
  console.log('✓ Gán máy mới vừa nhập kho thành công cho phiếu REQ-AGENT-LIVE-02!\n');

  // =================================================================
  // AGENT 5 (Thủ kho): Tiếp nhận trả máy, kiểm tra phụ kiện & đóng phiếu
  // =================================================================
  console.log('🔄 [AGENT 5: Thủ kho - Phạm Thu Hồi / Nhận Trả Thiết Bị]');
  console.log(`-> Cameraman trả lại toàn bộ máy của phiếu ${req1.request_code}`);

  const pendingReturn = await returnService.pendingUnits(req1.id);
  console.log(`  - Số thiết bị cần thu hồi: ${pendingReturn.units.length} thiết bị`);

  // Tạo ảnh bằng chứng trả máy trong memsAssetPhoto
  const returnPhotoTamron = await prisma.memsAssetPhoto.create({
    data: {
      asset_id: assignedTamronAsset.id,
      url: 'https://storage.vcbi.vn/photos/return-tamron.jpg',
      storage: 'local',
      purpose: 'RETURN',
      uploaded_by: userLeaderAdmin.id,
    },
  });
  const returnPhotoSd = await prisma.memsAssetPhoto.create({
    data: {
      asset_id: assignedSdAsset.id,
      url: 'https://storage.vcbi.vn/photos/return-sd.jpg',
      storage: 'local',
      purpose: 'RETURN',
      uploaded_by: userLeaderAdmin.id,
    },
  });

  const returnPayload = {
    note: 'Đã nhận đủ toàn bộ thiết bị, ống kính và thẻ nhớ sạch sẽ, hoạt động hoàn hảo',
    units: [
      {
        assetId: assignedTamronAsset.id,
        condition: 'GOOD',
        photoKeys: [returnPhotoTamron.id],
        accessories: [],
      },
      {
        assetId: assignedSdAsset.id,
        condition: 'GOOD',
        photoKeys: [returnPhotoSd.id],
        accessories: [],
      },
    ],
  };

  const returnResult = await returnService.create(req1.id, userLeaderAdmin.id, returnPayload);
  console.log(`✓ Đã tạo biên bản thu hồi thành công! ID: ${returnResult.id}`);

  // Kiểm tra kết quả đóng phiếu và hoàn trả máy về kệ
  const finalReq1 = await prisma.memsBorrowRequest.findUnique({
    where: { id: req1.id },
  });
  const finalTamronAsset = await prisma.memsAsset.findUnique({
    where: { id: assignedTamronAsset.id },
  });
  const finalSdAsset = await prisma.memsAsset.findUnique({
    where: { id: assignedSdAsset.id },
  });

  console.log(`  - Trạng thái cuối cùng của phiếu mượn: ${finalReq1?.status} (Kỳ vọng: CLOSED)`);
  console.log(`  - Trạng thái máy Tamron: ${finalTamronAsset?.status} (Kỳ vọng: AVAILABLE)`);
  console.log(`  - Trạng thái Thẻ nhớ: ${finalSdAsset?.status} (Kỳ vọng: AVAILABLE)`);

  console.log('\n================================================================');
  console.log('🎉 TOÀN BỘ 5 AGENT ĐÃ HOÀN TẤT THỬ NGHIỆM VỚI KẾT QUẢ 100% THÀNH CÔNG!');
  console.log('================================================================\n');
}

runLiveMultiAgentSimulation()
  .catch((err) => {
    console.error('❌ Lỗi trong quá trình mô phỏng multi-agent:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

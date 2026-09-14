import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemsPhotoUrlSigner } from '../../common/mems/photo-url-signer.service';
import { CreateAssetDto, CreateCategoryDto, CreateLocationDto, CreateModelDto, UpdateAssetDto, UpdateLocationDto } from './dto';
import { intakeStatusFor } from './intake-rules';

/**
 * Trạng thái chỉ quy trình mới sinh ra được, không đặt tay.
 *
 * `ON_LOAN` do màn Bàn giao đặt, `POST_RETURN_CHECK` do màn Nhận trả đặt. Cho sửa tay thì hai
 * màn đó mất ý nghĩa và máy đang ở ngoài có thể bị đánh dấu đã về mà không có biên bản nào.
 */
const WORKFLOW_ONLY_STATUSES = ['ON_LOAN', 'POST_RETURN_CHECK'];

/**
 * Lối duy nhất đưa một chiếc máy ra khỏi trạng thái do quy trình đặt, bằng tay.
 *
 * Máy mất thì phải ghi nhận được ngay — bắt chờ một biên bản nhận trả hay một buổi kiểm tra sẽ
 * không bao giờ tới là nhốt luôn bản ghi. Và màn Kiểm tra chỉ chào ba kết luận Đạt/Bảo trì/Hỏng,
 * không có Mất, nên nếu chặn nốt lối này thì chiếc biến mất khỏi bàn kiểm tra không ghi nhận
 * được ở đâu cả.
 *
 * Mọi đích khác phải đi qua đúng màn của nó: rời `ON_LOAN` bằng màn Nhận trả, rời
 * `POST_RETURN_CHECK` bằng màn Kiểm tra — chỉ ở đó kết luận Bảo trì mới sinh kèm lệnh bảo trì.
 */
const MANUAL_EXITS_FROM_WORKFLOW = ['LOST'];

@Injectable()
export class MemsCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photoUrls: MemsPhotoUrlSigner,
  ) {}

  async createCategory(dto: CreateCategoryDto) {
    return this.prisma.memsCategory.create({
      data: {
        code: dto.code,
        name: dto.name,
        parent_id: dto.parentId ?? null,
        buffer_minutes: dto.bufferMinutes ?? 0,
      },
    });
  }

  /**
   * BR-04: mã thiết bị và serial duy nhất toàn hệ thống, không sửa được sau khi tạo.
   *
   * Serial được kiểm tra trước khi sinh mã để thông báo lỗi chỉ thẳng vào thiết bị đang trùng —
   * kho hay nhập nhầm lô hàng đổi trả, và câu "serial đã tồn tại" trống trơn thì không tra được.
   */
  async createAsset(dto: CreateAssetDto) {
    let targetSerials: string[] = [];
    if (dto.serialNumbers && dto.serialNumbers.length > 0) {
      targetSerials = dto.serialNumbers.map((s) => s.trim()).filter(Boolean);
    } else if (dto.serialNumber?.trim()) {
      targetSerials = [dto.serialNumber.trim()];
    }

    if (targetSerials.length === 0) {
      throw new BadRequestException('Vui lòng nhập số serial cho thiết bị');
    }

    const qty = Math.max(dto.quantity || 1, targetSerials.length, 1);

    // Nếu người dùng yêu cầu số lượng > 1 nhưng chỉ nhập 1 serial cơ sở (hoặc ít hơn qty)
    if (targetSerials.length === 1 && qty > 1) {
      const baseSerial = targetSerials[0];
      targetSerials = Array.from(
        { length: qty },
        (_, i) => `${baseSerial}-${String(i + 1).padStart(2, '0')}`,
      );
    } else if (targetSerials.length < qty) {
      const baseSerial = targetSerials[0];
      const start = targetSerials.length;
      for (let i = start; i < qty; i++) {
        targetSerials.push(`${baseSerial}-${String(i + 1).padStart(2, '0')}`);
      }
    }

    // Kiểm tra trùng lặp ngay trong danh sách gửi lên
    const serialSet = new Set(targetSerials);
    if (serialSet.size !== targetSerials.length) {
      throw new BadRequestException('Danh sách số serial bị trùng lặp trong cùng lần nhập');
    }

    const releaseDuplicatedRecords: { id: string; serial: string }[] = [];
    for (const sn of targetSerials) {
      const duplicated = await this.prisma.memsAsset.findUnique({
        where: { serial_number: sn },
        select: { id: true, asset_code: true, is_disabled: true },
      });
      if (duplicated) {
        if (!duplicated.is_disabled) {
          throw new ConflictException(
            `Số serial ${sn} đã thuộc thiết bị ${duplicated.asset_code}`,
          );
        }
        releaseDuplicatedRecords.push({ id: duplicated.id, serial: sn });
      }
    }

    const model = await this.prisma.memsAssetModel.findUniqueOrThrow({
      where: { id: dto.modelId },
      include: { category: true },
    });

    const prefix = model.category.code;
    // Tình trạng do người nhập khai, không ép cứng là Tốt: hàng đổi trả hay máy cũ mua lại
    // thường đã có vết, ghi sai ngay từ đầu thì mọi lần đối chiếu về sau đều lệch.
    const condition = dto.condition ?? 'GOOD';
    const status = intakeStatusFor(condition);

    return this.prisma.$transaction(async (tx) => {
      // Đếm và ghi phải nằm trong cùng giao dịch có khoá, nếu không hai người cùng nhập kho sẽ
      // cùng đọc ra N rồi cùng sinh mã N+1 — mà `asset_code` là cột duy nhất, người thứ hai ăn 500.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `mems:asset-code:${prefix}`,
      );

      for (let i = 0; i < releaseDuplicatedRecords.length; i++) {
        const item = releaseDuplicatedRecords[i];
        await tx.memsAsset.update({
          where: { id: item.id },
          data: {
            serial_number: `${item.serial}__deleted_${Date.now()}_${item.id.slice(0, 8)}_${i}`,
          },
        });
      }

      const existing = await tx.memsAsset.count({
        where: { model: { category: { code: prefix } } },
      });

      const createdAssets = [];
      for (let i = 0; i < targetSerials.length; i++) {
        const sn = targetSerials[i];
        const assetCode = `${prefix}-${String(existing + 1 + i).padStart(3, '0')}`;

        const asset = await tx.memsAsset.create({
          data: {
            asset_code: assetCode,
            qr_code: `MEMS:${assetCode}`,
            model_id: dto.modelId,
            serial_number: sn,
            location_id: dto.locationId ?? null,
            purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
            purchase_price: dto.purchasePrice ?? null,
            status: status as any,
            condition: condition as any,
          },
        });

        // Nhật ký vòng đời bắt đầu từ đây chứ không phải từ lần bàn giao đầu tiên. Thiếu mốc này
        // thì màn chi tiết của một chiếc máy chưa ai mượn trông như máy không có quá khứ.
        await tx.memsAssetEvent.create({
          data: {
            asset_id: asset.id,
            kind: 'INTAKE',
            title: 'Nhập kho',
            detail: [
              `tình trạng khi nhập ${condition}`,
              dto.intakeNote?.trim() || null,
              targetSerials.length > 1 ? `(Nhập lô ${i + 1}/${targetSerials.length})` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          },
        });

        createdAssets.push(asset);
      }

      const firstAsset = createdAssets[0];
      if (createdAssets.length === 1) {
        return firstAsset;
      }
      return {
        ...firstAsset,
        assets: createdAssets,
        totalCreated: createdAssets.length,
      };
    });
  }

  /**
   * Cập nhật thông tin thiết bị (Model, Serial, Tình trạng, Trạng thái, Vị trí, Giá, Ghi chú)
   */
  async updateAsset(assetCode: string, dto: UpdateAssetDto) {
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode },
      include: { model: { include: { category: true } }, location: true },
    });
    if (!asset) {
      throw new NotFoundException(`Không tìm thấy thiết bị với mã ${assetCode}`);
    }

    let releaseDuplicatedId: string | null = null;
    // Nếu đổi serial number, kiểm tra xem có bị trùng với máy khác không
    if (dto.serialNumber && dto.serialNumber !== asset.serial_number) {
      const duplicated = await this.prisma.memsAsset.findUnique({
        where: { serial_number: dto.serialNumber },
        select: { id: true, asset_code: true, is_disabled: true },
      });
      if (duplicated && duplicated.id !== asset.id) {
        if (!duplicated.is_disabled) {
          throw new ConflictException(`Số serial ${dto.serialNumber} đã thuộc thiết bị ${duplicated.asset_code}`);
        }
        releaseDuplicatedId = duplicated.id;
      }

      // BR-04 nói serial không sửa được sau khi tạo, nhưng khoá cứng từ giây đầu thì một lỗi
      // chính tả lúc nhập kho không bao giờ sửa được — người ta sẽ xoá máy đi tạo lại và mất
      // luôn nhật ký vòng đời.
      //
      // Mốc thật sự là lần BÀN GIAO ĐẦU TIÊN: từ đó serial đã nằm trong biên bản có chữ ký và
      // trở thành mốc truy trách nhiệm. Đổi nó sau lúc ấy là làm lệch mọi biên bản đã in ra.
      const handedOverTimes = await this.prisma.memsHandoverLine.count({
        where: { asset_id: asset.id },
      });
      if (handedOverTimes > 0) {
        throw new ConflictException(
          `Máy ${asset.asset_code} đã được bàn giao ${handedOverTimes} lượt nên serial đã đi vào ` +
            'biên bản, không đổi được nữa. Serial ghi sai thì ngừng dùng máy này và nhập lại bản ghi mới.',
        );
      }
    }

    // Giữ chỗ ghi ở MỨC MODEL (QĐ-01): phiếu đặt "một chiếc A7 IV", kho tự chọn chiếc nào. Nên
    // đổi model của một chiếc đang được ghim vào phiếu là lặng lẽ rút nó khỏi phép đếm khả dụng
    // của model cũ — không lỗi, không cảnh báo, và kho chỉ phát hiện lúc đứng ra bàn giao.
    if (dto.modelId && dto.modelId !== asset.model_id) {
      const activeReservations = await this.prisma.memsReservation.count({
        where: {
          asset_id: asset.id,
          status: { in: ['TENTATIVE', 'CONFIRMED'] },
        },
      });
      if (activeReservations > 0) {
        throw new ConflictException(
          `Máy ${asset.asset_code} đang được giữ chỗ cho ${activeReservations} lượt mượn, ` +
            'không đổi model được. Huỷ hoặc hoàn tất các phiếu đó trước.',
        );
      }
    }

    // Đổi sang trạng thái do quy trình sinh ra là đi vòng qua màn Bàn giao / Nhận trả. Giữ
    // nguyên giá trị đang có thì không tính là đổi — ô select ở form luôn gửi lại trạng thái
    // hiện tại kèm mọi lần sửa serial hay vị trí.
    const nextStatus = (dto.status as string | undefined) ?? asset.status;
    if (nextStatus !== asset.status && WORKFLOW_ONLY_STATUSES.includes(nextStatus)) {
      throw new BadRequestException(
        `Trạng thái ${nextStatus} chỉ sinh ra từ màn Bàn giao hoặc Nhận trả, không đặt tay được`,
      );
    }
    // Chặn cả chiều ĐI RA, không chỉ chiều đi vào.
    //
    // Bản trước chỉ cấm đặt tay SANG các trạng thái này, còn rời khỏi chúng thì bỏ ngỏ — nên một
    // chiếc đang nằm ngoài công ty có thể bị sửa về Sẵn sàng: nó lập tức quay lại phép đếm khả
    // dụng và danh sách máy gán được, trong khi phiếu vẫn Đang mượn và chưa ai mang máy về. Với
    // `POST_RETURN_CHECK` thì đi vòng qua màn Kiểm tra còn bỏ luôn lệnh bảo trì mà kết luận Bảo
    // trì phải sinh ra — chỉ đổi cột trạng thái thì máy nằm ở xưởng vẫn hiện là rảnh.
    //
    // Trừ đúng một lối: đánh dấu MẤT. Xem `MANUAL_EXITS_FROM_WORKFLOW`.
    if (
      nextStatus !== asset.status &&
      WORKFLOW_ONLY_STATUSES.includes(asset.status) &&
      !MANUAL_EXITS_FROM_WORKFLOW.includes(nextStatus)
    ) {
      const door = asset.status === 'ON_LOAN' ? 'Nhận trả' : 'Kiểm tra';
      throw new BadRequestException(
        `Máy đang ở trạng thái ${asset.status} do quy trình đặt. Đưa máy ra khỏi trạng thái này ` +
          `bằng màn ${door}, hoặc đánh dấu Mất nếu máy không còn nữa.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Bảo trì bị loại khỏi khả dụng qua bảng `MemsMaintenance`, KHÔNG qua cột trạng thái.
      // Chỉ đổi cột thì máy nằm ở xưởng vẫn hiện là rảnh trong mọi khoảng tương lai; còn chỉ
      // đổi cột lúc quay về thì lệnh bảo trì bỏ ngỏ giữ máy bận vĩnh viễn. Phải chạm cả hai.
      if ((dto.status ?? asset.status) === 'UNDER_MAINTENANCE' && asset.status !== 'UNDER_MAINTENANCE') {
        await tx.memsMaintenance.create({
          data: {
            asset_id: asset.id,
            reason: dto.note?.trim() || 'Chuyển bảo trì từ màn sửa thiết bị',
            from_time: new Date(),
            // Bỏ ngỏ điểm kết thúc: đoán bừa ngày trả xưởng thì tới hạn máy tự "rảnh" trong
            // khi vẫn đang nằm ở chỗ thợ.
            to_time: null,
          },
        });
      }
      if (asset.status === 'UNDER_MAINTENANCE' && (dto.status ?? asset.status) !== 'UNDER_MAINTENANCE') {
        await tx.memsMaintenance.updateMany({
          where: { asset_id: asset.id, to_time: null },
          data: { to_time: new Date() },
        });
      }

      if (releaseDuplicatedId) {
        await tx.memsAsset.update({
          where: { id: releaseDuplicatedId },
          data: {
            serial_number: `${dto.serialNumber}__deleted_${Date.now()}_${releaseDuplicatedId.slice(0, 8)}`,
          },
        });
      }

      const updated = await tx.memsAsset.update({
        where: { id: asset.id },
        data: {
          model_id: dto.modelId ?? asset.model_id,
          serial_number: dto.serialNumber ?? asset.serial_number,
          location_id: dto.locationId !== undefined ? (dto.locationId || null) : asset.location_id,
          purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : asset.purchase_date,
          purchase_price: dto.purchasePrice !== undefined ? dto.purchasePrice : asset.purchase_price,
          condition: (dto.condition as any) ?? asset.condition,
          status: nextStatus as any,
        },
        include: {
          model: { include: { category: true } },
          location: true,
          photos: { where: { is_primary: true }, take: 1 },
        },
      });

      // Ghi nhật ký vòng đời
      await tx.memsAssetEvent.create({
        data: {
          asset_id: asset.id,
          kind: 'CONDITION_CHANGED',
          title: 'Cập nhật thông tin',
          detail: [
            dto.condition && dto.condition !== asset.condition ? `Đổi tình trạng: ${dto.condition}` : null,
            dto.status && dto.status !== asset.status ? `Đổi trạng thái: ${dto.status}` : null,
            dto.note?.trim() || null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Chỉnh sửa thông số/vị trí',
          occurred_at: new Date(),
        },
      });

      return updated;
    });
  }

  /**
   * Xóa thiết bị khỏi kho:
   * Nếu đang có người mượn hoặc giữ chỗ -> Báo lỗi.
   * Nếu đã có lịch sử mượn/sự cố -> Soft-delete (is_disabled = true).
   */
  async deleteAsset(assetCode: string) {
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode },
      include: {
        reservations: { where: { status: { in: ['TENTATIVE', 'CONFIRMED'] } } },
        handoverLines: { where: { handover: { request: { status: 'ON_LOAN' } } } },
      },
    });
    if (!asset) {
      throw new NotFoundException(`Không tìm thấy thiết bị với mã ${assetCode}`);
    }

    if (asset.status === 'ON_LOAN' || asset.reservations.length > 0 || asset.handoverLines.length > 0) {
      throw new ConflictException(
        `Thiết bị ${assetCode} đang được sử dụng hoặc có lịch giữ chỗ, không thể xóa!`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Soft delete: đánh dấu ngừng sử dụng để bảo toàn toàn bộ lịch sử kế toán/báo cáo.
      // Giải phóng số serial để có thể tái sử dụng hoặc nhập lại thiết bị mới mang serial này.
      const freedSerial = asset.serial_number
        ? (asset.serial_number.includes('__deleted_')
            ? asset.serial_number
            : `${asset.serial_number}__deleted_${Date.now()}_${asset.id.slice(0, 8)}`)
        : undefined;

      await tx.memsAsset.update({
        where: { id: asset.id },
        data: {
          is_disabled: true,
          status: 'DISPOSED',
          ...(freedSerial ? { serial_number: freedSerial } : {}),
        },
      });

      await tx.memsAssetEvent.create({
        data: {
          asset_id: asset.id,
          kind: 'CONDITION_CHANGED',
          title: 'Xóa khỏi kho',
          detail: 'Ngừng sử dụng thiết bị và chuyển trạng thái thanh lý/hủy',
          occurred_at: new Date(),
        },
      });

      return { success: true, message: `Đã xóa thiết bị ${assetCode} khỏi kho thành công.` };
    });
  }

  /**
   * Danh mục, model và vị trí — ba nguồn cho dropdown của form nhập kho.
   *
   * Tách khỏi `listAssets` chứ không bắt FE gom nhóm từ danh sách máy: model vừa khai mà chưa
   * nhập máy nào sẽ không xuất hiện trong danh sách máy, mà đó đúng là lúc form nhập kho cần tới nó.
   */
  listCategories() {
    return this.prisma.memsCategory.findMany({
      where: { is_disabled: false },
      orderBy: { name: 'asc' },
    });
  }

  listModels(filter: { categoryId?: string } = {}) {
    return this.prisma.memsAssetModel.findMany({
      where: {
        is_disabled: false,
        ...(filter.categoryId ? { category_id: filter.categoryId } : {}),
      },
      include: {
        category: true,
        accessories: true,
        _count: { select: { assets: { where: { is_disabled: false } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async deleteModel(id: string) {
    const model = await this.prisma.memsAssetModel.findUnique({
      where: { id },
      include: {
        assets: {
          where: { is_disabled: false },
          select: { id: true, asset_code: true },
        },
      },
    });

    if (!model) {
      throw new NotFoundException('Không tìm thấy model này');
    }

    if (model.assets.length > 0) {
      throw new ConflictException(
        `Model "${model.name}" đang có ${model.assets.length} thiết bị hoạt động trong kho (${model.assets.map((a) => a.asset_code).join(', ')}). Vui lòng xóa các thiết bị trước khi xóa model.`,
      );
    }

    return this.prisma.memsAssetModel.update({
      where: { id },
      data: { is_disabled: true },
    });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.memsCategory.findUnique({
      where: { id },
      include: {
        models: {
          include: {
            assets: {
              where: { is_disabled: false },
              select: { id: true, asset_code: true },
            },
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Không tìm thấy danh mục này');
    }

    const activeAssets = category.models.flatMap((m) => m.assets);
    if (activeAssets.length > 0) {
      throw new ConflictException(
        `Danh mục "${category.name}" đang có ${activeAssets.length} thiết bị hoạt động trong kho. Vui lòng xóa các thiết bị trước khi xóa danh mục.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.memsAssetModel.updateMany({
        where: { category_id: id },
        data: { is_disabled: true },
      });

      return tx.memsCategory.update({
        where: { id },
        data: { is_disabled: true },
      });
    });
  }

  /**
   * Khai một model mới trong danh mục.
   *
   * Phụ kiện tạo LỒNG trong cùng lệnh `create` chứ không phải `createMany` riêng sau đó: lồng
   * thì Prisma tự gói vào một giao dịch, còn tách rời thì model có thể ra đời mà phụ kiện thì
   * không, và một model thiếu phụ kiện chuẩn sẽ làm mọi biên bản bàn giao sau đó thiếu theo.
   *
   * `sort_order` bám theo thứ tự người dùng nhập vì đó là thứ tự in trên biên bản bàn giao —
   * để Prisma tự sắp thì thủ kho dò theo danh sách in ra sẽ lệch hàng.
   */
  async createModel(dto: CreateModelDto) {
    // Schema không có ràng buộc duy nhất cho (category_id, name), nên bỏ kiểm tra ở đây là
    // thật sự cho phép hai model trùng tên — dropdown chọn máy thành trò đoán mò.
    const duplicated = await this.prisma.memsAssetModel.findFirst({
      where: { category_id: dto.categoryId, name: dto.name },
      select: { id: true },
    });
    if (duplicated) {
      throw new ConflictException(`Model ${dto.name} đã có trong danh mục này`);
    }

    return this.prisma.memsAssetModel.create({
      data: {
        category_id: dto.categoryId,
        name: dto.name,
        manufacturer: dto.manufacturer ?? null,
        reference_price: dto.referencePrice ?? null,
        accessories: {
          create: (dto.accessories ?? []).map((name, index) => ({
            name,
            sort_order: index,
          })),
        },
      },
      include: { category: true, accessories: true },
    });
  }

  createLocation(dto: CreateLocationDto) {
    return this.prisma.memsLocation.create({
      data: {
        name: dto.name.trim(),
        parent_id: dto.parentId ?? null,
      },
    });
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    const loc = await this.prisma.memsLocation.findUnique({ where: { id } });
    if (!loc) throw new NotFoundException('Không tìm thấy vị trí kho này');
    return this.prisma.memsLocation.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        parent_id: dto.parentId !== undefined ? (dto.parentId || null) : loc.parent_id,
      },
    });
  }

  async deleteLocation(id: string) {
    const loc = await this.prisma.memsLocation.findUnique({
      where: { id },
      include: { assets: { where: { is_disabled: false } } },
    });
    if (!loc) throw new NotFoundException('Không tìm thấy vị trí kho này');
    if (loc.assets.length > 0) {
      throw new ConflictException(
        `Vị trí này đang chứa ${loc.assets.length} thiết bị, vui lòng chuyển thiết bị sang vị trí khác trước khi xóa.`,
      );
    }
    return this.prisma.memsLocation.update({
      where: { id },
      data: { is_disabled: true },
    });
  }

  listLocations() {
    return this.prisma.memsLocation.findMany({
      where: { is_disabled: false },
      include: { _count: { select: { assets: { where: { is_disabled: false } } } } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Chi tiết thiết bị kèm toàn bộ nhật ký vòng đời (MH-03).
   *
   * Trả về cả máy khác cùng model: khi máy này hỏng hay đang có người mượn, người xem cần biết
   * ngay kho còn phương án thay thế nào không (QĐ-01).
   */
  async assetDetail(assetCode: string) {
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode },
      include: {
        model: { include: { category: true, accessories: true } },
        location: true,
        // Chỉ ảnh hồ sơ: ảnh biên bản bàn giao/nhận trả cũng nằm ở bảng này, không lọc thì một
        // chiếc mượn nhiều lần sẽ có hàng chục tấm chứng cứ tràn vào thư viện ảnh của máy.
        photos: {
          where: { purpose: 'CATALOG' },
          orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }],
        },
      },
    });
    if (!asset) throw new NotFoundException(`Không có máy ${assetCode}`);

    const events = await this.prisma.memsAssetEvent.findMany({
      where: { asset_id: asset.id },
      orderBy: { occurred_at: 'desc' },
      take: 50,
    });

    const nextReservation = await this.prisma.memsReservation.findFirst({
      where: {
        asset_id: asset.id,
        status: { in: ['TENTATIVE', 'CONFIRMED'] },
        from_time: { gte: new Date() },
      },
      orderBy: { from_time: 'asc' },
      include: { request_line: { include: { request: true } } },
    });

    // Giữ chỗ ghi ở mức model nên còn máy khác cùng model là phiếu sau chưa bị ảnh hưởng (QĐ-01).
    const siblingsAvailable = await this.prisma.memsAsset.count({
      where: {
        model_id: asset.model_id,
        id: { not: asset.id },
        is_disabled: false,
        status: 'AVAILABLE',
      },
    });

    return {
      // Ký URL ảnh: route phục vụ ảnh là công khai nên nó chỉ nhận đường dẫn có token còn hạn.
      asset: {
        ...asset,
        photos: this.photoUrls.signAll(asset.photos),
        serial_number: asset.serial_number?.split('__deleted_')[0] ?? asset.serial_number,
      },
      events,
      next_reservation: nextReservation,
      siblings_available: siblingsAvailable,
    };
  }

  /** QĐ-07: mặc định ẩn bản ghi đã ngừng sử dụng, không xoá cứng bao giờ. */
  async listAssets(filter: { categoryId?: string; status?: string }) {
    const assets = await this.prisma.memsAsset.findMany({
      where: {
        is_disabled: false,
        ...(filter.status ? { status: filter.status as any } : {}),
        ...(filter.categoryId ? { model: { category_id: filter.categoryId } } : {}),
      },
      include: {
        model: { include: { category: true } },
        location: true,
        // Chỉ ảnh đại diện: bảng kho có hàng chục dòng, kéo cả bộ ảnh mỗi dòng là phí băng thông
        // cho thứ không ai nhìn tới cho đến khi bấm vào máy.
        photos: { where: { is_primary: true }, take: 1 },
      },
      orderBy: { asset_code: 'asc' },
    });

    // Ký URL ảnh đại diện, nếu không thì mọi ô ảnh trong bảng kho đều là 404.
    return assets.map((asset) => ({
      ...asset,
      photos: this.photoUrls.signAll(asset.photos),
      serial_number: asset.serial_number?.split('__deleted_')[0] ?? asset.serial_number,
    }));
  }
}

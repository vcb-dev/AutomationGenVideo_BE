import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAssetDto, CreateCategoryDto, CreateLocationDto, CreateModelDto, UpdateAssetDto, UpdateLocationDto } from './dto';

@Injectable()
export class MemsCatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
    const duplicated = await this.prisma.memsAsset.findUnique({
      where: { serial_number: dto.serialNumber },
      select: { id: true, asset_code: true },
    });
    if (duplicated) {
      throw new ConflictException(
        `Số serial ${dto.serialNumber} đã thuộc thiết bị ${duplicated.asset_code}`,
      );
    }

    const model = await this.prisma.memsAssetModel.findUniqueOrThrow({
      where: { id: dto.modelId },
      include: { category: true },
    });

    const prefix = model.category.code;
    const existing = await this.prisma.memsAsset.count({
      where: { model: { category: { code: prefix } } },
    });
    const assetCode = `${prefix}-${String(existing + 1).padStart(3, '0')}`;

    // Tình trạng do người nhập khai, không ép cứng là Tốt: hàng đổi trả hay máy cũ mua lại
    // thường đã có vết, ghi sai ngay từ đầu thì mọi lần đối chiếu về sau đều lệch.
    const condition = dto.condition ?? 'GOOD';

    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.memsAsset.create({
        data: {
          asset_code: assetCode,
          qr_code: `MEMS:${assetCode}`,
          model_id: dto.modelId,
          serial_number: dto.serialNumber,
          location_id: dto.locationId ?? null,
          purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
          purchase_price: dto.purchasePrice ?? null,
          status: 'PENDING_INSPECTION', // BR-05
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
          detail: [`tình trạng khi nhập ${condition}`, dto.intakeNote?.trim() || null]
            .filter(Boolean)
            .join(' · '),
        },
      });

      return asset;
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

    // Nếu đổi serial number, kiểm tra xem có bị trùng với máy khác không
    if (dto.serialNumber && dto.serialNumber !== asset.serial_number) {
      const duplicated = await this.prisma.memsAsset.findUnique({
        where: { serial_number: dto.serialNumber },
      });
      if (duplicated && duplicated.id !== asset.id) {
        throw new ConflictException(`Số serial ${dto.serialNumber} đã thuộc thiết bị ${duplicated.asset_code}`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.memsAsset.update({
        where: { id: asset.id },
        data: {
          model_id: dto.modelId ?? asset.model_id,
          serial_number: dto.serialNumber ?? asset.serial_number,
          location_id: dto.locationId !== undefined ? (dto.locationId || null) : asset.location_id,
          purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : asset.purchase_date,
          purchase_price: dto.purchasePrice !== undefined ? dto.purchasePrice : asset.purchase_price,
          condition: (dto.condition as any) ?? asset.condition,
          status: (dto.status as any) ?? asset.status,
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
      // Soft delete: đánh dấu ngừng sử dụng để bảo toàn toàn bộ lịch sử kế toán/báo cáo
      await tx.memsAsset.update({
        where: { id: asset.id },
        data: {
          is_disabled: true,
          status: 'DISPOSED',
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
      include: { category: true, accessories: true, _count: { select: { assets: true } } },
      orderBy: { name: 'asc' },
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
        photos: { orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }] },
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
      asset,
      events,
      next_reservation: nextReservation,
      siblings_available: siblingsAvailable,
    };
  }

  /** QĐ-07: mặc định ẩn bản ghi đã ngừng sử dụng, không xoá cứng bao giờ. */
  async listAssets(filter: { categoryId?: string; status?: string }) {
    return this.prisma.memsAsset.findMany({
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
  }
}

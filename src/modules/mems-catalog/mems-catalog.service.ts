import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAssetDto, CreateCategoryDto, CreateModelDto } from './dto';

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

    return this.prisma.memsAsset.create({
      data: {
        asset_code: assetCode,
        qr_code: `MEMS:${assetCode}`,
        model_id: dto.modelId,
        serial_number: dto.serialNumber,
        location_id: dto.locationId ?? null,
        purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
        purchase_price: dto.purchasePrice ?? null,
        status: 'PENDING_INSPECTION', // BR-05
        condition: 'GOOD',
      },
    });
  }

  /**
   * Danh mục, model và vị trí — ba nguồn cho dropdown của form nhập kho.
   *
   * Tách khỏi `listAssets` chứ không bắt FE gom nhóm từ danh sách máy: model vừa khai mà chưa
   * nhập máy nào sẽ không xuất hiện trong danh sách máy, mà đó đúng là lúc người ta cần nó nhất.
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
        accessories: { orderBy: { sort_order: 'asc' } },
        _count: { select: { assets: true } },
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  listLocations() {
    return this.prisma.memsLocation.findMany({
      where: { is_disabled: false },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Khai model mới kèm danh sách phụ kiện (NV-03).
   *
   * Phụ kiện khai ngay tại đây chứ không để sau: biên bản bàn giao đối chiếu theo bảng này,
   * model không có phụ kiện nào thì lúc nhận lại không ai biết đáng lẽ phải trả về những gì.
   */
  async createModel(dto: CreateModelDto) {
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

  /**
   * Chi tiết một máy tra theo MÃ chứ không theo id (MH-03).
   *
   * Mã là thứ dán trên thân máy và in trong QR, nên đường dẫn tra theo mã thì thủ kho quét xong
   * là ra thẳng trang. Bắt họ tra id sinh tự động là bắt qua một bước tìm kiếm thừa.
   */
  async assetDetail(assetCode: string) {
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: assetCode.toUpperCase() },
      include: {
        model: { include: { category: true, accessories: { orderBy: { sort_order: 'asc' } } } },
        location: true,
      },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);

    const events = await this.prisma.memsAssetEvent.findMany({
      where: { asset_id: asset.id },
      orderBy: { occurred_at: 'desc' },
      take: 50,
    });

    // Phiếu đặt kế tiếp suy ra từ bảng giữ chỗ, KHÔNG phải một giá trị của cột trạng thái (QĐ-03).
    const nextReservation = await this.prisma.memsReservation.findFirst({
      where: {
        asset_id: asset.id,
        status: { in: ['TENTATIVE', 'CONFIRMED'] as any },
        buffer_to_time: { gt: new Date() },
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
      include: { model: { include: { category: true } }, location: true },
      orderBy: { asset_code: 'asc' },
    });
  }
}

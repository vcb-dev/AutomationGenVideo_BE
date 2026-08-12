import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAssetDto, CreateCategoryDto } from './dto';

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

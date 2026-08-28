import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateAssetDto,
  CreateCategoryDto,
  CreateLocationDto,
  CreateModelDto,
  UpdateAssetDto,
  UpdateLocationDto,
} from './dto';
import { manualStatusBlockReason } from './asset-status-rules';

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
   * Sửa thông tin một máy đã trong kho.
   *
   * Mã thiết bị và mã QR KHÔNG nằm trong danh sách sửa được (BR-04): hai thứ đó dán trên thân
   * máy, đổi trong hệ thống thì cái nhãn ngoài đời thành nói dối.
   *
   * Trường bỏ trống giữ nguyên giá trị cũ. Riêng `locationId` phân biệt hai chuyện khác hẳn
   * nhau: bỏ trống hẳn là "không đụng tới chỗ cũ", còn chuỗi rỗng từ ô chọn "chưa xếp chỗ" là
   * cố ý gỡ máy ra khỏi vị trí.
   */
  async updateAsset(assetCode: string, dto: UpdateAssetDto) {
    const code = assetCode.toUpperCase();
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: code },
      include: { model: { include: { category: true } }, location: true },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);

    // Sửa tay chỉ được siết, không được nới — xem `asset-status-rules.ts`. Chặn ở đây chứ không
    // chỉ ở DTO: DTO không biết máy đang ở trạng thái nào nên không ra được luật "đang mượn thì
    // chỉ đánh dấu Mất".
    if (dto.status) {
      const blocked = manualStatusBlockReason(asset.status, dto.status);
      if (blocked) throw new ConflictException(blocked);
    }

    // BR-04: serial vẫn phải duy nhất sau khi sửa. So với chính mình thì bỏ qua, nếu không thì
    // gửi kèm serial cũ — chuyện thường của form — sẽ tự chặn chính mình.
    if (dto.serialNumber && dto.serialNumber !== asset.serial_number) {
      const duplicated = await this.prisma.memsAsset.findUnique({
        where: { serial_number: dto.serialNumber },
        select: { id: true, asset_code: true },
      });
      if (duplicated && duplicated.id !== asset.id) {
        throw new ConflictException(
          `Số serial ${dto.serialNumber} đã thuộc thiết bị ${duplicated.asset_code}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.memsAsset.update({
        where: { id: asset.id },
        data: {
          model_id: dto.modelId ?? asset.model_id,
          serial_number: dto.serialNumber ?? asset.serial_number,
          location_id: dto.locationId === undefined ? asset.location_id : dto.locationId || null,
          purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : asset.purchase_date,
          purchase_price: dto.purchasePrice ?? asset.purchase_price,
          condition: (dto.condition as any) ?? asset.condition,
          status: (dto.status as any) ?? asset.status,
        },
        include: {
          model: { include: { category: true } },
          location: true,
          photos: { where: { is_primary: true }, take: 1 },
        },
      });

      await tx.memsAssetEvent.create({
        data: {
          asset_id: asset.id,
          kind: 'CONDITION_CHANGED',
          title: 'Cập nhật thông tin',
          detail:
            [
              dto.condition && dto.condition !== asset.condition
                ? `tình trạng ${asset.condition} → ${dto.condition}`
                : null,
              dto.status && dto.status !== asset.status
                ? `trạng thái ${asset.status} → ${dto.status}`
                : null,
              dto.note?.trim() || null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Chỉnh sửa thông số/vị trí',
        },
      });

      return updated;
    });
  }

  /**
   * Ngừng dùng một máy (NV-01 chiều ngược).
   *
   * Xoá MỀM, không xoá cứng: mọi biên bản bàn giao, sự cố và mốc nhật ký cũ đều neo vào máy
   * này. Xoá cứng thì báo cáo tài sản của các kỳ trước thủng lỗ mà không ai giải thích được.
   *
   * Chặn khi máy đang mượn hoặc còn lịch giữ chỗ: máy nằm trên kệ hôm nay nhưng đã hứa cho
   * phiếu tuần sau, xoá đi thì tới ngày đó kho thiếu một chiếc mà không ai biết vì sao.
   */
  async deleteAsset(assetCode: string) {
    const code = assetCode.toUpperCase();
    const asset = await this.prisma.memsAsset.findUnique({
      where: { asset_code: code },
      include: {
        reservations: { where: { status: { in: ['TENTATIVE', 'CONFIRMED'] as any } } },
        handoverLines: { where: { handover: { request: { status: 'ON_LOAN' } } } },
      },
    });
    if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);

    if (
      asset.status === 'ON_LOAN' ||
      asset.reservations.length > 0 ||
      asset.handoverLines.length > 0
    ) {
      throw new ConflictException(
        `Thiết bị ${code} đang được mượn hoặc còn lịch giữ chỗ, chưa xoá được`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.memsAsset.update({
        where: { id: asset.id },
        data: { is_disabled: true, status: 'DISPOSED' },
      });

      await tx.memsAssetEvent.create({
        data: {
          asset_id: asset.id,
          kind: 'CONDITION_CHANGED',
          title: 'Xóa khỏi kho',
          detail: 'Ngừng sử dụng thiết bị và chuyển trạng thái thanh lý',
        },
      });

      return { success: true, message: `Đã xoá thiết bị ${code} khỏi kho.` };
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

  /**
   * Kèm số máy đang nằm ở mỗi vị trí. Con số này nói TRƯỚC vì sao nút xoá sẽ bị chặn, thay vì
   * để người dùng bấm rồi mới ăn 409 và phải tự đoán vị trí nào còn hàng.
   */
  listLocations() {
    return this.prisma.memsLocation.findMany({
      where: { is_disabled: false },
      include: { _count: { select: { assets: { where: { is_disabled: false } } } } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Tên vị trí đã có ai dùng chưa, trong cùng một vị trí cha.
   *
   * Schema KHÔNG có ràng buộc duy nhất cho tên vị trí, mà dropdown thì chỉ hiện tên — hai dòng
   * "Kệ A-02" thì thủ kho chọn cái nào cũng như nhau, và một nửa số máy nằm ở vị trí không ai
   * dùng tới. So không phân biệt hoa thường vì người gõ "kệ a-02" chỉ đang gõ vội.
   *
   * `exceptId` để lúc đổi tên, vị trí không tự chặn chính nó.
   */
  private async findLocationByName(name: string, parentId: string | null, exceptId?: string) {
    return this.prisma.memsLocation.findFirst({
      where: {
        is_disabled: false,
        parent_id: parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, name: true },
    });
  }

  async createLocation(dto: CreateLocationDto) {
    const name = dto.name.trim();
    const parentId = dto.parentId ?? null;

    const duplicated = await this.findLocationByName(name, parentId);
    if (duplicated) {
      throw new ConflictException(`Đã có vị trí tên ${duplicated.name} ở cùng chỗ này`);
    }

    return this.prisma.memsLocation.create({ data: { name, parent_id: parentId } });
  }

  /**
   * Đổi tên vị trí, hoặc chuyển nó sang một vị trí cha khác.
   *
   * Bỏ trống `parentId` là GIỮ NGUYÊN cha cũ, không phải gỡ khỏi cây: form đổi tên không gửi
   * kèm cha, hiểu nhầm chỗ này thì cả nhánh con bật lên gốc chỉ vì ai đó sửa một chữ.
   */
  async updateLocation(id: string, dto: UpdateLocationDto) {
    const location = await this.prisma.memsLocation.findUnique({ where: { id } });
    if (!location) throw new NotFoundException('Không có vị trí kho này');

    const name = dto.name.trim();
    const parentId = dto.parentId === undefined ? location.parent_id : dto.parentId || null;

    const duplicated = await this.findLocationByName(name, parentId, id);
    if (duplicated) {
      throw new ConflictException(`Đã có vị trí tên ${duplicated.name} ở cùng chỗ này`);
    }

    return this.prisma.memsLocation.update({
      where: { id },
      data: { name, parent_id: parentId },
    });
  }

  /**
   * Ngừng dùng một vị trí. Xoá MỀM — xoá cứng thì mọi bản ghi cũ từng trỏ vào đây trỏ vào
   * khoảng không.
   *
   * Chặn khi còn chứa máy: xoá kèm thì những chiếc đó vẫn trong kho nhưng không tra ra đang
   * nằm đâu, và người đi tìm sẽ lục cả kho.
   */
  async deleteLocation(id: string) {
    const location = await this.prisma.memsLocation.findUnique({
      where: { id },
      include: { assets: { where: { is_disabled: false } } },
    });
    if (!location) throw new NotFoundException('Không có vị trí kho này');

    if (location.assets.length > 0) {
      throw new ConflictException(
        `Vị trí này còn ${location.assets.length} thiết bị. Chuyển chúng sang chỗ khác rồi mới xoá được.`,
      );
    }

    return this.prisma.memsLocation.update({
      where: { id },
      data: { is_disabled: true },
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
        photos: { orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }] },
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

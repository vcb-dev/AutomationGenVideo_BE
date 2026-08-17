import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InspectAssetDto } from './dto';

/**
 * Chỉ máy đang nằm ở bàn kiểm tra mới có gì để kết luận. Máy đang mượn hay đã sẵn sàng thì
 * không — đổi trạng thái chúng từ đây là đi vòng qua nghiệp vụ bàn giao và tiếp nhận trả.
 */
const INSPECTABLE_STATUSES = ['PENDING_INSPECTION', 'POST_RETURN_CHECK'];

@Injectable()
export class InspectionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Những máy đang chờ người kiểm tra kết luận — màn kiểm tra dựng danh sách từ đây. */
  listPending() {
    return this.prisma.memsAsset.findMany({
      where: { is_disabled: false, status: { in: INSPECTABLE_STATUSES as any } },
      include: {
        model: { include: { category: true } },
        location: true,
        returnLines: {
          take: 1,
          orderBy: { returnRecord: { returned_at: 'desc' } },
          include: { returnRecord: true, incidents: true },
        },
      },
      orderBy: { asset_code: 'asc' },
    });
  }

  /**
   * NV-14: kết luận kiểm tra, đưa máy ra khỏi bàn nhận.
   *
   * Đây là mắt xích duy nhất đưa một chiếc máy trở lại `AVAILABLE`. Thiếu nó thì máy vừa nhập
   * kho và máy trả về bị trầy đều nằm lại vĩnh viễn ở bàn kiểm tra — kho cứ hao dần mà không
   * ai thấy máy biến đi đâu.
   *
   * Kết luận Bảo trì sinh luôn một lệnh bảo trì, vì phép tính khả dụng đọc bảng đó chứ không
   * đọc cột trạng thái: chỉ đổi trạng thái thì máy vẫn hiện là rảnh trong mọi khoảng tương lai.
   */
  async inspect(assetCode: string, inspectorId: string, dto: InspectAssetDto) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.memsAsset.findUnique({
        where: { asset_code: assetCode.toUpperCase() },
      });
      if (!asset) throw new NotFoundException(`Không có thiết bị mã ${assetCode}`);
      if (!INSPECTABLE_STATUSES.includes(asset.status)) {
        throw new ConflictException(
          `Máy ${asset.asset_code} đang ở trạng thái ${asset.status}, không phải đang chờ kiểm tra`,
        );
      }

      const condition = dto.condition ?? asset.condition;

      if (dto.result === 'UNDER_MAINTENANCE') {
        await tx.memsMaintenance.create({
          data: {
            asset_id: asset.id,
            reason: dto.note?.trim() || 'Kết luận sau kiểm tra',
            from_time: new Date(),
            // Bỏ trống điểm kết thúc: lệnh còn mở thì hàm khả dụng coi máy bận vô hạn về sau,
            // đúng hơn là đoán bừa một ngày trả xưởng rồi tới hạn máy tự "rảnh" trong khi vẫn ở xưởng.
            to_time: null,
          },
        });
      }

      const updated = await tx.memsAsset.update({
        where: { id: asset.id },
        data: { status: dto.result as any, condition: condition as any },
      });

      await tx.memsAssetEvent.create({
        data: {
          asset_id: asset.id,
          kind: 'INSPECTED',
          title: `Kết luận kiểm tra: ${dto.result}`,
          detail: [
            `${asset.status} → ${dto.result}`,
            condition !== asset.condition ? `tình trạng ${asset.condition} → ${condition}` : null,
            dto.note?.trim() || null,
          ]
            .filter(Boolean)
            .join(' · '),
          actor_id: inspectorId,
        },
      });

      return updated;
    });
  }
}

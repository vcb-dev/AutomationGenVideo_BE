import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateHandoverDto } from './dto';

@Injectable()
export class HandoverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Biên bản đã ghim máy nào, tình trạng ra sao — màn bàn giao dựng form từ đây. */
  async prepareSheet(requestId: string) {
    const request = await this.prisma.memsBorrowRequest.findUnique({
      where: { id: requestId },
      include: {
        lines: {
          include: {
            model: { include: { accessories: { orderBy: { sort_order: 'asc' } } } },
            reservations: { include: { asset: { include: { location: true } } } },
          },
        },
      },
    });
    if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

    const units = request.lines.flatMap((line) =>
      line.reservations
        .filter((r) => r.asset)
        .map((r) => ({
          asset: r.asset,
          model: { id: line.model.id, name: line.model.name },
          accessories: line.model.accessories,
        })),
    );
    return { request, units };
  }

  /**
   * BR-26 và BR-27: lập biên bản bàn giao.
   *
   * Ảnh là điều kiện cứng — không ảnh thì không có căn cứ quy trách nhiệm lúc nhận lại, và mọi
   * tranh cãi về vết xước sẽ thành lời khai đối lời khai. Phụ kiện thiếu thì CHO QUA nhưng ghi
   * lại: chặn cứng sẽ khiến người ta tick bừa cho xong, mất luôn giá trị của việc đối chiếu.
   */
  async create(requestId: string, handedById: string, dto: CreateHandoverDto) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: { include: { reservations: true } } },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (request.status !== 'PREPARING') {
        throw new ConflictException(
          `Phiếu ${request.request_code} đang ở trạng thái ${request.status}, chưa bàn giao được`,
        );
      }
      if (dto.units.length === 0) {
        throw new BadRequestException('Biên bản bàn giao phải có ít nhất một máy');
      }

      const withoutPhoto = dto.units.filter((u) => (u.photoKeys?.length ?? 0) === 0);
      if (withoutPhoto.length > 0) {
        throw new BadRequestException(
          `Chưa có ảnh tình trạng cho ${withoutPhoto.length} máy, chưa bàn giao được`,
        );
      }

      const pinnedAssetIds = new Set(
        request.lines.flatMap((l) => l.reservations.map((r) => r.asset_id).filter(Boolean)),
      );
      for (const unit of dto.units) {
        if (!pinnedAssetIds.has(unit.assetId)) {
          throw new BadRequestException(
            `Máy ${unit.assetId} chưa được gán cho phiếu này, không có trong biên bản`,
          );
        }
      }

      const handover = await tx.memsHandover.create({
        data: {
          request_id: requestId,
          handed_by: handedById,
          received_by: dto.receivedBy,
          note: dto.note ?? null,
        },
      });

      for (const unit of dto.units) {
        const line = await tx.memsHandoverLine.create({
          data: {
            handover_id: handover.id,
            asset_id: unit.assetId,
            condition: unit.condition as any,
            note: unit.note ?? null,
          },
        });

        await tx.memsHandoverPhoto.createMany({
          data: unit.photoKeys.map((key) => ({
            handover_line_id: line.id,
            storage_key: key,
          })),
        });

        if (unit.accessories?.length) {
          await tx.memsHandoverAccessory.createMany({
            data: unit.accessories.map((a) => ({
              handover_line_id: line.id,
              accessory_id: a.accessoryId,
              is_present: a.isPresent,
            })),
          });
        }

        // Tình trạng ghi trong biên bản là tình trạng thật tại thời điểm giao, đè lên hồ sơ máy.
        await tx.memsAsset.update({
          where: { id: unit.assetId },
          data: { status: 'ON_LOAN', condition: unit.condition as any },
        });

        await tx.memsAssetEvent.create({
          data: {
            asset_id: unit.assetId,
            kind: 'HANDED_OVER',
            title: `Bàn giao cho ${dto.receivedBy}`,
            detail: `Phiếu ${request.request_code} · tình trạng khi giao ${unit.condition} · ${unit.photoKeys.length} ảnh`,
            actor_id: handedById,
            request_id: requestId,
          },
        });
      }

      await tx.memsRequestLine.updateMany({
        where: { request_id: requestId },
        data: { status: 'ON_LOAN' },
      });
      await tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { status: 'ON_LOAN' },
      });

      return tx.memsHandover.findUniqueOrThrow({
        where: { id: handover.id },
        include: { lines: { include: { photos: true, accessories: true } } },
      });
    });
  }
}

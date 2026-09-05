import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateReturnDto } from './dto';
import { assertPhotoEvidence } from './photo-evidence';
import { conditionWorsened, resolveReturnStatus } from './return-rules';

@Injectable()
export class ReturnService {
  constructor(private readonly prisma: PrismaService) {}

  /** Những máy của phiếu còn đang ở ngoài, kèm tình trạng lúc giao để màn trả đối chiếu. */
  async pendingUnits(requestId: string) {
    const request = await this.prisma.memsBorrowRequest.findUnique({
      where: { id: requestId },
      include: {
        handovers: {
          include: {
            lines: {
              include: {
                asset: { include: { model: { include: { accessories: true } } } },
                photos: true,
                accessories: true,
                returnLines: true,
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);

    const units = request.handovers
      .flatMap((h) => h.lines)
      // Máy đã có dòng trả rồi thì không hiện lại — trả một phần gọi endpoint này nhiều lần.
      .filter((line) => line.returnLines.length === 0);

    return { request, units };
  }

  /**
   * BR-42: tiếp nhận máy trả về.
   *
   * Máy tệ đi so với lúc giao, hoặc thiếu phụ kiện, thì KHÔNG về thẳng Sẵn sàng mà đi
   * Kiểm tra sau trả. Cho về kệ ngay là người mượn kế tiếp lãnh hậu quả, và tới lúc đó thì
   * không còn ai truy được lần nào làm hỏng.
   *
   * Trả từng phần là bình thường chứ không phải lỗi: người mượn hay mang về trước những máy
   * dùng xong. Phiếu chỉ đóng khi máy cuối cùng về tới kho.
   */
  async create(requestId: string, receivedById: string, dto: CreateReturnDto) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { handovers: { include: { lines: { include: { returnLines: true } } } } },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (!['ON_LOAN', 'PARTIALLY_RETURNED'].includes(request.status)) {
        throw new ConflictException(
          `Phiếu ${request.request_code} đang ở trạng thái ${request.status}, không nhận trả được`,
        );
      }
      if (dto.units.length === 0) {
        throw new BadRequestException('Phải chọn ít nhất một máy để nhận lại');
      }

      const withoutPhoto = dto.units.filter((u) => (u.photoKeys?.length ?? 0) === 0);
      if (withoutPhoto.length > 0) {
        throw new BadRequestException(
          `Chưa có ảnh khi trả cho ${withoutPhoto.length} máy, chưa nhận lại được`,
        );
      }

      const handoverLines = request.handovers.flatMap((h) => h.lines);
      // Kiểm trọn vẹn TRƯỚC khi ghi bất cứ thứ gì. Trước đây bản ghi biên bản ra đời trước rồi
      // mới xét từng máy, nên mọi lỗi giữa chừng đều phải trông vào việc giao dịch cuộn lại —
      // đúng thì đúng, nhưng nó giấu mất thứ tự ưu tiên giữa các lỗi và làm test khó nói rõ
      // "chưa ghi gì cả".
      const lineByAssetId = new Map<string, (typeof handoverLines)[number]>();
      for (const unit of dto.units) {
        const handoverLine = handoverLines.find((l) => l.asset_id === unit.assetId);
        if (!handoverLine) {
          throw new BadRequestException(
            `Máy ${unit.assetId} không nằm trong biên bản bàn giao của phiếu này`,
          );
        }
        if (handoverLine.returnLines.length > 0) {
          throw new ConflictException(`Máy ${unit.assetId} đã được nhận lại trước đó`);
        }
        lineByAssetId.set(unit.assetId, handoverLine);
      }

      // Ảnh lúc trả là mốc đối chiếu sinh ra bản ghi sự cố, nên phải là ảnh có thật của đúng
      // chiếc máy đó — đếm độ dài `photoKeys` không nói lên điều gì vì chuỗi đó do client gửi.
      await assertPhotoEvidence(tx, dto.units);

      const returnRecord = await tx.memsReturn.create({
        data: {
          request_id: requestId,
          received_by: receivedById,
          note: dto.note ?? null,
        },
      });

      for (const unit of dto.units) {
        const handoverLine = lineByAssetId.get(unit.assetId)!;

        const missingAccessories = (unit.accessories ?? []).filter((a) => !a.isPresent);
        const worsened = conditionWorsened(handoverLine.condition, unit.condition);
        const resultingStatus = resolveReturnStatus({
          conditionBefore: handoverLine.condition,
          conditionAfter: unit.condition,
          missingAccessoryCount: missingAccessories.length,
        });

        const returnLine = await tx.memsReturnLine.create({
          data: {
            return_id: returnRecord.id,
            asset_id: unit.assetId,
            handover_line_id: handoverLine.id,
            condition_before: handoverLine.condition,
            condition_after: unit.condition as any,
            resulting_status: resultingStatus as any,
            note: unit.note ?? null,
          },
        });

        await tx.memsReturnPhoto.createMany({
          data: unit.photoKeys.map((key) => ({
            return_line_id: returnLine.id,
            storage_key: key,
          })),
        });

        if (unit.accessories?.length) {
          await tx.memsReturnAccessory.createMany({
            data: unit.accessories.map((a) => ({
              return_line_id: returnLine.id,
              accessory_id: a.accessoryId,
              is_present: a.isPresent,
            })),
          });
        }

        await tx.memsAsset.update({
          where: { id: unit.assetId },
          data: { status: resultingStatus as any, condition: unit.condition as any },
        });

        // Giữ chỗ phải nhả ngay khi máy về, nếu không khoảng thời gian còn lại của phiếu vẫn
        // hiện là bận và không ai xin mượn được chiếc máy đang nằm trên kệ.
        await tx.memsReservation.updateMany({
          where: { asset_id: unit.assetId, request_line: { request_id: requestId } },
          data: { status: 'RELEASED' },
        });

        if (worsened) {
          await tx.memsIncident.create({
            data: {
              asset_id: unit.assetId,
              request_id: requestId,
              return_line_id: returnLine.id,
              responsible_id: request.owner_id,
              kind: 'CONDITION_WORSENED',
              description: `Tình trạng ${handoverLine.condition} → ${unit.condition} sau phiếu ${request.request_code}`,
            },
          });
        }
        if (missingAccessories.length > 0) {
          await tx.memsIncident.create({
            data: {
              asset_id: unit.assetId,
              request_id: requestId,
              return_line_id: returnLine.id,
              responsible_id: request.owner_id,
              kind: 'MISSING_ACCESSORY',
              description: `Thiếu ${missingAccessories.length} phụ kiện khi trả phiếu ${request.request_code}`,
            },
          });
        }

        await tx.memsAssetEvent.create({
          data: {
            asset_id: unit.assetId,
            kind: 'RETURNED',
            title: 'Nhận lại thiết bị',
            detail: `Phiếu ${request.request_code} · tình trạng ${handoverLine.condition} → ${unit.condition} · chuyển sang ${resultingStatus}`,
            actor_id: receivedById,
            request_id: requestId,
          },
        });
      }

      const stillOut = handoverLines.filter(
        (l) => l.returnLines.length === 0 && !dto.units.some((u) => u.assetId === l.asset_id),
      ).length;

      await tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { status: stillOut === 0 ? 'CLOSED' : 'PARTIALLY_RETURNED' },
      });

      return tx.memsReturn.findUniqueOrThrow({
        where: { id: returnRecord.id },
        include: { lines: { include: { photos: true, accessories: true, incidents: true } } },
      });
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { AssignSerialsDto } from './dto';

/** Tình trạng còn đem giao cho người mượn được. Máy ngoài hai mức này phải qua kiểm tra trước. */
const ASSIGNABLE_CONDITIONS = ['GOOD', 'USED'];

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * BR-25: danh sách máy được phép gán cho một dòng phiếu.
   *
   * Lọc hai tầng: rảnh trong khoảng của phiếu, VÀ tình trạng còn đạt. Bỏ tầng thứ hai thì kho
   * sẽ gán nhầm chiếc đang chờ kiểm tra — nó rảnh lịch nhưng chưa ai xác nhận nó dùng được.
   *
   * Xếp máy tình trạng tốt lên trước, sau đó tới máy ít vòng quay nhất, để kho không phải tự cân.
   */
  async assignableUnits(lineId: string) {
    const line = await this.prisma.memsRequestLine.findUnique({
      where: { id: lineId },
      include: { request: true },
    });
    if (!line) throw new NotFoundException(`Không có dòng phiếu ${lineId}`);

    const free = await this.availability.freeAssets({
      modelId: line.model_id,
      fromTime: line.request.from_time,
      toTime: line.request.to_time,
    });

    const usable = free.filter((a) => ASSIGNABLE_CONDITIONS.includes(a.condition));
    const loanCounts = await this.prisma.memsHandoverLine.groupBy({
      by: ['asset_id'],
      where: { asset_id: { in: usable.map((a) => a.id) } },
      _count: { asset_id: true },
    });
    const timesLoaned = new Map(loanCounts.map((c) => [c.asset_id, c._count.asset_id]));

    return usable.sort(
      (a, b) =>
        ASSIGNABLE_CONDITIONS.indexOf(a.condition) - ASSIGNABLE_CONDITIONS.indexOf(b.condition) ||
        (timesLoaned.get(a.id) ?? 0) - (timesLoaned.get(b.id) ?? 0) ||
        a.asset_code.localeCompare(b.asset_code),
    );
  }

  /**
   * Ghim máy cụ thể vào phiếu đã duyệt (QĐ-01).
   *
   * Toàn bộ nằm trong một giao dịch có khoá theo model: hai thủ kho cùng chuẩn bị hai phiếu
   * dùng chung một model sẽ cùng đọc thấy chiếc cuối là rảnh nếu không khoá.
   */
  async assign(requestId: string, dto: AssignSerialsDto) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: { include: { reservations: true } } },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (!['APPROVED', 'PREPARING'].includes(request.status)) {
        throw new ConflictException(
          `Phiếu ${request.request_code} đang ở trạng thái ${request.status}, chưa tới bước gán serial`,
        );
      }

      // Một máy chỉ được gán cho một dòng trong cùng phiếu — trùng là kho đếm thừa lúc soạn hàng.
      const assetIds = dto.lines.flatMap((l) => l.assetIds);
      if (new Set(assetIds).size !== assetIds.length) {
        throw new BadRequestException('Một máy được gán cho nhiều dòng trong cùng phiếu');
      }

      for (const input of dto.lines) {
        const line = request.lines.find((l) => l.id === input.lineId);
        if (!line) throw new BadRequestException(`Dòng ${input.lineId} không thuộc phiếu này`);
        if (input.assetIds.length !== line.quantity) {
          throw new BadRequestException(
            `Dòng cần ${line.quantity} máy nhưng gán ${input.assetIds.length}`,
          );
        }

        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `mems:model:${line.model_id}`,
        );

        const assets = await tx.memsAsset.findMany({ where: { id: { in: input.assetIds } } });
        for (const asset of assets) {
          if (asset.model_id !== line.model_id) {
            throw new BadRequestException(
              `Máy ${asset.asset_code} không thuộc model của dòng phiếu`,
            );
          }
          if (!ASSIGNABLE_CONDITIONS.includes(asset.condition)) {
            throw new BadRequestException(
              `Máy ${asset.asset_code} đang ở tình trạng ${asset.condition}, chưa giao được`,
            );
          }
        }

        // Giữ chỗ của dòng này đã có sẵn từ lúc tạo phiếu, giờ chỉ ghim máy vào từng bản ghi.
        const reservations = line.reservations.filter((r) => r.status !== 'RELEASED');
        if (reservations.length < input.assetIds.length) {
          throw new ConflictException('Số bản ghi giữ chỗ ít hơn số máy muốn gán');
        }
        for (const [index, assetId] of input.assetIds.entries()) {
          await tx.memsReservation.update({
            where: { id: reservations[index].id },
            data: { asset_id: assetId, status: 'CONFIRMED' },
          });
        }
        await tx.memsRequestLine.update({
          where: { id: line.id },
          data: { status: 'ALLOCATED' },
        });
      }

      return tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { status: 'PREPARING' },
      });
    });
  }
}

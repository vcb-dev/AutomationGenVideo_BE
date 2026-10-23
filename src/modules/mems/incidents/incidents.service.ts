import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isMediaLeaderOrAdminUser } from '../../../common/guards/mems-media-leader.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { attachRequestPhotos } from '../../../utils/mems/request-photos.util';
import { HOLDING_STATUSES } from '../../../utils/mems/return-alerts.util';
import { RequestViewer } from '../approvals/approval.service';
import { ReportIncidentDto } from './dto/incident.dto';

@Injectable()
export class MemsIncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chủ phiếu hoặc quản lý kho báo hỏng/thiếu phụ kiện cho một máy đang nằm ngoài kho của phiếu. */
  async report(requestId: string, actor: RequestViewer, dto: ReportIncidentDto) {
    const description = dto.description.trim();
    if (!description) throw new BadRequestException('Phải mô tả sự cố');

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.memsBorrowRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (request.owner_id !== actor.id && !isMediaLeaderOrAdminUser(actor)) {
        throw new ForbiddenException('Phiếu này không thuộc về bạn');
      }
      if (!HOLDING_STATUSES.includes(request.status)) {
        throw new ConflictException(`Phiếu ${request.request_code} không ở trạng thái đang mượn, không báo sự cố được`);
      }

      const handedOver = await tx.memsHandoverLine.findFirst({
        where: { asset_id: dto.assetId, handover: { request_id: requestId }, returnLines: { none: {} } },
        include: { asset: { select: { asset_code: true } } },
      });
      if (!handedOver) throw new BadRequestException('Máy này không nằm trong số máy đang mượn của phiếu');

      const incident = await tx.memsIncident.create({
        data: {
          asset_id: dto.assetId,
          request_id: requestId,
          responsible_id: request.owner_id,
          reported_by: actor.id,
          kind: dto.kind,
          description,
          status: 'OPEN',
        },
      });
      if (dto.photoIds?.length) {
        await attachRequestPhotos(tx, { requestId, uploaderId: actor.id, photoIds: dto.photoIds, incidentId: incident.id });
      }
      await tx.memsAssetEvent.create({
        data: {
          asset_id: dto.assetId,
          kind: 'INCIDENT',
          title: `Báo sự cố khi đang mượn: ${handedOver.asset.asset_code}`,
          detail: description,
          actor_id: actor.id,
          request_id: requestId,
        },
      });
      return incident;
    });
  }
}

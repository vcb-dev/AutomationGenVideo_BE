import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isMediaLeaderOrAdminUser } from '../../../common/guards/mems-media-leader.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HOLDING_STATUSES } from '../../../utils/mems/return-alerts.util';
import { RequestViewer } from '../approvals/approvals.service';
import { AvailabilityService } from '../availability/availability.service';
import { DecideExtensionDto, RequestExtensionDto } from './dto/loan-extension.dto';

interface HeldRequest {
  id: string;
  to_time: Date;
  lines: { id: string; model_id: string; model: { name: string }; reservations: { status: string }[] }[];
}

@Injectable()
export class LoanExtensionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  /** Chủ phiếu (hoặc quản lý kho) xin dời hạn trả của phiếu đang mượn. */
  async request(requestId: string, actor: RequestViewer, dto: RequestExtensionDto) {
    const newToTime = new Date(dto.toTime);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Phải nêu lý do xin gia hạn');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `mems:request:${requestId}`);

      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: { include: { model: true, reservations: true } } },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (request.owner_id !== actor.id && !isMediaLeaderOrAdminUser(actor)) {
        throw new ForbiddenException('Phiếu này không thuộc về bạn');
      }
      if (!HOLDING_STATUSES.includes(request.status)) {
        throw new ConflictException(`Phiếu ${request.request_code} không ở trạng thái đang mượn, không gia hạn được`);
      }
      if (newToTime.getTime() <= request.to_time.getTime()) {
        throw new BadRequestException('Hạn trả mới phải sau hạn trả hiện tại');
      }
      const pending = await tx.memsLoanExtension.findFirst({ where: { request_id: requestId, status: 'PENDING' } });
      if (pending) throw new ConflictException('Phiếu đang có một yêu cầu gia hạn chờ duyệt');

      await this.assertFreeUntil(tx, request, newToTime);

      return tx.memsLoanExtension.create({
        data: { request_id: requestId, requested_to_time: newToTime, reason, requested_by: actor.id },
      });
    });
  }

  /** Quản lý kho duyệt thì dời hạn trả và giữ chỗ; từ chối phải nêu lý do. */
  async decide(requestId: string, actor: RequestViewer, dto: DecideExtensionDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `mems:request:${requestId}`);

      const extension = await tx.memsLoanExtension.findFirst({
        where: { request_id: requestId, status: 'PENDING' },
        orderBy: { requested_at: 'desc' },
      });
      if (!extension) throw new ConflictException('Phiếu không có yêu cầu gia hạn nào đang chờ duyệt');
      const decided = { decided_by: actor.id, decided_at: new Date() };

      if (dto.decision === 'REJECTED') {
        const reason = dto.reason?.trim();
        if (!reason) throw new BadRequestException('Phải nhập lý do khi từ chối gia hạn');
        return tx.memsLoanExtension.update({
          where: { id: extension.id },
          data: { ...decided, status: 'REJECTED', rejection_reason: reason },
        });
      }

      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: { include: { model: true, reservations: true } } },
      });
      if (!request || !HOLDING_STATUSES.includes(request.status)) {
        throw new ConflictException('Phiếu không còn ở trạng thái đang mượn, không gia hạn được');
      }

      // Kiểm lại lúc duyệt: từ lúc xin tới giờ có thể đã có phiếu khác đặt chỗ
      const bufferedToByLine = await this.assertFreeUntil(tx, request, extension.requested_to_time);
      for (const [lineId, bufferedTo] of bufferedToByLine) {
        await tx.memsReservation.updateMany({
          where: { request_line_id: lineId, status: { in: ['TENTATIVE', 'CONFIRMED'] } },
          data: { to_time: extension.requested_to_time, buffer_to_time: bufferedTo },
        });
      }
      await tx.memsBorrowRequest.update({ where: { id: requestId }, data: { to_time: extension.requested_to_time } });
      return tx.memsLoanExtension.update({ where: { id: extension.id }, data: { ...decided, status: 'APPROVED' } });
    });
  }

  /** Kho phải còn đủ máy cho khoảng dời thêm; trả về mốc hết buffer mới của từng dòng. */
  private async assertFreeUntil(
    tx: Prisma.TransactionClient,
    request: HeldRequest,
    newToTime: Date,
  ): Promise<Map<string, Date>> {
    const modelIds = [...new Set(request.lines.map((l) => l.model_id))].sort();
    for (const modelId of modelIds) {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `mems:model:${modelId}`);
    }

    const bufferedToByLine = new Map<string, Date>();
    for (const line of request.lines) {
      const stillOut = line.reservations.filter((r) => r.status !== 'RELEASED').length;
      if (stillOut === 0) continue;
      const check = await this.availability.check(
        { modelId: line.model_id, fromTime: request.to_time, toTime: newToTime, quantity: stillOut, excludeRequestId: request.id },
        tx,
      );
      if (!check.enough) {
        throw new ConflictException(`Không gia hạn được: ${line.model.name} đã có phiếu khác đặt trong khoảng thời gian này`);
      }
      bufferedToByLine.set(line.id, check.bufferedTo);
    }
    return bufferedToByLine;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AvailabilityService } from './availability.service';
import { CreateBorrowRequestDto } from './dto';

@Injectable()
export class BorrowRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  async create(ownerId: string, dto: CreateBorrowRequestDto) {
    const fromTime = new Date(dto.fromTime);
    const toTime = new Date(dto.toTime);
    if (toTime.getTime() <= fromTime.getTime()) {
      throw new BadRequestException('Thời điểm trả phải sau thời điểm nhận');
    }

    return this.prisma.$transaction(async (tx) => {
      // BR-13: kiểm tra khả dụng rồi ghi giữ chỗ phải nằm trong CÙNG một giao dịch có khoá.
      // Không có khoá thì hai người cùng xin chiếc máy cuối cùng sẽ cùng đọc "còn 1" rồi cùng
      // ghi giữ chỗ, và kho chỉ phát hiện thiếu vào đúng lúc bàn giao.
      for (const line of dto.lines) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `mems:model:${line.modelId}`,
        );
      }

      const requestCode = await this.nextRequestCode(tx, fromTime);
      const request = await tx.memsBorrowRequest.create({
        data: {
          request_code: requestCode,
          owner_id: ownerId,
          department_id: dto.departmentId,
          project: dto.project,
          place: dto.place,
          from_time: fromTime,
          to_time: toTime,
          status: 'PENDING_APPROVAL',
        },
      });

      for (const line of dto.lines) {
        const check = await this.availability.check({
          modelId: line.modelId,
          fromTime,
          toTime,
          quantity: line.quantity,
        });

        const created = await tx.memsRequestLine.create({
          data: {
            request_id: request.id,
            model_id: line.modelId,
            quantity: line.quantity,
            note: line.note ?? null,
            // QĐ-08: thiếu thì vẫn nhận phiếu, đánh dấu Chờ hàng thay vì chặn người dùng.
            status: check.enough ? 'RESERVED' : 'BACKORDERED',
          },
        });

        if (!check.enough) continue;

        // Mỗi máy MỘT bản ghi: hàm khả dụng đếm số bản ghi giữ chỗ giao nhau, không đọc số lượng.
        await tx.memsReservation.createMany({
          data: Array.from({ length: line.quantity }, () => ({
            request_line_id: created.id,
            model_id: line.modelId,
            from_time: fromTime,
            to_time: toTime,
            buffer_to_time: check.bufferedTo,
            status: 'TENTATIVE' as const,
          })),
        });
      }

      return request;
    });
  }

  /** Mã phiếu REQ-YYYYMMDD-NNN, số thứ tự đếm theo ngày nhận thiết bị. */
  private async nextRequestCode(tx: any, fromTime: Date): Promise<string> {
    const dayStart = new Date(
      Date.UTC(fromTime.getUTCFullYear(), fromTime.getUTCMonth(), fromTime.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const used = await tx.memsBorrowRequest.count({
      where: { from_time: { gte: dayStart, lt: dayEnd } },
    });
    const ymd = dayStart.toISOString().slice(0, 10).replace(/-/g, '');
    return `REQ-${ymd}-${String(used + 1).padStart(3, '0')}`;
  }
}

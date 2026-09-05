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

  /**
   * Bộ phận của người mượn, suy từ chính người đăng nhập.
   *
   * Client KHÔNG nên tự khai mình thuộc bộ phận nào — khai sai là quy trách nhiệm sai người,
   * và giao diện cũng không có nguồn nào để lấy con số đó.
   *
   * Thứ tự tra, từ chắc chắn nhất tới suy đoán:
   *   1. Bảng thành viên MEMS, nếu ai đó đã gán
   *   2. Trường team trên hồ sơ người dùng, khớp với mã hoặc tên bộ phận
   *   3. Cả hệ thống chỉ có một bộ phận thì dùng luôn nó
   * Hết cả ba thì báo lỗi nói rõ phải làm gì, chứ không đoán bừa một bộ phận.
   */
  private async resolveDepartment(tx: any, ownerId: string, given?: string): Promise<string> {
    if (given) return given;

    const membership = await tx.memsMember.findFirst({
      where: { user_id: ownerId, is_disabled: false },
      select: { department_id: true },
    });
    if (membership) return membership.department_id;

    const user = await tx.user.findUnique({
      where: { id: ownerId },
      select: { team: true },
    });
    if (user?.team) {
      const matched = await tx.memsDepartment.findFirst({
        where: {
          is_disabled: false,
          OR: [
            { code: { equals: user.team, mode: 'insensitive' } },
            { name: { equals: user.team, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (matched) return matched.id;
    }

    const all = await tx.memsDepartment.findMany({ where: { is_disabled: false }, select: { id: true } });
    if (all.length === 1) return all[0].id;

    throw new BadRequestException(
      'Chưa xác định được bộ phận của bạn. Nhờ quản trị gán bạn vào một bộ phận trong MEMS.',
    );
  }

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
      // Khoá theo thứ tự ĐÃ SẮP, không theo thứ tự client gửi. Phiếu A xin [b, a] và phiếu B xin
      // [a, b] cùng lúc thì A giữ b đợi a, B giữ a đợi b — Postgres phát hiện deadlock và giết
      // một giao dịch, người dùng ăn 500 giữa lúc gửi phiếu. Sắp trước thì mọi giao dịch đi cùng
      // một chiều nên chỉ xếp hàng, không bao giờ ôm chéo. Lọc trùng để một model khai hai dòng
      // không xin khoá hai lần.
      const modelIdsToLock = [...new Set(dto.lines.map((line) => line.modelId))].sort();
      for (const modelId of modelIdsToLock) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `mems:model:${modelId}`,
        );
      }

      const departmentId = await this.resolveDepartment(tx, ownerId, dto.departmentId);
      const requestCode = await this.nextRequestCode(tx, fromTime);
      const request = await tx.memsBorrowRequest.create({
        data: {
          request_code: requestCode,
          owner_id: ownerId,
          department_id: departmentId,
          project: dto.project,
          place: dto.place,
          // Client cũ chưa gửi trường này; mặc định việc công ty để phiếu vẫn một cấp duyệt.
          purpose: dto.purpose ?? 'WORK',
          from_time: fromTime,
          to_time: toTime,
          status: 'PENDING_APPROVAL',
        },
      });

      for (const line of dto.lines) {
        // Hỏi bằng chính `tx`: dòng sau phải thấy giữ chỗ mà dòng trước vừa ghi. Đọc bằng
        // `this.prisma` là đọc trên kết nối khác, không thấy bản ghi chưa commit — hai dòng
        // cùng một model sẽ cùng nhận về "còn đủ" và giữ chỗ gấp đôi số máy thực có.
        const check = await this.availability.check(
          {
            modelId: line.modelId,
            fromTime,
            toTime,
            quantity: line.quantity,
          },
          tx,
        );

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

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApproveRequestDto, RejectRequestDto } from './dto';

/** BR-22: ngưỡng đẩy phiếu lên hai cấp duyệt. */
const VALUE_THRESHOLD = 50_000_000;
const HOURS_THRESHOLD = 168;
const INTERNAL_PLACES = ['hà nội', 'văn phòng', 'công ty', 'studio'];

@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * BR-22: phiếu cần mấy cấp duyệt, kèm lý do.
   *
   * Trả cả lý do chứ không chỉ con số vì người duyệt phải giải thích được cho người mượn tại sao
   * phiếu của họ đi lâu hơn phiếu khác. Tính ở BE chứ không để FE tự tính: FE tính thì mỗi màn
   * một kiểu, và người sửa ngưỡng phải nhớ sửa hai nơi.
   */
  requiredLevels(input: {
    totalValue: number;
    fromTime: Date;
    toTime: Date;
    place: string;
  }): { levels: 1 | 2; reasons: string[] } {
    const hours = (input.toTime.getTime() - input.fromTime.getTime()) / 3_600_000;
    const place = input.place.trim().toLowerCase();
    const reasons: string[] = [];

    if (input.totalValue > VALUE_THRESHOLD) reasons.push('giá trị vượt 50 triệu');
    if (hours > HOURS_THRESHOLD) reasons.push('mượn dài hơn 7 ngày');
    // Địa điểm bỏ trống chưa phải là ngoài công ty — người dùng mới chỉ chưa điền.
    if (place !== '' && !INTERNAL_PLACES.includes(place)) reasons.push('sử dụng ngoài công ty');

    return { levels: reasons.length > 0 ? 2 : 1, reasons };
  }

  async list(filter: { status?: string }) {
    const requests = await this.prisma.memsBorrowRequest.findMany({
      where: filter.status ? { status: filter.status as any } : {},
      include: {
        department: true,
        lines: { include: { model: { include: { category: true } } } },
        approvals: { orderBy: { decided_at: 'asc' } },
      },
      orderBy: { created_at: 'desc' },
    });
    return requests.map((r) => this.decorate(r));
  }

  async detail(id: string) {
    const request = await this.prisma.memsBorrowRequest.findUnique({
      where: { id },
      include: {
        department: true,
        lines: {
          include: {
            model: { include: { category: true } },
            reservations: { include: { asset: true } },
          },
        },
        approvals: { orderBy: { decided_at: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException(`Không có phiếu ${id}`);
    return this.decorate(request);
  }

  async approve(requestId: string, approverId: string, dto: ApproveRequestDto) {
    return this.decide(requestId, approverId, 'APPROVED', dto.reason);
  }

  async reject(requestId: string, approverId: string, dto: RejectRequestDto) {
    // BR-20: từ chối phải nêu lý do. Chặn ở đây chứ không chỉ ở DTO vì chuỗi toàn khoảng trắng
    // vẫn lọt qua @IsNotEmpty.
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Phải nhập lý do khi từ chối phiếu');
    }
    return this.decide(requestId, approverId, 'REJECTED', dto.reason.trim());
  }

  /**
   * Ghi một cấp duyệt. Đủ số cấp thì phiếu chuyển sang APPROVED.
   *
   * Từ chối NHẢ GIỮ CHỖ NGAY (BR-32) trong cùng giao dịch: để sang lượt sau thì khoảng thời gian
   * đó vẫn hiện là bận, người khác không xin được chiếc máy thực ra đang rảnh.
   */
  private async decide(
    requestId: string,
    approverId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.memsBorrowRequest.findUnique({
        where: { id: requestId },
        include: { lines: { include: { model: true } }, approvals: true },
      });
      if (!request) throw new NotFoundException(`Không có phiếu ${requestId}`);
      if (request.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(
          `Phiếu ${request.request_code} đang ở trạng thái ${request.status}, không duyệt được nữa`,
        );
      }
      // BR-23: mỗi người chỉ ký một lần. Ký hai lần là tự mình đủ hai cấp.
      if (request.approvals.some((a) => a.decided_by === approverId)) {
        throw new ConflictException('Bạn đã ra quyết định cho phiếu này rồi');
      }

      const { levels } = this.requiredLevels({
        totalValue: this.estimateValue(request.lines),
        fromTime: request.from_time,
        toTime: request.to_time,
        place: request.place,
      });

      await tx.memsApproval.create({
        data: {
          request_id: requestId,
          level: request.approvals.length + 1,
          decision,
          decided_by: approverId,
          reason: reason ?? null,
        },
      });

      if (decision === 'REJECTED') {
        await tx.memsReservation.updateMany({
          where: { request_line: { request_id: requestId }, status: { not: 'RELEASED' } },
          data: { status: 'RELEASED' },
        });
        await tx.memsRequestLine.updateMany({
          where: { request_id: requestId },
          data: { status: 'CANCELLED' },
        });
        return tx.memsBorrowRequest.update({
          where: { id: requestId },
          data: { status: 'REJECTED' },
        });
      }

      const approvedCount = request.approvals.filter((a) => a.decision === 'APPROVED').length + 1;
      if (approvedCount < levels) {
        // Chưa đủ cấp thì phiếu vẫn nằm chờ, giữ chỗ giữ nguyên.
        return tx.memsBorrowRequest.findUniqueOrThrow({ where: { id: requestId } });
      }

      await tx.memsReservation.updateMany({
        where: { request_line: { request_id: requestId }, status: 'TENTATIVE' },
        data: { status: 'CONFIRMED' },
      });
      return tx.memsBorrowRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED' },
      });
    });
  }

  private estimateValue(lines: { quantity: number; model: { reference_price: unknown } }[]) {
    return lines.reduce(
      (sum, line) => sum + Number(line.model.reference_price ?? 0) * line.quantity,
      0,
    );
  }

  /** Gắn thêm số cấp duyệt và tiến độ ký để FE không phải tự suy. */
  private decorate(request: any) {
    const approval = this.requiredLevels({
      totalValue: this.estimateValue(request.lines),
      fromTime: request.from_time,
      toTime: request.to_time,
      place: request.place,
    });
    return {
      ...request,
      total_value: this.estimateValue(request.lines),
      required_levels: approval.levels,
      approval_reasons: approval.reasons,
      approved_levels: (request.approvals ?? []).filter(
        (a: any) => a.decision === 'APPROVED',
      ).length,
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApproveRequestDto, RejectRequestDto } from './dto';
import { ApprovalPlan, canSign, nextStep, planApprovals } from './approval-rules';

/** Người đang ký, lấy từ token — cần cả id lẫn vai trò để đối chiếu với cấp đang tới lượt. */
export interface Approver {
  id: string;
  roles: (UserRole | string)[];
}

@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kế hoạch chữ ký của một phiếu. Tính ở BE chứ không để FE tự tính: FE tính thì mỗi màn một
   * kiểu, và người sửa ngưỡng phải nhớ sửa hai nơi.
   */
  planFor(request: {
    lines: { quantity: number; model: { reference_price: unknown } }[];
    from_time: Date;
    to_time: Date;
    place: string;
  }): ApprovalPlan {
    return planApprovals({
      totalValue: this.estimateValue(request.lines),
      fromTime: request.from_time,
      toTime: request.to_time,
      place: request.place,
    });
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

  async approve(requestId: string, approver: Approver, dto: ApproveRequestDto) {
    return this.decide(requestId, approver, 'APPROVED', dto.reason);
  }

  async reject(requestId: string, approver: Approver, dto: RejectRequestDto) {
    // BR-20: từ chối phải nêu lý do. Chặn ở đây chứ không chỉ ở DTO vì chuỗi toàn khoảng trắng
    // vẫn lọt qua @IsNotEmpty.
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Phải nhập lý do khi từ chối phiếu');
    }
    return this.decide(requestId, approver, 'REJECTED', dto.reason.trim());
  }

  /**
   * Ghi một cấp duyệt. Đủ số cấp thì phiếu chuyển sang APPROVED.
   *
   * Từ chối NHẢ GIỮ CHỖ NGAY (BR-32) trong cùng giao dịch: để sang lượt sau thì khoảng thời gian
   * đó vẫn hiện là bận, người khác không xin được chiếc máy thực ra đang rảnh.
   */
  private async decide(
    requestId: string,
    approver: Approver,
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
      // Người đứng tên phiếu không được tự ký. Đây là chốt chặn quan trọng nhất của cả quy
      // trình: leader và admin làm được gần như mọi việc như nhau, nên nếu người xin ký được
      // cho chính mình thì cấp duyệt chỉ còn là một nút bấm thừa.
      if (request.owner_id === approver.id) {
        throw new ForbiddenException(
          'Không tự duyệt phiếu do chính mình đứng tên. Nhờ leader khác hoặc admin ký.',
        );
      }
      // BR-23: mỗi người chỉ ký một lần. Ký hai lần là tự mình đủ hai cấp.
      if (request.approvals.some((a) => a.decided_by === approver.id)) {
        throw new ConflictException('Bạn đã ra quyết định cho phiếu này rồi');
      }

      const plan = this.planFor(request);
      const approvedSoFar = request.approvals.filter((a) => a.decision === 'APPROVED').length;
      const step = nextStep(plan, approvedSoFar);
      if (!step) throw new ConflictException('Phiếu đã đủ chữ ký');
      if (!canSign(step, approver.roles)) {
        throw new ForbiddenException(
          `Cấp ${step.level} phải do ${step.role} ký — ${step.reason}.`,
        );
      }

      await tx.memsApproval.create({
        data: {
          request_id: requestId,
          level: step.level,
          decision,
          decided_by: approver.id,
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

      if (approvedSoFar + 1 < plan.steps.length) {
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

  /** Gắn kế hoạch chữ ký và tiến độ ký để FE không phải tự suy. */
  private decorate(request: any) {
    const plan = this.planFor(request);
    const approvedLevels = (request.approvals ?? []).filter(
      (a: any) => a.decision === 'APPROVED',
    ).length;
    return {
      ...request,
      total_value: this.estimateValue(request.lines),
      required_levels: plan.steps.length,
      /** Ai phải ký cấp nào — FE hiện đúng tên vai trò thay vì chỉ nói "cần 2 cấp". */
      approval_steps: plan.steps,
      approval_reasons: plan.steps.slice(1).map((s) => s.reason),
      approval_warnings: plan.warnings,
      approved_levels: approvedLevels,
      next_approver_role: nextStep(plan, approvedLevels)?.role ?? null,
    };
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService } from "../../../common/push/push.service";
import { ReviewContentApprovalDto } from "./task.dto";

const approvalInclude = {
  requested_by: { select: { id: true, full_name: true, email: true } },
  reviewed_by: { select: { id: true, full_name: true } },
};

@Injectable()
export class ContentApprovalService {
  private readonly logger = new Logger(ContentApprovalService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  /** Yêu cầu duyệt content gần nhất của task (nếu có) — dùng để render badge trạng thái ở task detail. */
  async getCurrent(taskId: string) {
    return this.prisma.taskContentApproval.findFirst({
      where: { task_id: taskId },
      orderBy: { created_at: "desc" },
      include: approvalInclude,
    });
  }

  async request(taskId: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        assignee_id: true,
        team: { select: { leader_id: true, name: true } },
        video_script: { select: { content: true } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (task.assignee_id !== userId) {
      throw new ForbiddenException(
        "Chỉ người được giao task mới gửi yêu cầu duyệt content",
      );
    }
    if (!task.video_script?.content?.trim()) {
      throw new BadRequestException("Task chưa có content để gửi duyệt");
    }

    const pending = await this.prisma.taskContentApproval.findFirst({
      where: { task_id: taskId, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictException("Content này đang có yêu cầu chờ duyệt");
    }

    const request = await this.prisma.taskContentApproval.create({
      data: {
        task_id: taskId,
        content: task.video_script.content,
        requested_by_id: userId,
      },
      include: approvalInclude,
    });

    if (task.team.leader_id) {
      await this.notify(
        task.team.leader_id,
        "CONTENT_APPROVAL_REQUESTED",
        "Yêu cầu duyệt content mới",
        taskId,
      );
    }
    return request;
  }

  async review(
    approvalId: string,
    dto: ReviewContentApprovalDto,
    reviewerId: string,
  ) {
    const approval = await this.prisma.taskContentApproval.findUnique({
      where: { id: approvalId },
      include: { task: { select: { id: true, assignee_id: true } } },
    });
    if (!approval) throw new NotFoundException("Không tìm thấy yêu cầu duyệt");
    if (approval.status !== "PENDING") {
      throw new ConflictException("Yêu cầu đã được xử lý");
    }

    const updated = await this.prisma.taskContentApproval.update({
      where: { id: approvalId },
      data: {
        status: dto.action,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
        reject_reason: dto.action === "REJECTED" ? (dto.reject_reason ?? null) : null,
      },
      include: approvalInclude,
    });

    if (approval.task.assignee_id) {
      const title =
        dto.action === "APPROVED"
          ? "Content của bạn đã được duyệt"
          : "Content của bạn bị từ chối";
      await this.notify(
        approval.task.assignee_id,
        `CONTENT_${dto.action}`,
        title,
        approval.task.id,
      );
    }

    return updated;
  }

  private async notify(
    userId: string,
    type: string,
    title: string,
    taskId: string,
  ) {
    await this.prisma.notification
      .create({ data: { user_id: userId, type, title, task_id: taskId } })
      .catch((err) =>
        this.logger.warn(
          `[notify] failed to create ${type} for user ${userId}: ${err.message}`,
        ),
      );
    this.push
      .sendToUser(userId, { title, url: "/dashboard/task-auto/tasks" })
      .catch(() => {});
  }
}

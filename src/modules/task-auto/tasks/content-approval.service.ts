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
import { ReviewContentApprovalDto, QueryContentApprovalDto } from "./dto/task.dto";
import { parseTeamIdFilter } from "../../../common/utils/team-membership.util";

const approvalInclude = {
  requested_by: { select: { id: true, full_name: true, email: true } },
  reviewed_by: { select: { id: true, full_name: true } },
};

// Include cho danh sách (tab "Content chờ duyệt") — cần thêm thông tin task để hiển thị
// tiêu đề/team/người làm mà không phải gọi thêm request riêng cho từng dòng.
const approvalListInclude = {
  ...approvalInclude,
  task: {
    select: {
      id: true,
      deadline: true,
      team: { select: { id: true, name: true } },
      assignee: { select: { id: true, full_name: true } },
      content: {
        select: {
          title: true,
          source_team_content: {
            select: { title: true, source_editor_content: { select: { title: true } } },
          },
        },
      },
      editor_content: { select: { title: true } },
      team_content: {
        select: { title: true, source_editor_content: { select: { title: true } } },
      },
    },
  },
};

@Injectable()
export class ContentApprovalService {
  private readonly logger = new Logger(ContentApprovalService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  /** Danh sách yêu cầu duyệt content (mặc định PENDING) — dùng cho tab "Content chờ duyệt". */
  async list(q: QueryContentApprovalDto) {
    const where: any = { status: q.status ?? "PENDING" };

    const taskWhere: any = {};
    const teamIdFilter = parseTeamIdFilter(q.team_id);
    if (teamIdFilter) taskWhere.team_id = teamIdFilter;
    if (q.assignee_id) taskWhere.assignee_id = q.assignee_id;
    if (q.search) {
      taskWhere.content = { title: { contains: q.search, mode: "insensitive" } };
    }
    if (Object.keys(taskWhere).length) where.task = taskWhere;

    const page = q.page ?? 1;
    const limit = q.limit ?? 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.taskContentApproval.findMany({
        where,
        include: approvalListInclude,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.taskContentApproval.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Đếm nhanh số yêu cầu PENDING khớp bộ lọc — dùng cho badge "Content chờ duyệt" ở
   * tasks/page.tsx, chỉ cần count() thuần (không cần findMany như list()). */
  async countPending(params: { team_id?: string; search?: string; assignee_id?: string }) {
    const where: any = { status: "PENDING" };
    const taskWhere: any = {};
    const teamIdFilter = parseTeamIdFilter(params.team_id);
    if (teamIdFilter) taskWhere.team_id = teamIdFilter;
    if (params.assignee_id) taskWhere.assignee_id = params.assignee_id;
    if (params.search) {
      taskWhere.content = { title: { contains: params.search, mode: "insensitive" } };
    }
    if (Object.keys(taskWhere).length) where.task = taskWhere;

    return this.prisma.taskContentApproval.count({ where });
  }

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

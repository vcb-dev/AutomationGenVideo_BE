import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { TaskAutoVideoService } from "../video/video.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  SubmitTaskDto,
  ReviewTaskDto,
} from "./task.dto";

// Các field content/sản phẩm/nguồn — chỉ task sáng tạo (EXTRA) mới được sửa
const CATALOG_FIELDS = [
  "content_id",
  "editor_content_id",
  "team_content_id",
  "product_id",
  "editor_product_id",
  "team_product_id",
  "source_outro_id",
  "source_extra_id",
  "source_workshop_id",
  "source_huyk_id",
  "editor_source_outro_id",
  "editor_source_extra_id",
  "editor_source_workshop_id",
  "editor_source_huyk_id",
  "team_source_outro_id",
  "team_source_extra_id",
  "team_source_workshop_id",
  "team_source_huyk_id",
] as const;

@Injectable()
export class TaskAutoTasksService {
  private readonly logger = new Logger(TaskAutoTasksService.name);

  constructor(
    private prisma: PrismaService,
    private videoService: TaskAutoVideoService,
  ) {}

  // Bản include đầy đủ — dùng cho findOne (detail panel) và các mutation
  // (create/update/submit/review) trả về task để FE cập nhật cache/detail panel.
  private taskDetailInclude = {
    team: { select: { id: true, name: true } },
    content: {
      select: {
        id: true,
        title: true,
        market: true,
        status: true,
        content_line: { select: { id: true, name: true } },
        source_team_content: {
          select: {
            id: true,
            title: true,
            market: true,
            script: true,
            body: true,
            file_content_url: true,
            voice_url: true,
            content_line: { select: { id: true, name: true } },
            source_editor_content: {
              select: {
                id: true,
                title: true,
                market: true,
                script: true,
                body: true,
                file_content_url: true,
                voice_url: true,
                content_line: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    },
    product: {
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        image_urls: true,
        price: true,
        market: true,
        price_segment: true,
        priority_score: true,
        material: { select: { id: true, name: true } },
        product_line: { select: { id: true, name: true } },
        sources: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
          },
        },
        source_team_product: {
          select: {
            id: true,
            sku: true,
            name: true,
            image_url: true,
            image_urls: true,
            price: true,
            market: true,
            price_segment: true,
            priority_score: true,
            material: { select: { id: true, name: true } },
            product_line: { select: { id: true, name: true } },
            source_editor_product: {
              select: {
                id: true,
                sku: true,
                name: true,
                image_url: true,
                image_urls: true,
                price: true,
                market: true,
                price_segment: true,
                priority_score: true,
                material: { select: { id: true, name: true } },
                product_line: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    },
    editor_product: {
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        image_urls: true,
        price: true,
        market: true,
        price_segment: true,
        priority_score: true,
        material: { select: { id: true, name: true } },
        product_line: { select: { id: true, name: true } },
        editor_sources: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
          },
        },
      },
    },
    team_product: {
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        image_urls: true,
        price: true,
        market: true,
        price_segment: true,
        priority_score: true,
        material: { select: { id: true, name: true } },
        product_line: { select: { id: true, name: true } },
        source_editor_product: {
          select: {
            id: true,
            sku: true,
            name: true,
            image_url: true,
            image_urls: true,
            price: true,
            market: true,
            price_segment: true,
            priority_score: true,
            material: { select: { id: true, name: true } },
            product_line: { select: { id: true, name: true } },
          },
        },
        team_sources: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
          },
        },
      },
    },
    editor_content: {
      select: {
        id: true,
        title: true,
        market: true,
        script: true,
        body: true,
        file_content_url: true,
        voice_url: true,
        content_line: { select: { id: true, name: true } },
      },
    },
    team_content: {
      select: {
        id: true,
        title: true,
        market: true,
        script: true,
        body: true,
        file_content_url: true,
        voice_url: true,
        content_line: { select: { id: true, name: true } },
        source_editor_content: {
          select: {
            id: true,
            title: true,
            market: true,
            script: true,
            body: true,
            file_content_url: true,
            voice_url: true,
            content_line: { select: { id: true, name: true } },
          },
        },
      },
    },
    content_line: { select: { id: true, name: true } },
    assignee: { select: { id: true, full_name: true, email: true } },
    reviewed_by: { select: { id: true, full_name: true } },
    source_outro: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_team_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
            source_editor_source: {
              select: {
                id: true,
                name: true,
                type: true,
                link: true,
                nas_link: true,
              },
            },
          },
        },
      },
    },
    source_extra: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_team_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
            source_editor_source: {
              select: {
                id: true,
                name: true,
                type: true,
                link: true,
                nas_link: true,
              },
            },
          },
        },
      },
    },
    source_workshop: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_team_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
            source_editor_source: {
              select: {
                id: true,
                name: true,
                type: true,
                link: true,
                nas_link: true,
              },
            },
          },
        },
      },
    },
    source_huyk: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_team_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
            source_editor_source: {
              select: {
                id: true,
                name: true,
                type: true,
                link: true,
                nas_link: true,
              },
            },
          },
        },
      },
    },
    editor_source_outro: {
      select: { id: true, name: true, type: true, link: true, nas_link: true },
    },
    editor_source_extra: {
      select: { id: true, name: true, type: true, link: true, nas_link: true },
    },
    editor_source_workshop: {
      select: { id: true, name: true, type: true, link: true, nas_link: true },
    },
    editor_source_huyk: {
      select: { id: true, name: true, type: true, link: true, nas_link: true },
    },
    team_source_outro: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_editor_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
          },
        },
      },
    },
    team_source_extra: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_editor_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
          },
        },
      },
    },
    team_source_workshop: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_editor_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
          },
        },
      },
    },
    team_source_huyk: {
      select: {
        id: true,
        name: true,
        type: true,
        link: true,
        nas_link: true,
        source_editor_source: {
          select: {
            id: true,
            name: true,
            type: true,
            link: true,
            nas_link: true,
          },
        },
      },
    },
    pending_video: true,
  };

  // Bản include nhẹ — dùng cho findAll (bảng danh sách task + SubmittedVideosGrid).
  // FE (TasksTable.tsx: resolveContentTitle/resolveProductName/resolveProductImage,
  // ExtraTaskGroupPanel.tsx) chỉ đọc title/name/image_url + team/assignee/status/deadline/
  // task_type ở list view — không cần material/product_line/sources/content_line/reviewed_by/
  // pending_video như bản detail. Đã verify bằng cách đọc toàn bộ FE consumers của getTasks().
  private taskListInclude = {
    team: { select: { id: true, name: true } },
    assignee: { select: { id: true, full_name: true, email: true } },
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
      select: {
        title: true,
        source_editor_content: { select: { title: true } },
      },
    },
    product: {
      select: {
        name: true,
        image_url: true,
        source_team_product: {
          select: {
            name: true,
            image_url: true,
            source_editor_product: { select: { name: true, image_url: true } },
          },
        },
      },
    },
    editor_product: { select: { name: true, image_url: true } },
    team_product: {
      select: {
        name: true,
        image_url: true,
        source_editor_product: { select: { name: true, image_url: true } },
      },
    },
  };

  async findAll(q: QueryTaskDto) {
    const where: any = {};

    if (q.status) where.status = q.status;
    if (q.team_id) where.team_id = q.team_id;
    if (q.assignee_id) where.assignee_id = q.assignee_id;
    if (q.task_type === "auto") where.task_type = "AUTO";
    if (q.task_type === "extra") where.task_type = "EXTRA";
    if (q.deadline_date) {
      where.deadline = {
        gte: new Date(`${q.deadline_date}T00:00:00+07:00`),
        lte: new Date(`${q.deadline_date}T23:59:59.999+07:00`),
      };
    } else if (q.month) {
      const start = new Date(`${q.month}-01`);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      where.created_at = { gte: start, lt: end };
    }
    if (q.search) {
      where.content = { title: { contains: q.search, mode: "insensitive" } };
    }

    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: this.taskListInclude,
        orderBy: [{ created_at: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...this.taskDetailInclude,
        assignments: {
          include: {
            user: { select: { id: true, full_name: true, email: true } },
          },
          orderBy: { assigned_at: "desc" },
        },
        notifications: { take: 5, orderBy: { created_at: "desc" } },
      },
    });
    if (!task) throw new NotFoundException("Task not found");

    const productSources =
      task.product?.sources ??
      task.editor_product?.editor_sources ??
      task.team_product?.team_sources ??
      [];

    return {
      ...task,
      product_sources: productSources,
    };
  }

  async create(dto: CreateTaskDto, creatorId: string, roles: string[] = []) {
    const isPrivileged = roles.some((r) =>
      ["ADMIN", "MANAGER", "LEADER"].includes(r),
    );

    if (!isPrivileged) {
      dto = { ...dto, assignee_id: creatorId };
    }

    if (!dto.content_id && !dto.editor_content_id && !dto.team_content_id) {
      throw new BadRequestException(
        "Cần cung cấp content_id, editor_content_id hoặc team_content_id",
      );
    }

    const team = await this.prisma.team.findUnique({
      where: { id: dto.team_id },
    });
    if (!team) throw new NotFoundException("Team not found");

    let resolvedContentLineId: string | null = null;
    if (dto.content_id) {
      const content = await this.prisma.content.findUnique({
        where: { id: dto.content_id },
        select: { content_line_id: true },
      });
      if (!content) throw new NotFoundException("Content not found");
      resolvedContentLineId = content.content_line_id;
    } else if (dto.editor_content_id) {
      const ec = await this.prisma.editorContent.findUnique({
        where: { id: dto.editor_content_id },
        select: { content_line_id: true },
      });
      if (!ec) throw new NotFoundException("EditorContent not found");
      resolvedContentLineId = ec.content_line_id;
    } else if (dto.team_content_id) {
      const tc = await this.prisma.teamContent.findUnique({
        where: { id: dto.team_content_id },
        select: { content_line_id: true },
      });
      if (!tc) throw new NotFoundException("TeamContent not found");
      resolvedContentLineId = tc.content_line_id;
    }

    if (!isPrivileged) {
      const membership = await this.prisma.teamMember.findFirst({
        where: { user_id: creatorId, team_id: dto.team_id },
        select: { team_id: true },
      });
      if (!membership) {
        throw new ForbiddenException("Bạn không thuộc team này");
      }
    }

    const hasProduct =
      dto.product_id || dto.editor_product_id || dto.team_product_id;

    const task = await this.prisma
      .$transaction(
        async (tx) => {
          if (dto.assignee_id && hasProduct) {
            const duplicate = await tx.task.findFirst({
              where: {
                assignee_id: dto.assignee_id,
                ...(dto.content_id ? { content_id: dto.content_id } : {}),
                ...(dto.editor_content_id
                  ? { editor_content_id: dto.editor_content_id }
                  : {}),
                ...(dto.team_content_id
                  ? { team_content_id: dto.team_content_id }
                  : {}),
                ...(dto.product_id ? { product_id: dto.product_id } : {}),
                ...(dto.editor_product_id
                  ? { editor_product_id: dto.editor_product_id }
                  : {}),
                ...(dto.team_product_id
                  ? { team_product_id: dto.team_product_id }
                  : {}),
              },
              select: { id: true },
            });
            if (duplicate) {
              throw new BadRequestException(
                "Editor này đã có task với cặp content + sản phẩm này",
              );
            }
          }

          return tx.task.create({
            data: {
              team_id: dto.team_id,
              content_id: dto.content_id ?? null,
              editor_content_id: dto.editor_content_id ?? null,
              team_content_id: dto.team_content_id ?? null,
              product_id: dto.product_id ?? null,
              editor_product_id: dto.editor_product_id ?? null,
              team_product_id: dto.team_product_id ?? null,
              content_line_id: dto.content_line_id ?? resolvedContentLineId,
              source_outro_id: dto.source_outro_id ?? null,
              source_extra_id: dto.source_extra_id ?? null,
              source_workshop_id: dto.source_workshop_id ?? null,
              source_huyk_id: dto.source_huyk_id ?? null,
              editor_source_outro_id: dto.editor_source_outro_id ?? null,
              editor_source_extra_id: dto.editor_source_extra_id ?? null,
              editor_source_workshop_id: dto.editor_source_workshop_id ?? null,
              editor_source_huyk_id: dto.editor_source_huyk_id ?? null,
              team_source_outro_id: dto.team_source_outro_id ?? null,
              team_source_extra_id: dto.team_source_extra_id ?? null,
              team_source_workshop_id: dto.team_source_workshop_id ?? null,
              team_source_huyk_id: dto.team_source_huyk_id ?? null,
              assignee_id: dto.assignee_id,
              deadline: dto.deadline ? new Date(dto.deadline) : undefined,
              status: dto.assignee_id ? "ASSIGNED" : "PENDING",
              assigned_at: dto.assignee_id ? new Date() : undefined,
            },
            include: this.taskDetailInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2034"
        ) {
          throw new BadRequestException(
            "Editor này đã có task với cặp content + sản phẩm này",
          );
        }
        throw err;
      });

    if (dto.assignee_id) {
      await this.notify(
        dto.assignee_id,
        "TASK_ASSIGNED",
        "Task mới được giao",
        task.id,
      );
    }
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    userId: string,
    roles: string[],
  ) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("Task not found");

    if (
      task.task_type === "AUTO" &&
      CATALOG_FIELDS.some((f) => dto[f] !== undefined)
    ) {
      throw new ForbiddenException(
        "Task đẩy SP theo kế hoạch không cho phép sửa content/sản phẩm/nguồn",
      );
    }

    const isPrivileged = roles.some((r) =>
      ["ADMIN", "MANAGER", "LEADER"].includes(r),
    );
    const isAssignee = task.assignee_id === userId;

    if (dto.status) {
      const allowed = this.allowedTransition(
        task.status,
        dto.status,
        isPrivileged,
        isAssignee,
      );
      if (!allowed) {
        throw new ForbiddenException(
          `Cannot move from ${task.status} to ${dto.status}`,
        );
      }
    }

    if (
      dto.assignee_id !== undefined &&
      dto.assignee_id !== task.assignee_id &&
      !isPrivileged
    ) {
      if (dto.assignee_id !== userId) {
        throw new ForbiddenException("Chỉ có thể tự nhận task cho chính mình");
      }
      const membership = await this.prisma.teamMember.findFirst({
        where: { user_id: userId, team_id: task.team_id },
        select: { team_id: true },
      });
      if (!membership) {
        throw new ForbiddenException("Bạn không thuộc team này");
      }
    }

    const data: any = { ...dto };
    if (dto.deadline) data.deadline = new Date(dto.deadline);
    if (dto.assignee_id !== undefined) {
      data.assigned_at = dto.assignee_id ? new Date() : null;
      if (dto.assignee_id && task.status === "PENDING") {
        data.status = "ASSIGNED";
      } else if (!dto.assignee_id && task.status === "ASSIGNED") {
        data.status = "PENDING";
      }
    }
    if (dto.status === "SUBMITTED") data.submitted_at = new Date();
    if (dto.status === "APPROVED" || dto.status === "REJECTED") {
      data.reviewed_by_id = userId;
      data.reviewed_at = new Date();
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data,
      include: this.taskDetailInclude,
    });

    if (dto.assignee_id && !task.assignee_id) {
      await this.notify(
        dto.assignee_id,
        "TASK_ASSIGNED",
        "Task mới được giao cho bạn",
        id,
      );
    }
    if (dto.status === "SUBMITTED" && task.assignee_id) {
      const team = await this.prisma.team.findUnique({
        where: { id: task.team_id },
        select: { leader_id: true },
      });
      if (team?.leader_id) {
        await this.notify(
          team.leader_id,
          "TASK_SUBMITTED",
          "Task đã được nộp",
          id,
        );
      }
    }
    if (dto.status === "APPROVED" && task.assignee_id) {
      await this.notify(
        task.assignee_id,
        "TASK_APPROVED",
        "Task của bạn đã được duyệt",
        id,
      );
    }
    if (dto.status === "REJECTED" && task.assignee_id) {
      await this.notify(
        task.assignee_id,
        "TASK_REJECTED",
        "Task của bạn bị từ chối",
        id,
      );
    }

    return updated;
  }

  async submit(id: string, dto: SubmitTaskDto, userId: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("Task not found");
    if (task.assignee_id !== userId)
      throw new ForbiddenException("Not your task");
    if (!["ASSIGNED", "IN_PROGRESS"].includes(task.status)) {
      throw new BadRequestException("Task is not in a submittable state");
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        submitted_at: new Date(),
        result_url: dto.result_url,
      },
      include: this.taskDetailInclude,
    });

    const team = await this.prisma.team.findUnique({
      where: { id: task.team_id },
      select: { leader_id: true },
    });
    if (team?.leader_id) {
      await this.notify(
        team.leader_id,
        "TASK_SUBMITTED",
        "Task đã được nộp",
        id,
      );
    }

    return updated;
  }

  async review(id: string, dto: ReviewTaskDto, reviewerId: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("Task not found");
    if (task.status !== "SUBMITTED") {
      throw new BadRequestException("Task is not in SUBMITTED state");
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        status: dto.action,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
        reject_reason: dto.reject_reason,
      },
      include: this.taskDetailInclude,
    });

    if (task.assignee_id) {
      const title =
        dto.action === "APPROVED" ? "Task đã được duyệt" : "Task bị từ chối";
      await this.notify(task.assignee_id, `TASK_${dto.action}`, title, id);
    }

    if (dto.action === "APPROVED") {
      await this.videoService
        .uploadPendingToDrive(id)
        .catch((err) =>
          this.logger.warn(
            `[review] uploadPendingToDrive failed for task ${id}: ${err.message}`,
          ),
        );
    }

    if (dto.action === "REJECTED") {
      await this.videoService
        .deletePendingVideo(id)
        .catch((err) =>
          this.logger.warn(
            `[review] deletePendingVideo failed for task ${id}: ${err.message}`,
          ),
        );
    }

    return updated;
  }

  async getDashboard(userId: string, roles: string[]) {
    const isAdminOrManager =
      roles.includes("ADMIN") || roles.includes("MANAGER");
    const isLeaderOnly = roles.includes("LEADER") && !isAdminOrManager;
    if (isAdminOrManager) return this.getGlobalDashboard();
    if (isLeaderOnly) return this.getLeaderDashboard(userId);
    return this.getPersonalDashboard(userId);
  }

  private async getGlobalDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const [
      tasksByStatus,
      todayDeadline,
      overdue,
      monthlyCompleted,
      contentCounts,
      totalEditors,
      approvedEditors,
      pendingApprovals,
    ] = await Promise.all([
      this.prisma.task.groupBy({ by: ["status"], _count: { id: true } }),
      this.prisma.task.count({
        where: {
          deadline: { gte: todayStart, lt: todayEnd },
          status: { notIn: ["APPROVED", "CANCELLED"] },
        },
      }),
      this.prisma.task.count({
        where: {
          deadline: { lt: now },
          status: { notIn: ["APPROVED", "CANCELLED"] },
        },
      }),
      this.prisma.task.count({
        where: {
          status: "APPROVED",
          reviewed_at: { gte: monthStart, lt: monthEnd },
        },
      }),
      this.prisma.content.groupBy({ by: ["status"], _count: { id: true } }),
      this.prisma.user.count({ where: { is_active: true } }),
      this.prisma.editorApproval.count({ where: { status: "APPROVED" } }),
      this.prisma.editorApproval.count({ where: { status: "PENDING" } }),
    ]);

    const taskMap = Object.fromEntries(
      tasksByStatus.map((r) => [r.status.toLowerCase(), r._count.id]),
    );
    const contentMap = Object.fromEntries(
      contentCounts.map((r) => [r.status.toLowerCase(), r._count.id]),
    );

    return {
      scope: "global" as const,
      tasks: {
        total: Object.values(taskMap).reduce((s, v) => s + v, 0),
        ...taskMap,
      },
      today_deadline: todayDeadline,
      overdue,
      monthly_completed: monthlyCompleted,
      contents: {
        available: contentMap["available"] ?? 0,
        in_task: contentMap["in_task"] ?? 0,
        used: contentMap["used"] ?? 0,
        archived: contentMap["archived"] ?? 0,
      },
      editors: {
        total: totalEditors,
        approved: approvedEditors,
        pending_approval: pendingApprovals,
      },
    };
  }

  private async getLeaderDashboard(leaderId: string) {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const team = await this.prisma.team.findFirst({
      where: { leader_id: leaderId },
      include: {
        members: {
          where: { user: { is_active: true } },
          include: {
            user: { select: { id: true, full_name: true, email: true } },
          },
        },
      },
    });

    if (!team)
      return {
        scope: "team" as const,
        team: null,
        tasks: { total: 0 },
        members: [],
        kpi: null,
      };

    const memberIds = team.members.map((m) => m.user_id);

    const [tasksByStatus, memberTaskRows, editorKpis] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["status"],
        where: { team_id: team.id },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id", "status"],
        where: {
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
        },
        _count: { id: true },
      }),
      this.prisma.editorKpi.findMany({
        where: { user_id: { in: memberIds }, month: currentMonth },
      }),
    ]);

    const taskMap = Object.fromEntries(
      tasksByStatus.map((r) => [r.status.toLowerCase(), r._count.id]),
    );
    const memberStats: Record<string, Record<string, number>> = {};
    for (const r of memberTaskRows) {
      const uid = r.assignee_id!;
      if (!memberStats[uid]) memberStats[uid] = {};
      memberStats[uid][r.status.toLowerCase()] = r._count.id;
    }

    const kpiByUser = Object.fromEntries(editorKpis.map((k) => [k.user_id, k]));
    const members = team.members.map((m) => {
      const kpi = kpiByUser[m.user_id];
      return {
        user_id: m.user_id,
        full_name: m.user?.full_name ?? "",
        email: m.user?.email ?? "",
        pending: memberStats[m.user_id]?.["pending"] ?? 0,
        in_progress: memberStats[m.user_id]?.["in_progress"] ?? 0,
        submitted: memberStats[m.user_id]?.["submitted"] ?? 0,
        approved: memberStats[m.user_id]?.["approved"] ?? 0,
        kpi_target: kpi?.total_target ?? 0,
        kpi_video_win: kpi?.video_win ?? 0,
        kpi_content_new: kpi?.content_new ?? 0,
        kpi_product_planned: kpi?.product_planned ?? 0,
      };
    });

    const kpiTotal = editorKpis.reduce((s, k) => s + k.total_target, 0);
    const kpiVideoWin = editorKpis.reduce((s, k) => s + (k.video_win ?? 0), 0);
    const kpiContentNew = editorKpis.reduce(
      (s, k) => s + (k.content_new ?? 0),
      0,
    );
    const kpiProductPlanned = editorKpis.reduce(
      (s, k) => s + (k.product_planned ?? 0),
      0,
    );
    const kpiCompleted = taskMap["approved"] ?? 0;

    return {
      scope: "team" as const,
      team: { id: team.id, name: team.name, member_count: team.members.length },
      tasks: {
        total: Object.values(taskMap).reduce((s, v) => s + v, 0),
        ...taskMap,
      },
      members,
      kpi: {
        month: currentMonth,
        total_target: kpiTotal,
        completed: kpiCompleted,
        video_win: kpiVideoWin,
        content_new: kpiContentNew,
        product_planned: kpiProductPlanned,
      },
    };
  }

  private async getPersonalDashboard(userId: string) {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [tasksByStatus, todayDeadline, overdue, myKpiRows] =
      await Promise.all([
        this.prisma.task.groupBy({
          by: ["status"],
          where: { assignee_id: userId },
          _count: { id: true },
        }),
        this.prisma.task.count({
          where: {
            assignee_id: userId,
            deadline: { gte: todayStart, lt: todayEnd },
            status: { notIn: ["APPROVED", "CANCELLED"] },
          },
        }),
        this.prisma.task.count({
          where: {
            assignee_id: userId,
            deadline: { lt: now },
            status: { notIn: ["APPROVED", "CANCELLED"] },
          },
        }),
        this.prisma.editorKpi.findMany({
          where: { user_id: userId, month: currentMonth },
          include: {
            allocations: {
              include: {
                content_line: { select: { id: true, name: true } },
                product_line: { select: { id: true, name: true } },
              },
            },
          },
        }),
      ]);

    const taskMap = Object.fromEntries(
      tasksByStatus.map((r) => [r.status.toLowerCase(), r._count.id]),
    );
    const completed = taskMap["approved"] ?? 0;

    // Gộp tất cả KPI các team trong tháng (editor thuộc nhiều team)
    const sum = <K extends keyof (typeof myKpiRows)[0]>(field: K) =>
      myKpiRows.reduce((s, k) => s + ((k[field] as number) ?? 0), 0);

    // Gộp phân bổ theo ContentLine/ProductLine từ mọi team KPI trong tháng (cộng dồn weight trùng dòng)
    const mergeAllocations = (type: "CONTENT_LINE" | "PRODUCT_LINE") => {
      const merged = new Map<
        string,
        { id: string; name: string; weight: number }
      >();
      for (const k of myKpiRows) {
        for (const a of k.allocations) {
          if (a.type !== type) continue;
          const line = a.content_line ?? a.product_line;
          const id = a.content_line_id ?? a.product_line_id;
          if (!id) continue;
          const existing = merged.get(id);
          if (existing) existing.weight += a.quantity;
          else
            merged.set(id, { id, name: line?.name ?? "—", weight: a.quantity });
        }
      }
      return [...merged.values()];
    };

    const myKpi =
      myKpiRows.length > 0
        ? {
            month: currentMonth,
            total_target: sum("total_target"),
            video_win: sum("video_win"),
            video_fail: sum("video_fail"),
            kpi_extra: sum("kpi_extra"),
            content_new: sum("content_new"),
            content_collected: sum("content_collected"),
            content_win_cover: sum("content_win_cover"),
            product_planned: sum("product_planned"),
            product_win_collect: sum("product_win_collect"),
            content_allocations: mergeAllocations("CONTENT_LINE"),
            product_allocations: mergeAllocations("PRODUCT_LINE"),
          }
        : null;

    return {
      scope: "personal" as const,
      tasks: {
        total: Object.values(taskMap).reduce((s, v) => s + v, 0),
        ...taskMap,
      },
      today_deadline: todayDeadline,
      overdue,
      kpi: myKpi
        ? {
            month: myKpi.month,
            completed,
            total_target: myKpi.total_target,
            video_win: myKpi.video_win,
            video_fail: myKpi.video_fail,
            kpi_extra: myKpi.kpi_extra,
            content_new: myKpi.content_new,
            content_collected: myKpi.content_collected,
            content_win_cover: myKpi.content_win_cover,
            product_planned: myKpi.product_planned,
            product_win_collect: myKpi.product_win_collect,
            content_allocations: myKpi.content_allocations,
            product_allocations: myKpi.product_allocations,
          }
        : null,
    };
  }

  async remove(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException("Task not found");
    if (["APPROVED", "IN_PROGRESS"].includes(task.status)) {
      throw new BadRequestException("Cannot delete a task in this state");
    }
    await this.prisma.task.delete({ where: { id } });
    return { success: true };
  }

  private allowedTransition(
    from: string,
    to: string,
    isPrivileged: boolean,
    isAssignee: boolean,
  ): boolean {
    const TRANSITIONS: Record<string, string[]> = {
      PENDING: ["ASSIGNED", "CANCELLED"],
      ASSIGNED: ["IN_PROGRESS", "SUBMITTED", "CANCELLED"],
      IN_PROGRESS: ["SUBMITTED", "CANCELLED"],
      SUBMITTED: ["APPROVED", "REJECTED"],
      REJECTED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
      APPROVED: [],
      CANCELLED: [],
    };
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) return false;
    if (["APPROVED", "REJECTED", "CANCELLED"].includes(to)) return isPrivileged;
    return isPrivileged || isAssignee;
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
  }
}

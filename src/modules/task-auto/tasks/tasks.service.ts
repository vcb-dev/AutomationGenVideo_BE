import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService } from "../../../common/push/push.service";
import { TaskAutoVideoService } from "../video/video.service";
import { TaskPublishedLinkStatsService } from "./task-published-link-stats.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  SubmitTaskDto,
  ReviewTaskDto,
  UpdatePublishedLinksDto,
} from "./task.dto";

// FE gửi deadline từ <input type="datetime-local"> — chuỗi này KHÔNG có timezone,
// nên new Date() mặc định hiểu theo giờ local của tiến trình Node. Ở local (máy VN) thì
// tình cờ đúng, nhưng server deploy (Docker) chạy UTC nên bị lệch 7 tiếng. Ép rõ +07:00
// để nhất quán bất kể server chạy timezone gì.
function parseVNDeadline(value: string): Date {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+07:00`);
  const withSeconds = /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  return new Date(`${withSeconds}+07:00`);
}

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
    private push: PushService,
    private linkStats: TaskPublishedLinkStatsService,
  ) {}

  // Bản include đầy đủ — dùng cho findOne (detail panel) và các mutation
  // (create/update/submit/review) trả về task để FE cập nhật cache/detail panel.
  private taskDetailInclude = {
    // leader_id thêm vào đây để update()/submit() đọc trực tiếp từ `updated.team.leader_id`
    // thay vì phải query lại team.findUnique riêng chỉ để lấy leader_id (xem bên dưới).
    team: { select: { id: true, name: true, leader_id: true } },
    content: {
      select: {
        id: true,
        code: true,
        title: true,
        market: true,
        status: true,
        content_line: { select: { id: true, name: true } },
        source_team_content: {
          select: {
            id: true,
            code: true,
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
                code: true,
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
        code: true,
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
        code: true,
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
            code: true,
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

  // Danh sách nhánh quan hệ trong taskDetailInclude phụ thuộc 1-1 vào 1 cột FK trên Task.
  // FK null → quan hệ luôn resolve về null dù có include hay không, nên include nó chỉ tốn
  // thêm JOIN/sub-query (nặng nhất là các nhánh to-many product.sources/editor_sources/
  // team_sources) mà không đổi kết quả. findOne() dùng danh sách này để chỉ include đúng
  // những nhánh có dữ liệu thật, dựa trên giá trị FK đọc trước đó.
  private readonly detailBranchByFk: [
    keyof typeof this.taskDetailInclude,
    string,
  ][] = [
    ["content", "content_id"],
    ["editor_content", "editor_content_id"],
    ["team_content", "team_content_id"],
    ["product", "product_id"],
    ["editor_product", "editor_product_id"],
    ["team_product", "team_product_id"],
    ["source_outro", "source_outro_id"],
    ["source_extra", "source_extra_id"],
    ["source_workshop", "source_workshop_id"],
    ["source_huyk", "source_huyk_id"],
    ["editor_source_outro", "editor_source_outro_id"],
    ["editor_source_extra", "editor_source_extra_id"],
    ["editor_source_workshop", "editor_source_workshop_id"],
    ["editor_source_huyk", "editor_source_huyk_id"],
    ["team_source_outro", "team_source_outro_id"],
    ["team_source_extra", "team_source_extra_id"],
    ["team_source_workshop", "team_source_workshop_id"],
    ["team_source_huyk", "team_source_huyk_id"],
  ];

  private buildDetailInclude(
    fk: Record<string, string | null>,
  ): typeof this.taskDetailInclude {
    const include: Record<string, unknown> = {
      team: this.taskDetailInclude.team,
      content_line: this.taskDetailInclude.content_line,
      assignee: this.taskDetailInclude.assignee,
      reviewed_by: this.taskDetailInclude.reviewed_by,
      pending_video: this.taskDetailInclude.pending_video,
    };
    for (const [relation, fkField] of this.detailBranchByFk) {
      if (fk[fkField]) include[relation] = this.taskDetailInclude[relation];
    }
    return include as typeof this.taskDetailInclude;
  }

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
      const dayStart = new Date(`${q.deadline_date}T00:00:00+07:00`);
      const dayEnd = new Date(`${q.deadline_date}T23:59:59.999+07:00`);
      // Task có deadline rơi vào ngày lọc; task chưa có deadline thì tính theo ngày tạo thay thế.
      where.OR = [
        { deadline: { gte: dayStart, lte: dayEnd } },
        { deadline: null, created_at: { gte: dayStart, lte: dayEnd } },
      ];
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
    // Pre-fetch rẻ (PK lookup, không JOIN) chỉ để biết nhánh quan hệ nào thực sự có dữ liệu,
    // tránh JOIN/sub-query thừa cho các FK null ở query detail bên dưới.
    const fk = await this.prisma.task.findUnique({
      where: { id },
      select: {
        content_id: true,
        editor_content_id: true,
        team_content_id: true,
        product_id: true,
        editor_product_id: true,
        team_product_id: true,
        source_outro_id: true,
        source_extra_id: true,
        source_workshop_id: true,
        source_huyk_id: true,
        editor_source_outro_id: true,
        editor_source_extra_id: true,
        editor_source_workshop_id: true,
        editor_source_huyk_id: true,
        team_source_outro_id: true,
        team_source_extra_id: true,
        team_source_workshop_id: true,
        team_source_huyk_id: true,
      },
    });
    if (!fk) throw new NotFoundException("Task not found");

    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...this.buildDetailInclude(fk),
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

    // Các nhánh bị bỏ qua ở include (vì FK null) không có key trong kết quả —
    // set về null để giữ nguyên shape response như bản include đầy đủ trước đây.
    for (const [relation] of this.detailBranchByFk) {
      if (!(relation in task)) (task as Record<string, unknown>)[relation] = null;
    }

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

    // Không dùng interactive transaction ($transaction(async tx => ...)) ở đây:
    // DATABASE_URL chạy qua Supabase pgbouncer (transaction-pooling mode, port 6543),
    // pooler có thể thu hồi connection giữa 2 lệnh trong 1 transaction đang mở, khiến
    // Prisma báo "Transaction API error: Transaction not found...". Tách thành 2 lệnh
    // độc lập để mỗi lệnh tự đóng gói trong 1 statement, tương thích với pgbouncer.
    if (dto.assignee_id && hasProduct) {
      const duplicate = await this.prisma.task.findFirst({
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

    const task = await this.prisma.task.create({
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
        deadline: dto.deadline ? parseVNDeadline(dto.deadline) : undefined,
        status: dto.assignee_id ? "ASSIGNED" : "PENDING",
        assigned_at: dto.assignee_id ? new Date() : undefined,
      },
      include: this.taskDetailInclude,
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
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { task_type: true, assignee_id: true, status: true, team_id: true },
    });
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
    if (dto.deadline) data.deadline = parseVNDeadline(dto.deadline);
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
      // updated.team đã có leader_id sẵn từ taskDetailInclude — không cần query team lại.
      if (updated.team.leader_id) {
        await this.notify(
          updated.team.leader_id,
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
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { assignee_id: true, status: true },
    });
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

    // updated.team đã có leader_id sẵn từ taskDetailInclude — không cần query team lại.
    if (updated.team.leader_id) {
      await this.notify(
        updated.team.leader_id,
        "TASK_SUBMITTED",
        "Task đã được nộp",
        id,
      );
    }

    return updated;
  }

  async review(id: string, dto: ReviewTaskDto, reviewerId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { status: true, assignee_id: true },
    });
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

  async updatePublishedLinks(
    id: string,
    dto: UpdatePublishedLinksDto,
    userId: string,
    roles: string[],
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { status: true, assignee_id: true, published_links: true },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (task.status !== "APPROVED") {
      throw new BadRequestException("Task chưa được duyệt");
    }

    const isPrivileged = roles.some((r) =>
      ["ADMIN", "MANAGER", "LEADER"].includes(r),
    );
    if (task.assignee_id !== userId && !isPrivileged) {
      throw new ForbiddenException("Không có quyền nộp link cho task này");
    }

    const links = dto.links
      .map((l) => ({
        id: l.id,
        platform: l.platform.trim(),
        url: l.url.trim(),
      }))
      .filter((l) => l.platform && l.url);

    // stats là dữ liệu do server tính (không nhận từ client) — chỉ giữ lại stats cũ
    // nếu link không đổi (cùng id, platform, url); link mới hoặc bị sửa url/platform
    // thì fetch lại ngay để hiển thị số liệu mới nhất cạnh link.
    const oldLinks = Array.isArray(task.published_links)
      ? (task.published_links as any[])
      : [];
    const oldById = new Map(oldLinks.map((l) => [l.id, l]));

    const linksWithStats = await Promise.all(
      links.map(async (l) => {
        const prev = oldById.get(l.id);
        if (prev && prev.url === l.url && prev.platform === l.platform && prev.stats) {
          return { ...l, stats: prev.stats };
        }
        const stats = await this.linkStats.fetchStatsForLink(l.platform, l.url);
        return { ...l, stats };
      }),
    );

    return this.prisma.task.update({
      where: { id },
      data: { published_links: linksWithStats },
      include: this.taskDetailInclude,
    });
  }

  // Làm mới thủ công số liệu tương tác cho 1 link đã nộp (nút "Làm mới" ở FE).
  async refreshPublishedLinkStats(
    id: string,
    linkId: string,
    userId: string,
    roles: string[],
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { assignee_id: true, published_links: true },
    });
    if (!task) throw new NotFoundException("Task not found");

    const isPrivileged = roles.some((r) =>
      ["ADMIN", "MANAGER", "LEADER"].includes(r),
    );
    if (task.assignee_id !== userId && !isPrivileged) {
      throw new ForbiddenException("Không có quyền làm mới số liệu cho task này");
    }

    const links = Array.isArray(task.published_links)
      ? (task.published_links as any[])
      : [];
    const target = links.find((l) => l.id === linkId);
    if (!target) throw new NotFoundException("Không tìm thấy link");

    const stats = await this.linkStats.fetchStatsForLink(target.platform, target.url);
    const next = links.map((l) => (l.id === linkId ? { ...l, stats } : l));

    return this.prisma.task.update({
      where: { id },
      data: { published_links: next },
      include: this.taskDetailInclude,
    });
  }

  // Tự động refresh số liệu tương tác (views/likes/comments/shares) mỗi sáng cho các
  // link bài đăng thuộc task được tạo trong tháng hiện tại. Lệch giờ 8:15 (thay vì
  // đúng 8:00) để tránh dồn tải cùng lúc với cron Douyin/Xiaohongshu (cũng 8h sáng)
  // — 2 cron độc lập, không chia sẻ resource nên chỉ là tránh dồn tải, không bắt buộc.
  // Platform chưa hỗ trợ (chưa qua TaskPublishedLinkStatsService) trả 'unsupported'
  // và bị bỏ qua êm — thêm platform mới sau này không cần sửa gì ở đây.
  @Cron("0 15 8 * * *", {
    name: "task-published-link-stats-refresh",
    timeZone: "Asia/Ho_Chi_Minh",
  })
  async refreshMonthlyPublishedLinkStats() {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const tasks = await this.prisma.task.findMany({
        where: { created_at: { gte: monthStart, lt: monthEnd } },
        select: { id: true, published_links: true },
      });

      const withLinks = tasks.filter(
        (t) => Array.isArray(t.published_links) && t.published_links.length > 0,
      );
      if (!withLinks.length) {
        this.logger.log(
          "[LINK-STATS-CRON] Không có task nào trong tháng có link cần refresh",
        );
        return;
      }

      let linkCount = 0;
      let successCount = 0;
      let failCount = 0;

      for (const task of withLinks) {
        const links = task.published_links as any[];
        const next: any[] = [];
        for (const link of links) {
          linkCount++;
          try {
            const stats = await this.linkStats.fetchStatsForLink(
              link.platform,
              link.url,
            );
            next.push({ ...link, stats });
            if (stats.status === "success") successCount++;
            else if (stats.status === "failed") failCount++;
          } catch (err: any) {
            next.push(link);
            failCount++;
            this.logger.warn(
              `[LINK-STATS-CRON] Task ${task.id} link ${link.id} lỗi: ${err.message}`,
            );
          }
        }
        await this.prisma.task.update({
          where: { id: task.id },
          data: { published_links: next },
        });
      }

      this.logger.log(
        `[LINK-STATS-CRON] Xong: ${withLinks.length} task, ${linkCount} link (${successCount} OK, ${failCount} lỗi/unsupported)`,
      );
    } catch (err: any) {
      this.logger.warn(`[LINK-STATS-CRON] failed: ${err.message}`);
    }
  }

  /** Parses "YYYY-MM-DD" date_from/date_to into an inclusive local-day Prisma range; null if absent/invalid. */
  private parseDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): { gte: Date; lt: Date } | null {
    if (!dateFrom || !dateTo) return null;
    const [fy, fm, fd] = dateFrom.split("-").map(Number);
    const [ty, tm, td] = dateTo.split("-").map(Number);
    if (!fy || !fm || !fd || !ty || !tm || !td) return null;
    const gte = new Date(fy, fm - 1, fd);
    const lt = new Date(ty, tm - 1, td + 1);
    if (isNaN(gte.getTime()) || isNaN(lt.getTime()) || gte >= lt) return null;
    return { gte, lt };
  }

  async getDashboard(
    userId: string,
    roles: string[],
    dateFrom?: string,
    dateTo?: string,
    /** "YYYY-MM" — tháng báo cáo cho leader dashboard (mặc định tháng hiện tại nếu bỏ trống/sai định dạng). */
    month?: string,
  ) {
    const range = this.parseDateRange(dateFrom, dateTo);
    const isAdminOrManager =
      roles.includes("ADMIN") || roles.includes("MANAGER");
    const isLeaderOnly = roles.includes("LEADER") && !isAdminOrManager;
    if (isAdminOrManager) return this.getGlobalDashboard(range);
    if (isLeaderOnly) return this.getLeaderDashboard(userId, range, month);
    return this.getPersonalDashboard(userId);
  }

  private async getGlobalDashboard(range: { gte: Date; lt: Date } | null) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const monthlyCompletedWhere = range
      ? { status: "APPROVED" as const, reviewed_at: range }
      : {
          status: "APPROVED" as const,
          reviewed_at: { gte: monthStart, lt: monthEnd },
        };

    const [
      tasksByStatus,
      todayDeadline,
      overdue,
      monthlyCompleted,
      totalEditors,
      approvedEditors,
      pendingApprovals,
    ] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["status"],
        where: range ? { created_at: range } : undefined,
        _count: { id: true },
      }),
      this.prisma.task.count({
        where: {
          status: { notIn: ["APPROVED", "CANCELLED"] },
          OR: [
            { deadline: { gte: todayStart, lt: todayEnd } },
            { deadline: null, created_at: { gte: todayStart, lt: todayEnd } },
          ],
        },
      }),
      this.prisma.task.count({
        where: {
          deadline: { lt: now },
          status: { notIn: ["APPROVED", "CANCELLED"] },
        },
      }),
      this.prisma.task.count({ where: monthlyCompletedWhere }),
      this.prisma.user.count({ where: { is_active: true } }),
      this.prisma.editorApproval.count({ where: { status: "APPROVED" } }),
      this.prisma.editorApproval.count({ where: { status: "PENDING" } }),
    ]);

    const taskMap = Object.fromEntries(
      tasksByStatus.map((r) => [r.status.toLowerCase(), r._count.id]),
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
      editors: {
        total: totalEditors,
        approved: approvedEditors,
        pending_approval: pendingApprovals,
      },
    };
  }

  private async getLeaderDashboard(
    leaderId: string,
    range: { gte: Date; lt: Date } | null,
    month?: string,
  ) {
    const now = new Date();
    const realCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Tháng báo cáo do leader chọn (bộ lọc tháng) — mặc định về tháng thực tế nếu bỏ trống/sai định dạng.
    const currentMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : realCurrentMonth;
    const [selYear, selMonthNum] = currentMonth.split("-").map(Number);
    const monthStart = new Date(selYear, selMonthNum - 1, 1);
    const monthEnd = new Date(selYear, selMonthNum, 1);
    // "KPI ngày" luôn tính theo NGÀY THỰC TẾ (hôm nay) — không phụ thuộc bộ lọc tháng, vì đây là
    // chỉ tiêu/tiến độ trong ngày, không có ý nghĩa khi xem lại một tháng đã qua.
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    // findMany (không phải findFirst): trên DB thật có leader lead CÙNG LÚC nhiều team (vd 1 người
    // lead cả "Scale Data", "Team K1", "MEDIA") — findFirst sẽ âm thầm chỉ trả 1 team, làm mất dữ
    // liệu các team còn lại của leader đó.
    const teamsLed = await this.prisma.team.findMany({
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

    if (teamsLed.length === 0)
      return {
        scope: "team" as const,
        team: null,
        tasks: { total: 0 },
        members: [],
        kpi: null,
        video_by_line: [],
      };

    const teamIds = teamsLed.map((t) => t.id);
    // Dedupe: về lý thuyết 1 user có thể là member của >1 team mà cùng 1 leader đang lead.
    const memberByUserId = new Map<string, (typeof teamsLed)[number]["members"][number]>();
    for (const t of teamsLed) {
      for (const m of t.members) memberByUserId.set(m.user_id, m);
    }
    const memberRows = Array.from(memberByUserId.values());
    const memberIds = memberRows.map((m) => m.user_id);
    const memberEmails = memberRows
      .map((m) => m.user?.email?.toLowerCase().trim())
      .filter((e): e is string => !!e);

    const [
      tasksByStatus,
      memberTaskRows,
      editorKpis,
      monthlyTeamApproved,
      monthlyMemberApproved,
      memberAssignedToday,
      memberApprovedToday,
      memberTrafficMonth,
      memberRevenueMonth,
      teamApprovedByContentLine,
      contentLines,
    ] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["status"],
        where: {
          team_id: { in: teamIds },
          ...(range ? { created_at: range } : {}),
        },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id", "status"],
        where: {
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
          ...(range ? { created_at: range } : {}),
        },
        _count: { id: true },
      }),
      this.prisma.editorKpi.findMany({
        where: { user_id: { in: memberIds }, month: currentMonth },
      }),
      this.prisma.task.count({
        where: {
          team_id: { in: teamIds },
          status: "APPROVED",
          reviewed_at: { gte: monthStart, lt: monthEnd },
        },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: "APPROVED",
          reviewed_at: { gte: monthStart, lt: monthEnd },
        },
        _count: { id: true },
      }),
      // "KPI ngày": mục tiêu ngày = số task có deadline rơi vào hôm nay; task chưa có deadline thì
      // tính theo ngày tạo (created_at) thay thế — thống nhất với Global/Personal Dashboard.
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
          OR: [
            { deadline: { gte: todayStart, lt: todayEnd } },
            { deadline: null, created_at: { gte: todayStart, lt: todayEnd } },
          ],
        },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: "APPROVED",
          reviewed_at: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),
      // Traffic báo cáo hằng ngày (TrafficReport, tách biệt task-auto) — khớp theo email vì field
      // `team` trên TrafficReport là text tự do, không đảm bảo khớp tên với Team.name của task-auto.
      memberEmails.length > 0
        ? this.prisma.trafficReport.groupBy({
            by: ["email"],
            where: {
              email: { in: memberEmails, mode: "insensitive" as any },
              date: { gte: monthStart, lt: monthEnd },
            },
            _sum: { total_traffic: true },
          })
        : Promise.resolve([]),
      // Doanh thu báo cáo hằng ngày (RevenueReport, cùng cơ chế với TrafficReport) — khớp theo email.
      memberEmails.length > 0
        ? this.prisma.revenueReport.groupBy({
            by: ["email"],
            where: {
              email: { in: memberEmails, mode: "insensitive" as any },
              date: { gte: monthStart, lt: monthEnd },
            },
            _sum: { total_revenue: true },
          })
        : Promise.resolve([]),
      // "TEAM - Số video theo tuyến": số task đã duyệt trong tháng của cả team, gộp theo tuyến
      // nội dung (ContentLine, vd A1-A5) — chỉ tính task có gắn content_line_id, không gộp task
      // không thuộc tuyến nào.
      this.prisma.task.groupBy({
        by: ["content_line_id"],
        where: {
          team_id: { in: teamIds },
          content_line_id: { not: null },
          status: "APPROVED",
          reviewed_at: { gte: monthStart, lt: monthEnd },
        },
        _count: { id: true },
      }),
      this.prisma.contentLine.findMany({ select: { id: true, name: true } }),
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
    const kpiApprovedByUser = Object.fromEntries(
      monthlyMemberApproved.map((r) => [r.assignee_id!, r._count.id]),
    );
    const assignedTodayByUser = Object.fromEntries(
      memberAssignedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    const approvedTodayByUser = Object.fromEntries(
      memberApprovedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    const trafficMonthByEmail = Object.fromEntries(
      memberTrafficMonth.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_traffic ?? 0n),
      ]),
    );
    const revenueMonthByEmail = Object.fromEntries(
      memberRevenueMonth.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_revenue ?? 0n),
      ]),
    );

    const approvedCountByContentLineId = Object.fromEntries(
      teamApprovedByContentLine.map((r) => [r.content_line_id as string, r._count.id]),
    );
    // Chỉ liệt kê tuyến A1-A5 (đúng thứ tự tên) — bỏ qua các ContentLine khác không thuộc mô hình
    // này để không làm loãng biểu đồ "Số video theo tuyến".
    const videoByLine = contentLines
      .filter((cl) => /^A[1-5]$/.test(cl.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cl) => ({ line: cl.name, count: approvedCountByContentLineId[cl.id] ?? 0 }));

    const kpiByUser = Object.fromEntries(editorKpis.map((k) => [k.user_id, k]));
    const members = memberRows.map((m) => {
      const kpi = kpiByUser[m.user_id];
      const email = m.user?.email ?? "";
      return {
        user_id: m.user_id,
        full_name: m.user?.full_name ?? "",
        email,
        pending: memberStats[m.user_id]?.["pending"] ?? 0,
        in_progress: memberStats[m.user_id]?.["in_progress"] ?? 0,
        submitted: memberStats[m.user_id]?.["submitted"] ?? 0,
        approved: memberStats[m.user_id]?.["approved"] ?? 0,
        kpi_completed: kpiApprovedByUser[m.user_id] ?? 0,
        kpi_target: kpi?.total_target ?? 0,
        kpi_video_win: kpi?.video_win ?? 0,
        kpi_content_new: kpi?.content_new ?? 0,
        kpi_product_planned: kpi?.product_planned ?? 0,
        /** Số task có deadline hôm nay (hoặc tạo hôm nay nếu chưa có deadline) — "mục tiêu" của KPI ngày. */
        kpi_day_target: assignedTodayByUser[m.user_id] ?? 0,
        /** Số task đã duyệt hôm nay — "hiện tại" của KPI ngày. */
        kpi_day_completed: approvedTodayByUser[m.user_id] ?? 0,
        /** Tổng traffic tự báo cáo hằng ngày, cộng dồn trong tháng hiện tại — chưa có KPI/mục tiêu. */
        traffic_month: trafficMonthByEmail[email.toLowerCase().trim()] ?? 0,
        /** Tổng doanh thu tự báo cáo hằng ngày, cộng dồn trong tháng hiện tại — chưa có KPI/mục tiêu. */
        revenue_month: revenueMonthByEmail[email.toLowerCase().trim()] ?? 0,
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

    return {
      scope: "team" as const,
      team: {
        id: teamsLed[0].id,
        name: teamsLed.map((t) => t.name).join(", "),
        member_count: memberRows.length,
      },
      tasks: {
        total: Object.values(taskMap).reduce((s, v) => s + v, 0),
        ...taskMap,
      },
      members,
      kpi: {
        month: currentMonth,
        total_target: kpiTotal,
        completed: monthlyTeamApproved,
        video_win: kpiVideoWin,
        content_new: kpiContentNew,
        product_planned: kpiProductPlanned,
      },
      /** Số video (task đã duyệt) trong tháng của cả team, gộp theo tuyến nội dung A1-A5. */
      video_by_line: videoByLine,
    };
  }

  /** "YYYY-MM" của mọi tháng bị [start, end] chạm tới — dùng để gộp EditorKpi (chỉ lưu theo THÁNG
   * trọn vẹn, không chia nhỏ theo ngày) khi khoảng ngày báo cáo là tự do, có thể xuyên nhiều tháng. */
  private monthsBetween(start: Date, end: Date): string[] {
    const months: string[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= last) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }

  /**
   * Báo cáo kiểu leader dashboard nhưng cho ADMIN/MANAGER xem theo TEAM bất kỳ (hoặc tổng hợp tất
   * cả team khi bỏ trống/`team === "all"`), theo khoảng ngày tự do (mặc định tháng hiện tại) —
   * khác với getLeaderDashboard vốn luôn khoá theo leader_id JWT và chỉ theo THÁNG trọn vẹn.
   * "KPI ngày" vẫn luôn tính theo NGÀY THỰC TẾ (hôm nay), không phụ thuộc khoảng ngày đã chọn.
   * `team` khớp theo Team.name (unique) — cùng quy ước với bộ lọc team hiện có ở AdminOverviewFiltersContext (FE).
   */
  async getTeamReport(team?: string, dateFrom?: string, dateTo?: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const range = this.parseDateRange(dateFrom, dateTo) ?? {
      gte: new Date(now.getFullYear(), now.getMonth(), 1),
      lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
    const monthsTouched = this.monthsBetween(range.gte, new Date(range.lt.getTime() - 1));

    const isAllTeams = !team || team === "all";

    const teams = await this.prisma.team.findMany({
      where: isAllTeams ? { is_active: true } : { name: team },
      include: {
        leader: { select: { full_name: true } },
        members: {
          where: { user: { is_active: true } },
          include: { user: { select: { id: true, full_name: true, email: true } } },
        },
      },
    });

    if (teams.length === 0) {
      return {
        scope: isAllTeams ? ("all_teams" as const) : ("single_team" as const),
        team: null,
        rows: [],
        video_by_line: [],
      };
    }

    const teamIds = teams.map((t) => t.id);
    const memberByUserId = new Map<
      string,
      { user_id: string; team_id: string; full_name: string; email: string }
    >();
    for (const t of teams) {
      for (const m of t.members) {
        memberByUserId.set(m.user_id, {
          user_id: m.user_id,
          team_id: t.id,
          full_name: m.user?.full_name ?? "",
          email: (m.user?.email ?? "").toLowerCase().trim(),
        });
      }
    }
    const memberRows = Array.from(memberByUserId.values());
    const memberIds = memberRows.map((m) => m.user_id);
    const memberEmails = memberRows.map((m) => m.email).filter((e): e is string => !!e);

    const [
      editorKpis,
      memberApprovedInRange,
      memberAssignedToday,
      memberApprovedToday,
      memberTrafficInRange,
      memberRevenueInRange,
      approvedByContentLine,
      contentLines,
    ] = await Promise.all([
      this.prisma.editorKpi.findMany({
        where: { user_id: { in: memberIds }, month: { in: monthsTouched } },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: { assignee_id: { in: memberIds }, status: "APPROVED", reviewed_at: range },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
          assigned_at: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: "APPROVED",
          reviewed_at: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),
      memberEmails.length > 0
        ? this.prisma.trafficReport.groupBy({
            by: ["email"],
            where: { email: { in: memberEmails, mode: "insensitive" as any }, date: range },
            _sum: { total_traffic: true },
          })
        : Promise.resolve([]),
      memberEmails.length > 0
        ? this.prisma.revenueReport.groupBy({
            by: ["email"],
            where: { email: { in: memberEmails, mode: "insensitive" as any }, date: range },
            _sum: { total_revenue: true },
          })
        : Promise.resolve([]),
      this.prisma.task.groupBy({
        by: ["content_line_id"],
        where: {
          team_id: { in: teamIds },
          content_line_id: { not: null },
          status: "APPROVED",
          reviewed_at: range,
        },
        _count: { id: true },
      }),
      this.prisma.contentLine.findMany({ select: { id: true, name: true } }),
    ]);

    const kpiTargetByUser: Record<string, number> = {};
    for (const k of editorKpis) {
      kpiTargetByUser[k.user_id] = (kpiTargetByUser[k.user_id] ?? 0) + k.total_target;
    }
    const approvedByUser = Object.fromEntries(
      memberApprovedInRange.map((r) => [r.assignee_id!, r._count.id]),
    );
    const assignedTodayByUser = Object.fromEntries(
      memberAssignedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    const approvedTodayByUser = Object.fromEntries(
      memberApprovedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    const trafficByEmail = Object.fromEntries(
      memberTrafficInRange.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_traffic ?? 0n),
      ]),
    );
    const revenueByEmail = Object.fromEntries(
      memberRevenueInRange.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_revenue ?? 0n),
      ]),
    );

    const perMember = memberRows.map((m) => ({
      id: m.user_id,
      team_id: m.team_id,
      name: m.full_name || m.email,
      kpi_completed: approvedByUser[m.user_id] ?? 0,
      kpi_target: kpiTargetByUser[m.user_id] ?? 0,
      kpi_day_completed: approvedTodayByUser[m.user_id] ?? 0,
      kpi_day_target: assignedTodayByUser[m.user_id] ?? 0,
      traffic_month: trafficByEmail[m.email] ?? 0,
      revenue_month: revenueByEmail[m.email] ?? 0,
    }));

    const approvedCountByContentLineId = Object.fromEntries(
      approvedByContentLine.map((r) => [r.content_line_id as string, r._count.id]),
    );
    const videoByLine = contentLines
      .filter((cl) => /^A[1-5]$/.test(cl.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cl) => ({ line: cl.name, count: approvedCountByContentLineId[cl.id] ?? 0 }));

    if (!isAllTeams) {
      return {
        scope: "single_team" as const,
        team: { id: teams[0].id, name: teams[0].name, member_count: memberRows.length },
        rows: perMember,
        video_by_line: videoByLine,
      };
    }

    // Chế độ "Tất cả Team" — gộp số liệu từng người về đúng team của họ.
    const teamAgg = new Map<
      string,
      {
        id: string;
        team_id: string;
        name: string;
        kpi_completed: number;
        kpi_target: number;
        kpi_day_completed: number;
        kpi_day_target: number;
        traffic_month: number;
        revenue_month: number;
      }
    >();
    for (const t of teams) {
      teamAgg.set(t.id, {
        id: t.id,
        team_id: t.id,
        name: t.leader?.full_name ? `${t.name} (${t.leader.full_name})` : t.name,
        kpi_completed: 0,
        kpi_target: 0,
        kpi_day_completed: 0,
        kpi_day_target: 0,
        traffic_month: 0,
        revenue_month: 0,
      });
    }
    for (const pm of perMember) {
      const agg = teamAgg.get(pm.team_id);
      if (!agg) continue;
      agg.kpi_completed += pm.kpi_completed;
      agg.kpi_target += pm.kpi_target;
      agg.kpi_day_completed += pm.kpi_day_completed;
      agg.kpi_day_target += pm.kpi_day_target;
      agg.traffic_month += pm.traffic_month;
      agg.revenue_month += pm.revenue_month;
    }

    return {
      scope: "all_teams" as const,
      team: null,
      rows: Array.from(teamAgg.values()),
      video_by_line: videoByLine,
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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [tasksByStatus, todayDeadline, overdue, monthlyApproved, myKpiRows] =
      await Promise.all([
        this.prisma.task.groupBy({
          by: ["status"],
          where: { assignee_id: userId },
          _count: { id: true },
        }),
        this.prisma.task.count({
          where: {
            assignee_id: userId,
            status: { notIn: ["APPROVED", "CANCELLED"] },
            OR: [
              { deadline: { gte: todayStart, lt: todayEnd } },
              { deadline: null, created_at: { gte: todayStart, lt: todayEnd } },
            ],
          },
        }),
        this.prisma.task.count({
          where: {
            assignee_id: userId,
            deadline: { lt: now },
            status: { notIn: ["APPROVED", "CANCELLED"] },
          },
        }),
        this.prisma.task.count({
          where: {
            assignee_id: userId,
            status: "APPROVED",
            reviewed_at: { gte: monthStart, lt: monthEnd },
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
    const completed = monthlyApproved;

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

  async remove(id: string, requesterId: string, roles: string[]) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { status: true, team_id: true },
    });
    if (!task) throw new NotFoundException("Task not found");

    const isAdminOrManager = roles.some((r) =>
      ["ADMIN", "MANAGER"].includes(r),
    );
    if (!isAdminOrManager) {
      // LEADER chỉ được xoá task thuộc team mình đang quản lý.
      const team = await this.prisma.team.findUnique({
        where: { id: task.team_id },
        select: { leader_id: true },
      });
      if (!team || team.leader_id !== requesterId) {
        throw new ForbiddenException(
          "Chỉ leader của team mới có thể xoá task của team mình",
        );
      }
    }

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
    this.push
      .sendToUser(userId, { title, url: "/dashboard/task-auto/tasks" })
      .catch(() => {});
  }
}

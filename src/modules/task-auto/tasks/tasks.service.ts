import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { PushService } from "../../../common/push/push.service";
import { TaskAutoVideoService } from "../video/video.service";
import { TaskPublishedLinkStatsService } from "./task-published-link-stats.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  QueryTaskHeaderCountsDto,
  SubmitTaskDto,
  ReviewTaskDto,
  UpdatePublishedLinksDto,
} from "./dto/task.dto";
import { dailyKpiDate, vietnamDateString } from "../../../utils/date.utils";
import { parseTeamIdFilter } from "../../../common/utils/team-membership.util";

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
    // market: FE dùng để biết editor đang làm task cho thị trường nào (xem ContentSection —
    // gợi ý dùng/dịch bản content sang đúng thị trường team khi content nguồn là tiếng Việt).
    team: { select: { id: true, name: true, leader_id: true, market: true } },
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
    const and: any[] = [];
    // Trạng thái coi như "xong việc" — task ở đây không tính trễ hạn dù deadline đã qua.
    // Phải khớp isOverdue() ở FE (src/components/task-auto/helpers.ts và PersonalDashboard.tsx).
    const doneStatuses = ["APPROVED", "CANCELLED"];

    const teamIdFilter = parseTeamIdFilter(q.team_id);
    if (teamIdFilter) where.team_id = teamIdFilter;
    if (q.assignee_id) where.assignee_id = q.assignee_id;
    if (q.task_type === "auto") where.task_type = "AUTO";
    if (q.task_type === "extra") where.task_type = "EXTRA";

    if (q.overdue === "true") {
      // Cột "Quá hạn" ảo (Kanban): không phải 1 status thật nên bỏ qua q.status/deadline_from/to/
      // deadline_date/month — trễ hạn tự neo theo thời điểm hiện tại, không phải khoảng ngày lọc thêm.
      and.push({ deadline: { lt: new Date() } });
      and.push({ status: { notIn: doneStatuses } });
    } else {
      if (q.status) where.status = q.status;
      if (q.deadline_from || q.deadline_to) {
        and.push(this.buildDeadlineRangeAnd(q.deadline_from, q.deadline_to)!);
      } else if (q.deadline_date) {
        const dayStart = new Date(`${q.deadline_date}T00:00:00+07:00`);
        const dayEnd = new Date(`${q.deadline_date}T23:59:59.999+07:00`);
        // Task có deadline rơi vào ngày lọc; task chưa có deadline thì tính theo ngày tạo thay thế.
        and.push({
          OR: [
            { deadline: { gte: dayStart, lte: dayEnd } },
            { deadline: null, created_at: { gte: dayStart, lte: dayEnd } },
          ],
        });
      } else if (q.month) {
        const start = new Date(`${q.month}-01`);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        where.created_at = { gte: start, lt: end };
      }

      if (q.exclude_overdue === "true") {
        // Task trễ hạn giờ dồn về cột "Quá hạn" riêng — loại khỏi các cột trạng thái khác
        // (trừ APPROVED/CANCELLED, vốn không tính trễ hạn) để tránh hiển thị trùng 2 nơi.
        and.push({
          OR: [
            { deadline: null },
            { deadline: { gte: new Date() } },
            { status: { in: doneStatuses } },
          ],
        });
      }
    }
    if (q.search) {
      where.content = { title: { contains: q.search, mode: "insensitive" } };
    }
    if (and.length) where.AND = and;

    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: this.taskListInclude,
        orderBy: [{ [q.sort ?? "created_at"]: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Khoảng ngày lọc theo hạn chót; task chưa có hạn chót thì tính theo ngày tạo thay thế — tách
  // riêng khỏi findAll() để dùng chung với getHeaderCounts(), tránh lệch ngữ nghĩa giữa 2 nơi.
  private buildDeadlineRangeAnd(from?: string, to?: string) {
    if (!from && !to) return null;
    const rangeStart = from ? new Date(`${from}T00:00:00+07:00`) : undefined;
    const rangeEnd = to ? new Date(`${to}T23:59:59.999+07:00`) : undefined;
    const bounds: { gte?: Date; lte?: Date } = {};
    if (rangeStart) bounds.gte = rangeStart;
    if (rangeEnd) bounds.lte = rangeEnd;
    return {
      OR: [
        { deadline: bounds },
        { deadline: null, created_at: bounds },
      ],
    };
  }

  // Đếm nhanh cho header ("N task") + badge "Video chờ duyệt" trên tasks/page.tsx — dùng count()
  // thuần (không kèm findMany như findAll()) vì FE chỉ cần con số, tránh tốn 1 lượt findMany thừa
  // cho mỗi lần gọi. Badge "Content chờ duyệt" đếm riêng ở ContentApprovalService.countPending()
  // vì khác bảng — controller gộp cả 2 lại bằng Promise.all (xem tasks.controller.ts).
  async getHeaderCounts(q: QueryTaskHeaderCountsDto) {
    const teamIdFilter = parseTeamIdFilter(q.team_id);

    const totalWhere: any = {};
    if (teamIdFilter) totalWhere.team_id = teamIdFilter;
    if (q.assignee_id) totalWhere.assignee_id = q.assignee_id;
    if (q.task_type === "auto") totalWhere.task_type = "AUTO";
    if (q.task_type === "extra") totalWhere.task_type = "EXTRA";
    if (q.status) totalWhere.status = q.status;
    if (q.search) {
      totalWhere.content = { title: { contains: q.search, mode: "insensitive" } };
    }
    const totalDeadlineAnd = this.buildDeadlineRangeAnd(q.deadline_from, q.deadline_to);
    if (totalDeadlineAnd) totalWhere.AND = [totalDeadlineAnd];

    // Badge "Video chờ duyệt": luôn status SUBMITTED, khoảng ngày riêng (pending_from/to) — khớp
    // SubmittedVideosGrid, KHÔNG dùng chung deadline_from/to của header.
    const submittedWhere: any = { status: "SUBMITTED" };
    if (teamIdFilter) submittedWhere.team_id = teamIdFilter;
    if (q.assignee_id) submittedWhere.assignee_id = q.assignee_id;
    if (q.search) {
      submittedWhere.content = { title: { contains: q.search, mode: "insensitive" } };
    }
    const submittedDeadlineAnd = this.buildDeadlineRangeAnd(q.pending_from, q.pending_to);
    if (submittedDeadlineAnd) submittedWhere.AND = [submittedDeadlineAnd];

    const [total, submittedTotal] = await Promise.all([
      this.prisma.task.count({ where: totalWhere }),
      this.prisma.task.count({ where: submittedWhere }),
    ]);
    return { total, submittedTotal };
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

    // Fallback về content_line_id của bản ghi gốc (source_editor_content / source_team_content)
    // khi field thô trên chính record bị null — cùng cách loadAssignmentPools (task-auto-assign.
    // service.ts) đã làm cho lane auto-assign. TeamContent/Content chỉ copy content_line_id tại
    // thời điểm push (copyEditorContentToTeam, pushTeamContentToGlobal — cái sau còn không copy
    // luôn), nên record cũ hoặc content gốc được gán tuyến sau khi đã push vẫn có thể null dù
    // nội dung thực sự thuộc 1 tuyến — thiếu fallback này khiến task tạo thủ công từ content đó
    // bị content_line_id = null và rơi khỏi "Số video theo tuyến nội dung" (getVideoByContentLine).
    let resolvedContentLineId: string | null = null;
    if (dto.content_id) {
      const content = await this.prisma.content.findUnique({
        where: { id: dto.content_id },
        select: {
          content_line_id: true,
          source_team_content: {
            select: {
              content_line_id: true,
              source_editor_content: { select: { content_line_id: true } },
            },
          },
        },
      });
      if (!content) throw new NotFoundException("Content not found");
      resolvedContentLineId =
        content.content_line_id ??
        content.source_team_content?.content_line_id ??
        content.source_team_content?.source_editor_content?.content_line_id ??
        null;
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
        select: {
          content_line_id: true,
          source_editor_content: { select: { content_line_id: true } },
        },
      });
      if (!tc) throw new NotFoundException("TeamContent not found");
      resolvedContentLineId =
        tc.content_line_id ?? tc.source_editor_content?.content_line_id ?? null;
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
        // Ghi nhận ai đã set assignee_id — dùng ở remove() để phân biệt member tự tạo/tự nhận
        // task (assigned_by_id === assignee_id, không bị khoá xoá) với leader giao tay
        // (assigned_by_id khác assignee_id, bị khoá xoá với thành viên thường).
        assigned_by_id: dto.assignee_id ? creatorId : undefined,
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
    if (dto.assignee_id !== undefined && dto.assignee_id !== task.assignee_id) {
      // Ghi nhận ai vừa set assignee_id (xem create() để biết cách dùng ở remove()). Member tự
      // nhận task (self-claim, nhánh !isPrivileged phía trên đã ép dto.assignee_id === userId)
      // → assigned_by_id === assignee_id, không bị khoá xoá. Leader/admin/manager giao hoặc
      // reassign cho người khác → assigned_by_id khác assignee_id, bị khoá xoá với thành viên.
      data.assigned_by_id = dto.assignee_id ? userId : null;
    }
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
    /** Chỉ áp dụng cho ADMIN/MANAGER (global dashboard) — thu hẹp mọi số liệu về 1 team/1 thành
     * viên cụ thể để "khoan sâu" thay vì chỉ xem tổng hệ thống. Bị bỏ qua ở nhánh LEADER/MEMBER vì
     * 2 nhánh đó đã tự khoanh phạm vi theo JWT (team mình lead / chính mình) rồi. */
    teamId?: string,
    assigneeId?: string,
  ) {
    const range = this.parseDateRange(dateFrom, dateTo);
    const isAdminOrManager =
      roles.includes("ADMIN") || roles.includes("MANAGER");
    const isLeaderOnly = roles.includes("LEADER") && !isAdminOrManager;
    if (isAdminOrManager) return this.getGlobalDashboard(range, teamId, assigneeId);
    if (isLeaderOnly) return this.getLeaderDashboard(userId, range, month);
    return this.getPersonalDashboard(userId, range);
  }

  /**
   * "Video/sản phẩm theo dòng sản phẩm" — tách riêng khỏi getDashboard() để FE load độc lập thay vì
   * gánh vào payload Tổng quan. Tự khoanh phạm vi theo role, CÙNG quy tắc với getDashboard():
   *  - ADMIN/MANAGER: toàn hệ thống, có thể khoan sâu qua team_id/assignee_id.
   *  - LEADER: tự động khoanh về (các) team đang lead — không nhận team_id/assignee_id (JWT quyết định).
   *  - MEMBER: tự động khoanh về chính mình.
   * Lọc theo `reviewed_at` (ngày duyệt) trong `range` — đúng bản chất "video đã hoàn thành trong kỳ",
   * khác với dashboard chính vốn lọc theo deadline để khớp Kanban. Không truyền range → mặc định
   * KHÔNG giới hạn ngày (khác getDashboard, vốn mặc định về tháng hiện tại cho KPI) vì endpoint này
   * không gắn với khái niệm "tháng KPI" nào cả.
   */
  async getProductVideoStatsForRole(
    userId: string,
    roles: string[],
    dateFrom?: string,
    dateTo?: string,
    teamId?: string,
    assigneeId?: string,
  ) {
    const range = this.parseDateRange(dateFrom, dateTo);
    const isAdminOrManager = roles.includes("ADMIN") || roles.includes("MANAGER");
    const isLeaderOnly = roles.includes("LEADER") && !isAdminOrManager;

    const baseWhere: Prisma.TaskWhereInput = {
      status: "APPROVED",
      ...(range ? { reviewed_at: range } : {}),
    };

    let where: Prisma.TaskWhereInput;
    if (isAdminOrManager) {
      where = {
        ...baseWhere,
        ...(teamId ? { team_id: teamId } : {}),
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
      };
    } else if (isLeaderOnly) {
      const teamsLed = await this.prisma.team.findMany({
        where: { leader_id: userId },
        select: { id: true },
      });
      const teamIds = teamsLed.map((t) => t.id);
      if (teamIds.length === 0) {
        return {
          video_by_product_line: [],
          products_with_video: 0,
          products_with_video_by_line: [],
          products_with_video_list: [],
        };
      }
      where = { ...baseWhere, team_id: { in: teamIds } };
    } else {
      where = { ...baseWhere, assignee_id: userId };
    }

    const stats = await this.getProductVideoStats(where);
    return {
      video_by_product_line: stats.video_by_line,
      products_with_video: stats.products_total,
      products_with_video_by_line: stats.products_by_line,
      products_with_video_list: stats.products,
    };
  }

  /** Gộp nhiều `Prisma.TaskWhereInput` bỏ qua điều kiện rỗng — giữ nguyên hình dạng `where` cũ khi
   * chỉ có 1 điều kiện thực (không bọc AND thừa) để không đổi hành vi/test hiện có khi không lọc
   * theo team/thành viên. */
  private mergeTaskWhere(...conditions: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput {
    const nonEmpty = conditions.filter((c) => c && Object.keys(c).length > 0);
    if (nonEmpty.length === 0) return {};
    if (nonEmpty.length === 1) return nonEmpty[0];
    return { AND: nonEmpty };
  }

  private async getGlobalDashboard(
    range: { gte: Date; lt: Date } | null,
    teamId?: string,
    assigneeId?: string,
  ) {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    // "Khoan sâu" theo team/thành viên cụ thể — orthogonal với bộ lọc ngày (range) và áp dụng cho
    // MỌI số liệu trên màn Tổng quan kể cả 2 cảnh báo "live" (today_deadline/overdue), vì đây là
    // trục lọc THEO AI chứ không phải THEO KHI NÀO.
    const scopeWhere: Prisma.TaskWhereInput = {
      ...(teamId ? { team_id: teamId } : {}),
      ...(assigneeId ? { assignee_id: assigneeId } : {}),
    };
    // Cùng 2 lớp lọc mà Kanban áp cho 4 cột không phải "Quá hạn" (xem TasksKanbanBoard.tsx +
    // findAll() ở q.deadline_from/to và q.exclude_overdue):
    // 1) Task có deadline rơi vào bộ lọc ngày; task chưa có deadline thì tính theo ngày tạo thay thế.
    // 2) Trừ task đang xử lý (chưa xong việc — khớp doneStatuses ở findAll()) đã trễ hạn — nhóm
    //    đó chỉ còn hiện ở "Quá hạn" (live, xem todayDeadline/overdue bên dưới), không tính trùng
    //    vào breakdown theo trạng thái nữa.
    const notOverdueOrDone: Prisma.TaskWhereInput = {
      OR: [
        { status: { in: ["APPROVED", "CANCELLED"] } },
        { deadline: null },
        { deadline: { gte: now } },
      ],
    };
    const dateWindow: Prisma.TaskWhereInput = range
      ? { OR: [{ deadline: range }, { deadline: null, created_at: range }] }
      : {};
    const tasksByStatusWhere: Prisma.TaskWhereInput = range
      ? this.mergeTaskWhere(dateWindow, notOverdueOrDone, scopeWhere)
      : this.mergeTaskWhere(notOverdueOrDone, scopeWhere);

    const [
      tasksByStatus,
      todayDeadline,
      overdue,
      totalEditors,
      approvedEditors,
      pendingApprovals,
      videoByLine,
    ] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["status"],
        where: tasksByStatusWhere,
        _count: { id: true },
      }),
      this.prisma.task.count({
        where: {
          ...scopeWhere,
          status: { notIn: ["APPROVED", "CANCELLED"] },
          OR: [
            { deadline: { gte: todayStart, lt: todayEnd } },
            { deadline: null, created_at: { gte: todayStart, lt: todayEnd } },
          ],
        },
      }),
      this.prisma.task.count({
        where: {
          ...scopeWhere,
          deadline: { lt: now },
          status: { notIn: ["APPROVED", "CANCELLED"] },
        },
      }),
      this.prisma.user.count({ where: { is_active: true } }),
      this.prisma.editorApproval.count({ where: { status: "APPROVED" } }),
      this.prisma.editorApproval.count({ where: { status: "PENDING" } }),
      // "Số video theo tuyến" toàn hệ thống — cùng cách lọc ngày với breakdown trạng thái ở trên
      // (deadline trong kỳ, task chưa có deadline thì theo ngày tạo) để khớp đúng "Đã duyệt" trong
      // kỳ đang hiển thị, thay vì lệch theo ngày duyệt (reviewed_at) như trước.
      this.getVideoByContentLine({ ...dateWindow, ...scopeWhere }),
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
      /** Task đã duyệt trong kỳ đang chọn — nay khớp 1-1 với `tasks.approved` (cùng cách lọc ngày
       * với tab "Nhiệm vụ"/Kanban) nên không cần đếm riêng theo reviewed_at nữa. */
      monthly_completed: taskMap.approved ?? 0,
      editors: {
        total: totalEditors,
        approved: approvedEditors,
        pending_approval: pendingApprovals,
      },
      /** Số video (task đã duyệt) trong kỳ, gộp theo tuyến nội dung A1-A5. */
      video_by_line: videoByLine,
      // "Video/sản phẩm theo dòng sản phẩm" đã tách sang GET /task-auto/product-video-stats
      // (getProductVideoStatsForRole) — không tính lặp lại ở đây nữa.
    };
  }

  private async getLeaderDashboard(
    leaderId: string,
    range: { gte: Date; lt: Date } | null,
    month?: string,
  ) {
    const now = new Date();
    const realCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Tháng dùng để tra KPI target (EditorKpi chỉ lưu target theo tháng, không có khái niệm target
    // cho một khoảng ngày tuỳ ý) và làm nhãn "KPI Team — Tháng X": ưu tiên `month` truyền tay (trang
    // /dashboard/leader riêng), kế đến tháng chứa ngày bắt đầu của bộ lọc ngày (trang Task Auto truyền
    // `range`), cuối cùng mới về tháng thực tế.
    const currentMonth =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : range
          ? `${range.gte.getFullYear()}-${String(range.gte.getMonth() + 1).padStart(2, "0")}`
          : realCurrentMonth;
    const [selYear, selMonthNum] = currentMonth.split("-").map(Number);
    const monthStart = new Date(selYear, selMonthNum - 1, 1);
    const monthEnd = new Date(selYear, selMonthNum, 1);
    // Khoảng thời gian dùng để tính SỐ THỰC TẾ trong kỳ (video đã duyệt, traffic, doanh thu, content
    // mới/cũ, sản phẩm...) — ưu tiên bộ lọc ngày (`range`) do trang Task Auto truyền xuống; không có
    // thì mặc định cả tháng đang xem, nhất quán với getGlobalDashboard.
    const periodRange = range ?? { gte: monthStart, lt: monthEnd };
    // "KPI ngày" luôn tính theo NGÀY THỰC TẾ (hôm nay) — không phụ thuộc bộ lọc ngày/tháng, vì đây là
    // chỉ tiêu/tiến độ trong ngày, không có ý nghĩa khi xem lại một kỳ đã qua.
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
            user: { select: { id: true, full_name: true, email: true, roles: true } },
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
        product_by_category: [],
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
      videoByLine,
      manualDailyKpis,
      contentFreshnessByUser,
      productByCategory,
      contentCreatorStats,
      approvedEditors,
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
          reviewed_at: periodRange,
        },
      }),
      this.prisma.task.groupBy({
        by: ["assignee_id"],
        where: {
          assignee_id: { in: memberIds },
          status: "APPROVED",
          reviewed_at: periodRange,
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
      // Lấy nguyên các dòng trong kỳ (không SUM ở query) — traffic là điểm cuối kỳ, phải quy về
      // đúng ngày báo cáo gần nhất của từng người ở sumTrafficOnLatestDate(), không cộng dồn cả kỳ.
      memberEmails.length > 0
        ? this.prisma.trafficReport.findMany({
            where: {
              email: { in: memberEmails, mode: "insensitive" as any },
              date: periodRange,
            },
            select: { email: true, date: true, total_traffic: true },
          })
        : Promise.resolve([]),
      // Doanh thu báo cáo hằng ngày (RevenueReport, cùng cơ chế với TrafficReport) — khớp theo email.
      memberEmails.length > 0
        ? this.prisma.revenueReport.groupBy({
            by: ["email"],
            where: {
              email: { in: memberEmails, mode: "insensitive" as any },
              date: periodRange,
            },
            _sum: { total_revenue: true },
          })
        : Promise.resolve([]),
      // "TEAM - Số video theo tuyến": số task đã duyệt trong kỳ của cả team, gộp theo tuyến
      // nội dung (ContentLine, vd A1-A5) — chỉ tính task có gắn content_line_id, không gộp task
      // không thuộc tuyến nào.
      this.getVideoByContentLine({
        team_id: { in: teamIds },
        reviewed_at: periodRange,
      }),
      // KPI ngày set tay (EditorDailyKpi) cho hôm nay — target = 0 coi như chưa set (lọc tại query).
      this.prisma.editorDailyKpi.findMany({
        where: {
          user_id: { in: memberIds },
          team_id: { in: teamIds },
          date: dailyKpiDate(vietnamDateString(now)),
          target: { gt: 0 },
        },
        select: { user_id: true, target: true },
      }),
      // "Content mới/cũ": content được thêm vào kho VÀ gắn vào task trong đúng kỳ đang xem (mới),
      // còn lại tính là cũ — khoá theo `periodRange` (bộ lọc ngày nếu có, không thì cả tháng đang xem).
      this.getContentFreshnessByAssignee(
        {
          team_id: { in: teamIds },
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
          created_at: periodRange,
        },
        periodRange,
      ),
      // "TEAM - SẢN PHẨM": số video đã duyệt trong kỳ của cả team, gộp theo dòng sản phẩm
      // (GMV/Traffic/Profit). Breakdown theo sản phẩm riêng biệt đã tách sang
      // GET /task-auto/product-video-stats (getProductVideoStatsForRole).
      this.getApprovedProductLineBreakdown({
        team_id: { in: teamIds },
        status: "APPROVED",
        reviewed_at: periodRange,
      }),
      // Số liệu content creator (target tháng, sưu tầm/tự nghĩ trong kỳ, KPI ngày) — song song hoàn
      // toàn với editorKpis/manualDailyKpis phía trên, chỉ áp dụng cho member có is_content_creator=true.
      this.getContentCreatorStats({
        teamIds,
        memberIds,
        periodRange,
        todayStart,
        todayEnd,
        months: [currentMonth],
      }),
      // Ai đã được duyệt làm editor (EditorApproval, toàn cục theo user — không theo team) — dùng
      // để loại thành viên chỉ mang vai trò quản lý (LEADER/ADMIN/MANAGER) khỏi danh sách card, xem
      // isDashboardVisibleMember().
      this.prisma.editorApproval.findMany({
        where: { user_id: { in: memberIds }, status: "APPROVED" },
        select: { user_id: true },
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
    const kpiApprovedByUser = Object.fromEntries(
      monthlyMemberApproved.map((r) => [r.assignee_id!, r._count.id]),
    );
    const assignedTodayByUser = Object.fromEntries(
      memberAssignedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    const approvedTodayByUser = Object.fromEntries(
      memberApprovedToday.map((r) => [r.assignee_id!, r._count.id]),
    );
    // user → KPI ngày set tay hôm nay (cộng dồn nếu thuộc nhiều team của cùng leader)
    const manualDayTargetByUser: Record<string, number> = {};
    for (const dk of manualDailyKpis) {
      manualDayTargetByUser[dk.user_id] =
        (manualDayTargetByUser[dk.user_id] ?? 0) + dk.target;
    }
    const trafficMonthByEmail = this.sumTrafficOnLatestDate(memberTrafficMonth);
    const revenueMonthByEmail = Object.fromEntries(
      memberRevenueMonth.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_revenue ?? 0n),
      ]),
    );

    // Chỉ hiện card cho thành viên thực sự sản xuất (content creator hoặc editor đã được duyệt) —
    // loại người chỉ mang vai trò quản lý (LEADER/ADMIN/MANAGER) nhưng chưa từng được gán editor/
    // content creator, dù họ luôn có mặt trong TeamMember của team mình lead (xem invariant ở
    // teams.service.ts create()/update()).
    const approvedEditorIds = new Set(approvedEditors.map((a) => a.user_id));
    const visibleMemberRows = memberRows.filter((m) =>
      this.isDashboardVisibleMember(m.is_content_creator, approvedEditorIds.has(m.user_id), m.user?.roles ?? []),
    );

    const kpiByUser = Object.fromEntries(editorKpis.map((k) => [k.user_id, k]));
    const members = visibleMemberRows.map((m) => {
      const kpi = kpiByUser[m.user_id];
      const email = m.user?.email ?? "";
      const isContentCreator = m.is_content_creator;
      const ccCollected = contentCreatorStats.collectedMonthByUser[m.user_id] ?? 0;
      const ccOriginal = contentCreatorStats.originalMonthByUser[m.user_id] ?? 0;
      return {
        user_id: m.user_id,
        full_name: m.user?.full_name ?? "",
        email,
        pending: memberStats[m.user_id]?.["pending"] ?? 0,
        in_progress: memberStats[m.user_id]?.["in_progress"] ?? 0,
        submitted: memberStats[m.user_id]?.["submitted"] ?? 0,
        approved: memberStats[m.user_id]?.["approved"] ?? 0,
        /** Content creator: tổng content sưu tầm + tự nghĩ trong kỳ; editor: số task đã duyệt
         * trong kỳ (như cũ). */
        kpi_completed: isContentCreator ? ccCollected + ccOriginal : kpiApprovedByUser[m.user_id] ?? 0,
        /** Content creator: ContentCreatorKpi.content_target; editor: EditorKpi.total_target. */
        kpi_target: isContentCreator
          ? contentCreatorStats.targetByUser[m.user_id] ?? 0
          : kpi?.total_target ?? 0,
        kpi_video_win: kpi?.video_win ?? 0,
        kpi_content_new: kpi?.content_new ?? 0,
        kpi_product_planned: kpi?.product_planned ?? 0,
        /** KPI ngày: content creator lấy từ ContentCreatorDailyKpi (không có fallback theo task vì
         * content creator không được giao task theo nghĩa video); editor ưu tiên số set tay
         * (EditorDailyKpi), chưa set → fallback số task có deadline hôm nay (hoặc tạo hôm nay nếu
         * chưa có deadline) như cũ. */
        kpi_day_target: isContentCreator
          ? contentCreatorStats.dayTargetByUser[m.user_id] ?? 0
          : manualDayTargetByUser[m.user_id] ?? assignedTodayByUser[m.user_id] ?? 0,
        /** Content creator: số content thêm vào kho hôm nay; editor: số task đã duyệt hôm nay. */
        kpi_day_completed: isContentCreator
          ? contentCreatorStats.dayCompletedByUser[m.user_id] ?? 0
          : approvedTodayByUser[m.user_id] ?? 0,
        /** Traffic tự báo cáo — lấy đúng ngày báo cáo gần nhất trong tháng (không cộng dồn qua các
         * ngày, vì traffic là điểm cuối kỳ), chưa có KPI/mục tiêu. */
        traffic_month: trafficMonthByEmail[email.toLowerCase().trim()] ?? 0,
        /** Tổng doanh thu tự báo cáo hằng ngày, cộng dồn trong tháng hiện tại — chưa có KPI/mục tiêu. */
        revenue_month: revenueMonthByEmail[email.toLowerCase().trim()] ?? 0,
        /** Số task trong kỳ dùng content thêm vào kho ĐÚNG NGÀY task được tạo. */
        content_new: contentFreshnessByUser[m.user_id]?.new ?? 0,
        /** Số task trong kỳ dùng content đã có từ TRƯỚC ngày task được tạo (tiêu thụ tồn kho). */
        content_old: contentFreshnessByUser[m.user_id]?.old ?? 0,
        is_content_creator: isContentCreator,
        content_collected_month: ccCollected,
        content_original_month: ccOriginal,
        /** Số content của người này đã được leader/admin/manager duyệt vào kho team trong kỳ. */
        content_approved_month: contentCreatorStats.approvedMonthByUser[m.user_id] ?? 0,
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
        member_count: visibleMemberRows.length,
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
      /** Số video (task đã duyệt) trong tháng của cả team, gộp theo dòng sản phẩm (GMV/Traffic/Profit). */
      product_by_category: productByCategory,
    };
  }

  /**
   * Số liệu content creator — song song hoàn toàn với logic editor (EditorKpi/EditorDailyKpi/task
   * APPROVED) nhưng đi theo đúng model của content creator: target tháng lấy từ
   * ContentCreatorKpi.content_target, "đã làm" tính từ TeamContent thật sự thêm vào kho trong kỳ
   * (gộp theo `origin`: COLLECTED = sưu tầm, SELF_CREATED = tự nghĩ), KPI ngày lấy từ
   * ContentCreatorDailyKpi (không có fallback theo task như editor — content creator không được
   * giao task theo nghĩa video). "Đã duyệt" đếm TeamPushRequest type CONTENT status APPROVED trong
   * kỳ — trước đây hiện riêng ở TeamStatsTab (trang Đội nhóm), nay gộp vào đây cho leader/admin xem
   * cùng chỗ với sưu tầm/tự nghĩ.
   */
  private async getContentCreatorStats(params: {
    teamIds: string[];
    memberIds: string[];
    periodRange: { gte: Date; lt: Date };
    todayStart: Date;
    todayEnd: Date;
    months: string[];
  }) {
    const result = {
      targetByUser: {} as Record<string, number>,
      collectedMonthByUser: {} as Record<string, number>,
      originalMonthByUser: {} as Record<string, number>,
      dayTargetByUser: {} as Record<string, number>,
      dayCompletedByUser: {} as Record<string, number>,
      approvedMonthByUser: {} as Record<string, number>,
    };
    const { teamIds, memberIds, periodRange, todayStart, todayEnd, months } = params;
    if (memberIds.length === 0) return result;

    const [kpis, contentByOrigin, dailyKpis, contentToday, approvedPushes] = await Promise.all([
      this.prisma.contentCreatorKpi.findMany({
        where: { user_id: { in: memberIds }, month: { in: months } },
      }),
      this.prisma.teamContent.groupBy({
        by: ["added_by_id", "origin"],
        where: { added_by_id: { in: memberIds }, team_id: { in: teamIds }, added_at: periodRange },
        _count: { id: true },
      }),
      this.prisma.contentCreatorDailyKpi.findMany({
        where: {
          user_id: { in: memberIds },
          team_id: { in: teamIds },
          date: dailyKpiDate(vietnamDateString(new Date())),
          target: { gt: 0 },
        },
        select: { user_id: true, target: true },
      }),
      this.prisma.teamContent.groupBy({
        by: ["added_by_id"],
        where: {
          added_by_id: { in: memberIds },
          team_id: { in: teamIds },
          added_at: { gte: todayStart, lt: todayEnd },
        },
        _count: { id: true },
      }),
      // Số content đã được leader/admin/manager duyệt vào kho team trong kỳ (TeamPushRequest type
      // CONTENT, status APPROVED, khoá theo reviewed_at) — trước đây hiện riêng ở TeamStatsTab (trang
      // Đội nhóm), nay gộp vào card content creator cho gọn, cùng chỗ với sưu tầm/tự nghĩ.
      this.prisma.teamPushRequest.groupBy({
        by: ["requested_by_id"],
        where: {
          requested_by_id: { in: memberIds },
          team_id: { in: teamIds },
          type: "CONTENT",
          status: "APPROVED",
          reviewed_at: periodRange,
        },
        _count: { id: true },
      }),
    ]);

    for (const k of kpis) {
      result.targetByUser[k.user_id] = (result.targetByUser[k.user_id] ?? 0) + k.content_target;
    }
    for (const g of contentByOrigin) {
      if (g.origin === "COLLECTED") {
        result.collectedMonthByUser[g.added_by_id] =
          (result.collectedMonthByUser[g.added_by_id] ?? 0) + g._count.id;
      } else if (g.origin === "SELF_CREATED") {
        result.originalMonthByUser[g.added_by_id] =
          (result.originalMonthByUser[g.added_by_id] ?? 0) + g._count.id;
      }
    }
    for (const dk of dailyKpis) {
      result.dayTargetByUser[dk.user_id] = (result.dayTargetByUser[dk.user_id] ?? 0) + dk.target;
    }
    for (const g of contentToday) {
      result.dayCompletedByUser[g.added_by_id] = g._count.id;
    }
    for (const g of approvedPushes) {
      result.approvedMonthByUser[g.requested_by_id] = g._count.id;
    }

    return result;
  }

  /**
   * Dashboard leader/admin chỉ thống kê thành viên THỰC SỰ sản xuất (editor/content creator) —
   * không phải mọi TeamMember. Leader (và đôi khi ADMIN/MANAGER) luôn có mặt trong TeamMember của
   * chính team họ quản lý (invariant kỹ thuật ở teams.service.ts create()/update(), không phải quy
   * ước nghiệp vụ), nên nếu không lọc thì tài khoản leader thuần quản lý sẽ hiện card KPI rỗng.
   * Quy tắc: hiện nếu là content creator, HOẶC đã được duyệt editor (EditorApproval APPROVED —
   * global theo user, không theo team), HOẶC không mang role quản lý nào (LEADER/ADMIN/MANAGER —
   * member thường mặc định vẫn được coi là editor như hành vi cũ, dù chưa qua duyệt). Chỉ ẩn đúng
   * trường hợp: role thuần quản lý VÀ chưa từng được gán editor/content creator.
   */
  private isDashboardVisibleMember(
    isContentCreator: boolean,
    isApprovedEditor: boolean,
    roles: string[],
  ): boolean {
    if (isContentCreator || isApprovedEditor) return true;
    const isManagementOnly = roles.some((r) => r === "LEADER" || r === "ADMIN" || r === "MANAGER");
    return !isManagementOnly;
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
   * TrafficReport là "điểm cuối kỳ", không phải phát sinh cộng dồn: mỗi lần nộp báo cáo tạo
   * NHIỀU dòng cùng 1 `date` (1 dòng/nền tảng — fb/ig/tiktok/...), nên cộng dồn ĐÚNG trong phạm vi
   * 1 ngày, nhưng SAI nếu cộng dồn qua nhiều ngày trong tháng. Vì vậy traffic của cả kỳ phải LẤY
   * đúng ngày báo cáo gần nhất của từng người (không phải sum cả tháng) — vd traffic tháng 8 = tổng
   * traffic của ngày 31/8, không phải tổng traffic từ 1/8 đến 31/8.
   */
  private sumTrafficOnLatestDate(
    rows: { email: string | null; date: Date | null; total_traffic: bigint | null }[],
  ): Record<string, number> {
    const latestDateByEmail = new Map<string, number>();
    for (const r of rows) {
      const email = (r.email ?? "").toLowerCase().trim();
      if (!email || !r.date) continue;
      const t = r.date.getTime();
      const cur = latestDateByEmail.get(email);
      if (cur === undefined || t > cur) latestDateByEmail.set(email, t);
    }
    const totals: Record<string, number> = {};
    for (const r of rows) {
      const email = (r.email ?? "").toLowerCase().trim();
      if (!email || !r.date) continue;
      if (r.date.getTime() !== latestDateByEmail.get(email)) continue;
      totals[email] = (totals[email] ?? 0) + Number(r.total_traffic ?? 0n);
    }
    return totals;
  }

  /**
   * "Content mới" vs "Content cũ" trong 1 kỳ lọc (`period`): với mỗi task trong `where` (đã bị khoá
   * created_at nằm trong `period` ở call site — "gắn vào task trong khoảng thời gian lọc"), tra ngày
   * thêm vào kho của content đã dùng (content_id → Content.created_at, editor_content_id →
   * EditorContent.added_at, team_content_id → TeamContent.added_at — mỗi task chỉ có đúng 1 trong 3
   * field này được set). Content đó được thêm vào kho ĐÚNG TRONG `period` → "content mới" (task dùng
   * content vừa bổ sung trong kỳ); còn lại — thêm từ trước kỳ, hoặc task không gắn content nào — đều
   * tính là "content cũ" (số task còn lại không gắn với content mới). Gộp theo assignee_id — task
   * không có assignee bị bỏ qua (không tính vào mẫu số).
   */
  private async getContentFreshnessByAssignee(
    where: Prisma.TaskWhereInput,
    period: { gte: Date; lt: Date },
  ): Promise<Record<string, { new: number; old: number }>> {
    const rows = await this.prisma.task.findMany({
      where,
      select: {
        assignee_id: true,
        content_id: true,
        editor_content_id: true,
        team_content_id: true,
      },
    });

    const contentIds = [
      ...new Set(rows.map((r) => r.content_id).filter((id): id is string => !!id)),
    ];
    const editorContentIds = [
      ...new Set(rows.map((r) => r.editor_content_id).filter((id): id is string => !!id)),
    ];
    const teamContentIds = [
      ...new Set(rows.map((r) => r.team_content_id).filter((id): id is string => !!id)),
    ];

    const [contents, editorContents, teamContents] = await Promise.all([
      contentIds.length > 0
        ? this.prisma.content.findMany({
            where: { id: { in: contentIds } },
            select: { id: true, created_at: true },
          })
        : Promise.resolve([]),
      editorContentIds.length > 0
        ? this.prisma.editorContent.findMany({
            where: { id: { in: editorContentIds } },
            select: { id: true, added_at: true },
          })
        : Promise.resolve([]),
      teamContentIds.length > 0
        ? this.prisma.teamContent.findMany({
            where: { id: { in: teamContentIds } },
            select: { id: true, added_at: true },
          })
        : Promise.resolve([]),
    ]);

    const contentDateById = new Map(contents.map((c) => [c.id, c.created_at]));
    const editorContentDateById = new Map(editorContents.map((c) => [c.id, c.added_at]));
    const teamContentDateById = new Map(teamContents.map((c) => [c.id, c.added_at]));

    const result: Record<string, { new: number; old: number }> = {};
    for (const r of rows) {
      if (!r.assignee_id) continue;
      const contentAddedAt =
        (r.content_id && contentDateById.get(r.content_id)) ||
        (r.editor_content_id && editorContentDateById.get(r.editor_content_id)) ||
        (r.team_content_id && teamContentDateById.get(r.team_content_id)) ||
        null;
      const bucket = (result[r.assignee_id] ??= { new: 0, old: 0 });
      const isNew = !!contentAddedAt && contentAddedAt >= period.gte && contentAddedAt < period.lt;
      if (isNew) {
        bucket.new++;
      } else {
        bucket.old++;
      }
    }
    return result;
  }

  /**
   * "Số video theo tuyến nội dung": với mỗi task APPROVED khớp `where` có gắn content_line_id, đếm
   * số lượng theo ContentLine. Chỉ liệt kê tuyến A1-A5 (đúng thứ tự tên) — bỏ qua các ContentLine
   * khác không thuộc mô hình này để không làm loãng báo cáo. Dùng chung cho Global/Team/Personal/
   * TeamReport dashboard — mỗi nơi tự truyền `where` phù hợp phạm vi + khoảng thời gian của mình
   * (hàm này tự thêm `status: APPROVED` và `content_line_id: { not: null }`).
   */
  private async getVideoByContentLine(
    where: Prisma.TaskWhereInput,
  ): Promise<{ line: string; count: number }[]> {
    const [approvedByContentLine, contentLines] = await Promise.all([
      this.prisma.task.groupBy({
        by: ["content_line_id"],
        where: { ...where, content_line_id: { not: null }, status: "APPROVED" },
        _count: { id: true },
      }),
      this.prisma.contentLine.findMany({ select: { id: true, name: true } }),
    ]);

    const countByLineId = Object.fromEntries(
      approvedByContentLine.map((r) => [r.content_line_id as string, r._count.id]),
    );
    return contentLines
      .filter((cl) => /^A[1-5]$/.test(cl.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cl) => ({ line: cl.name, count: countByLineId[cl.id] ?? 0 }));
  }

  /**
   * "SẢN PHẨM" (GMV/Traffic/Profit): với mỗi task trong `where` (thường lọc thêm status: APPROVED),
   * xác định ProductLine của nó — ưu tiên Task.product_line_id (denormalized), fallback sang
   * product_id/editor_product_id/team_product_id → product_line_id của Product/EditorProduct/
   * TeamProduct tương ứng (mỗi task chỉ có tối đa 1 trong 3 field này được set). Nhãn nhóm =
   * ProductLine.video_category nếu có set, nếu không thì fallback về chính ProductLine.name viết hoa
   * (thực tế hiện tại các team đặt tên dòng SP thẳng là "GMV"/"Traffic"/"Profit" thay vì set field
   * video_category riêng). Task không xác định được dòng sản phẩm nào bị bỏ qua khỏi breakdown theo
   * dòng (không tính vào mẫu số `video_by_line`/`products_by_line`).
   *
   * Đồng thời tính "sản phẩm được làm video": số SẢN PHẨM RIÊNG BIỆT (distinct) đứng sau các task
   * trên — định danh 1 sản phẩm = giá trị của field product_id/editor_product_id/team_product_id có
   * mặt trên task đó (tối đa 1 trong 3 field được set/task, giống hệt quy ước xác định dòng sản phẩm
   * ở trên) — khác với `video_by_line` vốn đếm THEO TASK nên 1 sản phẩm được làm lại nhiều video sẽ
   * bị đếm nhiều lần. Task chỉ có product_line_id (không gắn sản phẩm cụ thể nào) không tính vào đây.
   *
   * `products`: breakdown THEO TỪNG SẢN PHẨM riêng lẻ (tên/sku/dòng/số video) — tên hiển thị resolve
   * qua đúng chuỗi fallback đã dùng ở FE (CreateTaskModal.tsx/TasksTable.tsx/TeamProductsTab.tsx):
   * Product → source_team_product → source_team_product.source_editor_product, hoặc
   * TeamProduct → source_editor_product — vì Product/TeamProduct có thể có name/sku NULL khi dữ liệu
   * thật nằm ở bản ghi nguồn (được push/kéo từ kho khác).
   */
  private async getProductVideoStats(where: Prisma.TaskWhereInput): Promise<{
    video_by_line: { category: string; count: number }[];
    products_total: number;
    products_by_line: { category: string; count: number }[];
    products: { id: string; name: string; sku: string | null; category: string | null; video_count: number }[];
  }> {
    const rows = await this.prisma.task.findMany({
      where,
      select: {
        product_line_id: true,
        product_id: true,
        editor_product_id: true,
        team_product_id: true,
      },
    });

    const productIds = [
      ...new Set(rows.map((r) => r.product_id).filter((id): id is string => !!id)),
    ];
    const editorProductIds = [
      ...new Set(rows.map((r) => r.editor_product_id).filter((id): id is string => !!id)),
    ];
    const teamProductIds = [
      ...new Set(rows.map((r) => r.team_product_id).filter((id): id is string => !!id)),
    ];

    const [products, editorProducts, teamProducts, productLines] = await Promise.all([
      productIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              product_line_id: true,
              name: true,
              sku: true,
              source_team_product: {
                select: {
                  name: true,
                  sku: true,
                  source_editor_product: { select: { name: true, sku: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      editorProductIds.length > 0
        ? this.prisma.editorProduct.findMany({
            where: { id: { in: editorProductIds } },
            select: { id: true, product_line_id: true, name: true, sku: true },
          })
        : Promise.resolve([]),
      teamProductIds.length > 0
        ? this.prisma.teamProduct.findMany({
            where: { id: { in: teamProductIds } },
            select: {
              id: true,
              product_line_id: true,
              name: true,
              sku: true,
              source_editor_product: { select: { name: true, sku: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.productLine.findMany({ select: { id: true, name: true, video_category: true } }),
    ]);

    const productLineIdByProductId = new Map(products.map((p) => [p.id, p.product_line_id]));
    const productLineIdByEditorProductId = new Map(
      editorProducts.map((p) => [p.id, p.product_line_id]),
    );
    const productLineIdByTeamProductId = new Map(teamProducts.map((p) => [p.id, p.product_line_id]));
    const categoryByLineId = new Map(
      productLines.map((l) => [l.id, (l.video_category || l.name || "").toUpperCase()]),
    );

    const productById = new Map(products.map((p) => [p.id, p]));
    const editorProductById = new Map(editorProducts.map((p) => [p.id, p]));
    const teamProductById = new Map(teamProducts.map((p) => [p.id, p]));

    const videoCountByCategory: Record<string, number> = {};
    const distinctProductKeys = new Set<string>();
    const distinctByCategory = new Map<string, Set<string>>();
    const videoCountByProductKey = new Map<string, number>();
    const categoryByProductKey = new Map<string, string | null>();

    for (const r of rows) {
      const lineId =
        r.product_line_id ??
        (r.product_id ? productLineIdByProductId.get(r.product_id) : null) ??
        (r.editor_product_id ? productLineIdByEditorProductId.get(r.editor_product_id) : null) ??
        (r.team_product_id ? productLineIdByTeamProductId.get(r.team_product_id) : null) ??
        null;
      const category = lineId ? categoryByLineId.get(lineId) : undefined;
      if (category) {
        videoCountByCategory[category] = (videoCountByCategory[category] ?? 0) + 1;
      }

      const productKey = r.product_id ?? r.editor_product_id ?? r.team_product_id ?? null;
      if (productKey) {
        distinctProductKeys.add(productKey);
        videoCountByProductKey.set(productKey, (videoCountByProductKey.get(productKey) ?? 0) + 1);
        categoryByProductKey.set(productKey, category ?? null);
        if (category) {
          if (!distinctByCategory.has(category)) distinctByCategory.set(category, new Set());
          distinctByCategory.get(category)!.add(productKey);
        }
      }
    }

    const productsList = [...videoCountByProductKey.entries()].map(([key, video_count]) => {
      const p = productById.get(key);
      const ep = editorProductById.get(key);
      const tp = teamProductById.get(key);
      const name =
        p?.name ??
        p?.source_team_product?.name ??
        p?.source_team_product?.source_editor_product?.name ??
        ep?.name ??
        tp?.name ??
        tp?.source_editor_product?.name ??
        null;
      const sku =
        p?.sku ??
        p?.source_team_product?.sku ??
        p?.source_team_product?.source_editor_product?.sku ??
        ep?.sku ??
        tp?.sku ??
        tp?.source_editor_product?.sku ??
        null;
      return {
        id: key,
        name: name ?? "(Chưa đặt tên)",
        sku,
        category: categoryByProductKey.get(key) ?? null,
        video_count,
      };
    }).sort((a, b) => b.video_count - a.video_count || a.name.localeCompare(b.name));

    return {
      video_by_line: Object.entries(videoCountByCategory).map(([category, count]) => ({
        category,
        count,
      })),
      products_total: distinctProductKeys.size,
      products_by_line: [...distinctByCategory.entries()].map(([category, set]) => ({
        category,
        count: set.size,
      })),
      products: productsList,
    };
  }

  /** Giữ nguyên tên/behaviour cho các call site cũ (getLeaderDashboard, getTeamReport) — chỉ trả phần
   * "video theo dòng sản phẩm" của getProductVideoStats(). */
  private async getApprovedProductLineBreakdown(
    where: Prisma.TaskWhereInput,
  ): Promise<{ category: string; count: number }[]> {
    return (await this.getProductVideoStats(where)).video_by_line;
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
          include: { user: { select: { id: true, full_name: true, email: true, roles: true } } },
        },
      },
    });

    if (teams.length === 0) {
      return {
        scope: isAllTeams ? ("all_teams" as const) : ("single_team" as const),
        team: null,
        rows: [],
        video_by_line: [],
        product_by_category: [],
      };
    }

    const teamIds = teams.map((t) => t.id);
    const memberByUserId = new Map<
      string,
      {
        user_id: string;
        team_id: string;
        full_name: string;
        email: string;
        is_content_creator: boolean;
        roles: string[];
      }
    >();
    for (const t of teams) {
      for (const m of t.members) {
        memberByUserId.set(m.user_id, {
          user_id: m.user_id,
          team_id: t.id,
          full_name: m.user?.full_name ?? "",
          email: (m.user?.email ?? "").toLowerCase().trim(),
          is_content_creator: m.is_content_creator,
          roles: m.user?.roles ?? [],
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
      videoByLine,
      manualDailyKpis,
      contentFreshnessByUser,
      productByCategory,
      contentCreatorStats,
      approvedEditors,
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
      // Lấy nguyên các dòng trong `range` (không SUM ở query) — traffic là điểm cuối kỳ, phải quy về
      // đúng ngày báo cáo gần nhất của từng người ở sumTrafficOnLatestDate(), không cộng dồn cả kỳ.
      memberEmails.length > 0
        ? this.prisma.trafficReport.findMany({
            where: { email: { in: memberEmails, mode: "insensitive" as any }, date: range },
            select: { email: true, date: true, total_traffic: true },
          })
        : Promise.resolve([]),
      memberEmails.length > 0
        ? this.prisma.revenueReport.groupBy({
            by: ["email"],
            where: { email: { in: memberEmails, mode: "insensitive" as any }, date: range },
            _sum: { total_revenue: true },
          })
        : Promise.resolve([]),
      this.getVideoByContentLine({
        team_id: { in: teamIds },
        reviewed_at: range,
      }),
      // KPI ngày set tay (EditorDailyKpi) cho hôm nay — target = 0 coi như chưa set (lọc tại query).
      this.prisma.editorDailyKpi.findMany({
        where: {
          user_id: { in: memberIds },
          team_id: { in: teamIds },
          date: dailyKpiDate(vietnamDateString(now)),
          target: { gt: 0 },
        },
        select: { user_id: true, target: true },
      }),
      // "Content mới/cũ": content được thêm vào kho VÀ gắn vào task trong đúng kỳ đang lọc (mới),
      // còn lại tính là cũ.
      this.getContentFreshnessByAssignee(
        {
          team_id: { in: teamIds },
          assignee_id: { in: memberIds },
          status: { notIn: ["CANCELLED"] },
          created_at: range,
        },
        range,
      ),
      // "SẢN PHẨM": số video đã duyệt trong kỳ, gộp theo dòng sản phẩm (GMV/Traffic/Profit).
      this.getApprovedProductLineBreakdown({
        team_id: { in: teamIds },
        status: "APPROVED",
        reviewed_at: range,
      }),
      // Số liệu content creator (target tháng, sưu tầm/tự nghĩ trong kỳ, KPI ngày) — song song hoàn
      // toàn với editorKpis/manualDailyKpis phía trên, chỉ áp dụng cho member có is_content_creator=true.
      this.getContentCreatorStats({
        teamIds,
        memberIds,
        periodRange: range,
        todayStart,
        todayEnd,
        months: monthsTouched,
      }),
      // Ai đã được duyệt làm editor (EditorApproval, toàn cục theo user — không theo team) — dùng
      // để loại thành viên chỉ mang vai trò quản lý (LEADER/ADMIN/MANAGER) khỏi danh sách card, xem
      // isDashboardVisibleMember().
      this.prisma.editorApproval.findMany({
        where: { user_id: { in: memberIds }, status: "APPROVED" },
        select: { user_id: true },
      }),
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
    const trafficByEmail = this.sumTrafficOnLatestDate(memberTrafficInRange);
    const revenueByEmail = Object.fromEntries(
      memberRevenueInRange.map((r) => [
        (r.email ?? "").toLowerCase().trim(),
        Number(r._sum.total_revenue ?? 0n),
      ]),
    );

    // user → KPI ngày set tay hôm nay (cộng dồn nếu 1 người thuộc nhiều team trong phạm vi xem)
    const manualDayTargetByUser: Record<string, number> = {};
    for (const dk of manualDailyKpis) {
      manualDayTargetByUser[dk.user_id] =
        (manualDayTargetByUser[dk.user_id] ?? 0) + dk.target;
    }

    // Chỉ hiện card cho thành viên thực sự sản xuất (content creator hoặc editor đã được duyệt) —
    // loại người chỉ mang vai trò quản lý (LEADER/ADMIN/MANAGER) nhưng chưa từng được gán editor/
    // content creator, dù họ luôn có mặt trong TeamMember của team mình lead/quản lý.
    const approvedEditorIds = new Set(approvedEditors.map((a) => a.user_id));
    const visibleMemberRows = memberRows.filter((m) =>
      this.isDashboardVisibleMember(m.is_content_creator, approvedEditorIds.has(m.user_id), m.roles),
    );

    const perMember = visibleMemberRows.map((m) => {
      const isContentCreator = m.is_content_creator;
      const ccCollected = contentCreatorStats.collectedMonthByUser[m.user_id] ?? 0;
      const ccOriginal = contentCreatorStats.originalMonthByUser[m.user_id] ?? 0;
      return {
        id: m.user_id,
        team_id: m.team_id,
        name: m.full_name || m.email,
        is_content_creator: isContentCreator,
        /** Content creator: tổng content sưu tầm + tự nghĩ trong kỳ; editor: số task đã duyệt
         * trong kỳ (như cũ). */
        kpi_completed: isContentCreator ? ccCollected + ccOriginal : approvedByUser[m.user_id] ?? 0,
        /** Content creator: ContentCreatorKpi.content_target; editor: tổng EditorKpi.total_target. */
        kpi_target: isContentCreator
          ? contentCreatorStats.targetByUser[m.user_id] ?? 0
          : kpiTargetByUser[m.user_id] ?? 0,
        /** Content creator: số content thêm vào kho hôm nay; editor: số task đã duyệt hôm nay. */
        kpi_day_completed: isContentCreator
          ? contentCreatorStats.dayCompletedByUser[m.user_id] ?? 0
          : approvedTodayByUser[m.user_id] ?? 0,
        // KPI ngày: content creator lấy ContentCreatorDailyKpi (không fallback theo task); editor
        // ưu tiên số set tay (EditorDailyKpi), chưa set → fallback số task giao hôm nay.
        kpi_day_target: isContentCreator
          ? contentCreatorStats.dayTargetByUser[m.user_id] ?? 0
          : manualDayTargetByUser[m.user_id] ?? assignedTodayByUser[m.user_id] ?? 0,
        traffic_month: trafficByEmail[m.email] ?? 0,
        revenue_month: revenueByEmail[m.email] ?? 0,
        content_new: contentFreshnessByUser[m.user_id]?.new ?? 0,
        content_old: contentFreshnessByUser[m.user_id]?.old ?? 0,
        content_collected_month: ccCollected,
        content_original_month: ccOriginal,
        content_approved_month: contentCreatorStats.approvedMonthByUser[m.user_id] ?? 0,
      };
    });

    if (!isAllTeams) {
      return {
        scope: "single_team" as const,
        team: { id: teams[0].id, name: teams[0].name, member_count: visibleMemberRows.length },
        rows: perMember,
        video_by_line: videoByLine,
        product_by_category: productByCategory,
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
        content_new: number;
        content_old: number;
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
        content_new: 0,
        content_old: 0,
      });
    }
    for (const pm of perMember) {
      const agg = teamAgg.get(pm.team_id);
      if (!agg) continue;
      // Không cộng dồn kpi_completed/target/ngày của content creator vào tổng — đơn vị tính là
      // "content", không phải "video", gộp chung sẽ làm sai lệch tổng video của cả team.
      if (!pm.is_content_creator) {
        agg.kpi_completed += pm.kpi_completed;
        agg.kpi_target += pm.kpi_target;
        agg.kpi_day_completed += pm.kpi_day_completed;
        agg.kpi_day_target += pm.kpi_day_target;
      }
      agg.traffic_month += pm.traffic_month;
      agg.revenue_month += pm.revenue_month;
      agg.content_new += pm.content_new;
      agg.content_old += pm.content_old;
    }

    return {
      scope: "all_teams" as const,
      team: null,
      rows: Array.from(teamAgg.values()),
      video_by_line: videoByLine,
      product_by_category: productByCategory,
    };
  }

  private async getPersonalDashboard(
    userId: string,
    range: { gte: Date; lt: Date } | null,
  ) {
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
    // Bộ lọc ngày của trang (nếu có) — dùng cho video_by_line, KHÔNG dùng cho KPI tháng
    // (myKpiRows/monthlyApproved) vì KPI target vốn chỉ có khái niệm theo THÁNG trọn vẹn, không chia
    // nhỏ theo khoảng ngày tự do.
    const periodRange = range ?? { gte: monthStart, lt: monthEnd };

    const [
      tasksByStatus,
      todayDeadline,
      overdue,
      monthlyApproved,
      myKpiRows,
      myDailyKpiAgg,
      videoByLine,
    ] = await Promise.all([
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
        // KPI ngày set tay của chính editor cho hôm nay (cộng dồn nếu thuộc nhiều team)
        this.prisma.editorDailyKpi.aggregate({
          where: {
            user_id: userId,
            date: dailyKpiDate(vietnamDateString(now)),
            target: { gt: 0 },
          },
          _sum: { target: true },
        }),
        // "Số video theo tuyến" của riêng editor này — theo bộ lọc ngày của trang (mặc định cả
        // tháng hiện tại nếu trang không truyền). "Video/sản phẩm theo dòng sản phẩm" đã tách sang
        // GET /task-auto/product-video-stats (getProductVideoStatsForRole).
        this.getVideoByContentLine({
          assignee_id: userId,
          reviewed_at: periodRange,
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
      /** KPI ngày set tay cho hôm nay (0 = chưa set) — hiển thị "Mục tiêu hôm nay" cá nhân. */
      daily_kpi_target: myDailyKpiAgg._sum.target ?? 0,
      /** Số video (task đã duyệt) của chính mình trong kỳ, gộp theo tuyến nội dung A1-A5. */
      video_by_line: videoByLine,
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
      select: {
        status: true,
        team_id: true,
        assignee_id: true,
        assigned_by_id: true,
        run_id: true,
      },
    });
    if (!task) throw new NotFoundException("Task not found");

    const isAdminOrManager = roles.some((r) =>
      ["ADMIN", "MANAGER"].includes(r),
    );
    if (isAdminOrManager) {
      await this.prisma.task.delete({ where: { id } });
      return { success: true };
    }

    // LEADER quản lý team của task → xoá được mọi task trong team, không bị chặn bởi luật
    // "task do leader/hệ thống giao" ở dưới (leader có toàn quyền với task trong team mình).
    if (roles.includes("LEADER")) {
      const team = await this.prisma.team.findUnique({
        where: { id: task.team_id },
        select: { leader_id: true },
      });
      if (team?.leader_id === requesterId) {
        await this.prisma.task.delete({ where: { id } });
        return { success: true };
      }
    }

    // Còn lại (thành viên thường, hoặc LEADER của team khác): chỉ được xoá task của chính mình,
    // và chỉ khi task đó do chính mình tự nhận — không phải được leader giao tay
    // (assigned_by_id khác assignee_id) hoặc hệ thống tự động chia (run_id != null).
    if (task.assignee_id !== requesterId) {
      throw new ForbiddenException("Không có quyền xoá task này");
    }
    const isSystemAssigned = task.run_id != null;
    const isAssignedByOther =
      task.assigned_by_id != null && task.assigned_by_id !== task.assignee_id;
    if (isSystemAssigned || isAssignedByOther) {
      throw new ForbiddenException(
        "Task này được leader giao hoặc hệ thống tự động chia, bạn không thể tự xoá",
      );
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
      IN_PROGRESS: ["ASSIGNED", "SUBMITTED", "CANCELLED"],
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

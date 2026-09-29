import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtOrApiKeyGuard } from "../../api-keys/guards/jwt-or-api-key.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ContentApprovalService } from "../content-approval/content-approval.service";
import { TaskAutoTasksService } from "./tasks.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  QueryTaskHeaderCountsDto,
  SubmitTaskDto,
  ReviewTaskDto,
  UpdatePublishedLinksDto,
} from "./dto/task.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller("task-auto")
export class TaskAutoTasksController {
  constructor(
    private tasks: TaskAutoTasksService,
    private contentApproval: ContentApprovalService,
  ) {}

  // ── Tasks ─────────────────────────────────────────────────────────────────

  @Get("tasks")
  @ApiOperation({ summary: "List tasks with filters" })
  getTasks(@Query() q: QueryTaskDto) {
    return this.tasks.findAll(q);
  }

  // Phải đứng trước "tasks/:id" — nếu không "header-counts" sẽ bị route động :id nuốt mất.
  @Get("tasks/header-counts")
  @ApiOperation({
    summary:
      "Đếm nhanh cho header ('N task') + 2 badge 'Video chờ duyệt'/'Content chờ duyệt' — gộp " +
      "3 lượt đếm (vốn phải gọi getTasks/getContentApprovals riêng với limit:1) thành 1 request.",
  })
  async getTaskHeaderCounts(@Query() q: QueryTaskHeaderCountsDto) {
    const [{ total, submittedTotal }, contentApprovalTotal] = await Promise.all([
      this.tasks.getHeaderCounts(q),
      this.contentApproval.countPending({
        team_id: q.team_id,
        search: q.search,
        assignee_id: q.assignee_id,
      }),
    ]);
    return { total, submittedTotal, contentApprovalTotal };
  }

  @Get("tasks/:id")
  @ApiOperation({ summary: "Get task detail" })
  getTask(@Param("id") id: string) {
    return this.tasks.findOne(id);
  }

  @Post("tasks")
  @ApiOperation({
    summary:
      "Create a task. ADMIN/MANAGER/LEADER can assign anyone; others self-assign and must be in the team.",
  })
  createTask(@Body() dto: CreateTaskDto, @Request() req: any) {
    return this.tasks.create(dto, req.user.id, req.user.roles ?? []);
  }

  @Put("tasks/:id")
  @ApiOperation({ summary: "Update task status/assignee/deadline" })
  updateTask(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: any,
  ) {
    return this.tasks.update(id, dto, req.user.id, req.user.roles ?? []);
  }

  @Post("tasks/:id/submit")
  @ApiOperation({ summary: "Submit task result (assignee only)" })
  submitTask(
    @Param("id") id: string,
    @Body() dto: SubmitTaskDto,
    @Request() req: any,
  ) {
    return this.tasks.submit(id, dto, req.user.id);
  }

  @Post("tasks/:id/review")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Approve or reject a submitted task" })
  reviewTask(
    @Param("id") id: string,
    @Body() dto: ReviewTaskDto,
    @Request() req: any,
  ) {
    return this.tasks.review(id, dto, req.user.id);
  }

  @Patch("tasks/:id/published-links")
  @ApiOperation({
    summary:
      "Nộp/sửa/xoá danh sách link bài đăng đã đăng tay (nền tảng tự do, chỉ khi task APPROVED)",
  })
  updatePublishedLinks(
    @Param("id") id: string,
    @Body() dto: UpdatePublishedLinksDto,
    @Request() req: any,
  ) {
    return this.tasks.updatePublishedLinks(
      id,
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Post("tasks/:id/published-links/:linkId/refresh-stats")
  @ApiOperation({
    summary:
      "Làm mới thủ công số liệu tương tác (views/likes/comments/shares) cho 1 link đã nộp",
  })
  refreshPublishedLinkStats(
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @Request() req: any,
  ) {
    return this.tasks.refreshPublishedLinkStats(
      id,
      linkId,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("tasks/:id")
  @ApiOperation({
    summary:
      "Delete a task (ADMIN/MANAGER: mọi task, LEADER: task của team mình, thành viên: task của chính mình)",
  })
  deleteTask(@Param("id") id: string, @Request() req: any) {
    return this.tasks.remove(id, req.user.id, req.user.roles ?? []);
  }

}

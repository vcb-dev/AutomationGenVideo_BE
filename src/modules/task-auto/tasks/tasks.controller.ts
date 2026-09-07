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
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { TaskAutoTasksService } from "./tasks.service";
import { TaskAutoVideoService } from "../video/video.service";
import { VideoScriptService } from "./video-script.service";
import { ContentApprovalService } from "./content-approval.service";
import { TaskVideoMatchService } from "./task-video-match.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  QueryTaskHeaderCountsDto,
  SubmitTaskDto,
  ReviewTaskDto,
  UpdatePublishedLinksDto,
  GenerateVideoScriptDto,
  UpdateVideoScriptDto,
  TranslateVideoScriptDto,
  ReviewContentApprovalDto,
  QueryContentApprovalDto,
} from "./dto/task.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoTasksController {
  constructor(
    private tasks: TaskAutoTasksService,
    private video: TaskAutoVideoService,
    private videoScript: VideoScriptService,
    private contentApproval: ContentApprovalService,
    private videoMatch: TaskVideoMatchService,
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

  // Phải đứng trước "tasks/:id" — path 1 segment, nếu không route động :id nuốt mất.
  @Post("tasks/match-videos")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({
    summary:
      "Chạy tay job khớp video kênh nội bộ (FB/IG) với task + gắn link bài đăng (thường chạy cron 07:45). Dùng để test/backfill.",
  })
  matchVideos(@Body() body: { since_days?: number; max_videos?: number }) {
    return this.videoMatch.runDailyMatch({
      sinceDays: body?.since_days,
      maxVideos: body?.max_videos,
    });
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

  @Get("tasks/:id/video-matches")
  @ApiOperation({
    summary:
      "Lịch sử job khớp video kênh nội bộ tự động cho task này (audit: link nào tự gắn, điểm số, vì sao bỏ)",
  })
  getVideoMatches(@Param("id") id: string) {
    return this.videoMatch.listMatchesForTask(id);
  }

  @Delete("tasks/:id")
  @ApiOperation({
    summary:
      "Delete a task (ADMIN/MANAGER: mọi task, LEADER: task của team mình, thành viên: task của chính mình)",
  })
  deleteTask(@Param("id") id: string, @Request() req: any) {
    return this.tasks.remove(id, req.user.id, req.user.roles ?? []);
  }

  // ── Video ─────────────────────────────────────────────────────────────────

  @Post("tasks/:id/promote-video")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "LEADER thủ công promote video tạm lên Drive" })
  promoteTaskVideo(@Param("id") id: string) {
    return this.video.uploadPendingToDrive(id);
  }

  @Delete("tasks/:id/pending-video")
  @ApiOperation({
    summary: "Xoá video tạm của task (editor upload lại hoặc LEADER dọn dẹp)",
  })
  deleteTaskVideo(@Param("id") id: string, @Request() req: any) {
    return this.video.removeVideo(id, req.user.id, req.user.roles ?? []);
  }

  @Post("tasks/:id/upload-video/init")
  @ApiOperation({ summary: "Khởi tạo upload video tạm (local, chưa lên Drive)" })
  initVideoUpload(
    @Param("id") id: string,
    @Body() body: { filename: string; mimetype: string; totalSize: number },
    @Request() req: any,
  ) {
    return this.video.initChunkUpload(id, req.user.id, body);
  }

  @Post("tasks/:id/upload-video/chunk")
  @ApiOperation({ summary: "Gửi một chunk của video lên server" })
  @UseInterceptors(FileInterceptor("chunk", {
    storage: memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },
  }))
  async receiveVideoChunk(
    @Param("id") id: string,
    @UploadedFile() chunk: Express.Multer.File,
    @Body("uploadId") uploadId: string,
    @Body("chunkIndex") chunkIndex: string,
    @Request() req: any,
  ) {
    if (!chunk) throw new BadRequestException("Thiếu dữ liệu chunk");
    if (!uploadId) throw new BadRequestException("Thiếu uploadId");
    return this.video.receiveChunk(uploadId, req.user.id, chunk.buffer, parseInt(chunkIndex, 10));
  }

  @Post("tasks/:id/upload-video/finish")
  @ApiOperation({ summary: "Hoàn tất upload: ghép chunks, đăng ký video tạm" })
  finishVideoUpload(
    @Param("id") id: string,
    @Body() body: { uploadId: string },
    @Request() req: any,
  ) {
    if (!body.uploadId) throw new BadRequestException("Thiếu uploadId");
    return this.video.finishChunkUpload(body.uploadId, req.user.id, id);
  }

  @Get("tasks/:id/pending-video")
  @ApiOperation({ summary: "Stream video tạm để xem trước (hỗ trợ Range)" })
  async streamPendingVideo(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    return this.video.streamVideo(id, res);
  }

  // ── AI Video Script ──────────────────────────────────────────────────────

  @Get("tasks/:id/video-script")
  @ApiOperation({ summary: "Lấy content AI đã sinh & cache cho task (nếu có)" })
  async getVideoScript(@Param("id") id: string) {
    const script = await this.videoScript.getCached(id);
    return { script };
  }

  @Post("tasks/:id/video-script")
  @ApiOperation({
    summary:
      "Sinh content AI (DeepSeek) cho task. Dùng lại cache nếu input không đổi và force=false, tránh tốn token.",
  })
  async generateVideoScript(
    @Param("id") id: string,
    @Body() dto: GenerateVideoScriptDto,
  ) {
    const { force, ...params } = dto;
    return this.videoScript.generate(id, params, force ?? false);
  }

  @Patch("tasks/:id/video-script")
  @ApiOperation({
    summary:
      "Sửa trực tiếp content/hashtags đã sinh (không gọi AI). Bản dịch cũ (nếu có) được giữ nguyên.",
  })
  async updateVideoScript(
    @Param("id") id: string,
    @Body() dto: UpdateVideoScriptDto,
  ) {
    const script = await this.videoScript.update(id, dto);
    return { script };
  }

  @Post("tasks/:id/video-script/translate")
  @ApiOperation({
    summary:
      "Dịch content/hashtags hiện tại. Tái dùng ngôn ngữ của bản dịch cũ nếu có; nếu chưa từng có " +
      "bản dịch nào thì dùng `market` để AI tự xác định ngôn ngữ.",
  })
  async translateVideoScript(
    @Param("id") id: string,
    @Body() dto: TranslateVideoScriptDto,
  ) {
    const script = await this.videoScript.translate(id, dto.market);
    return { script };
  }

  // ── Content Approval ─────────────────────────────────────────────────────

  @Get("content-approvals")
  @ApiOperation({
    summary: "List content-approval requests (mặc định PENDING) — tab 'Content chờ duyệt'",
  })
  listContentApprovals(@Query() q: QueryContentApprovalDto) {
    return this.contentApproval.list(q);
  }

  @Get("tasks/:id/content-approval")
  @ApiOperation({
    summary: "Lấy yêu cầu duyệt content gần nhất của task (nếu có)",
  })
  getContentApproval(@Param("id") id: string) {
    return this.contentApproval.getCurrent(id);
  }

  @Post("tasks/:id/content-approval")
  @ApiOperation({
    summary:
      "Editor (assignee) gửi yêu cầu duyệt content mới trước khi bắt đầu làm task",
  })
  requestContentApproval(@Param("id") id: string, @Request() req: any) {
    return this.contentApproval.request(id, req.user.id);
  }

  @Post("content-approvals/:id/review")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Duyệt hoặc từ chối yêu cầu duyệt content" })
  reviewContentApproval(
    @Param("id") id: string,
    @Body() dto: ReviewContentApprovalDto,
    @Request() req: any,
  ) {
    return this.contentApproval.review(id, dto, req.user.id);
  }
}

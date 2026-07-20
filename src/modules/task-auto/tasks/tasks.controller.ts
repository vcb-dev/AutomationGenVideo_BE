import {
  Controller,
  Get,
  Post,
  Put,
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
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { TaskAutoTasksService } from "./tasks.service";
import { TaskAutoVideoService } from "../video/video.service";
import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  SubmitTaskDto,
  ReviewTaskDto,
} from "./task.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoTasksController {
  constructor(
    private tasks: TaskAutoTasksService,
    private video: TaskAutoVideoService,
  ) {}

  // ── Tasks ─────────────────────────────────────────────────────────────────

  @Get("tasks")
  @ApiOperation({ summary: "List tasks with filters" })
  getTasks(@Query() q: QueryTaskDto) {
    return this.tasks.findAll(q);
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

  @Delete("tasks/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a task (ADMIN/MANAGER)" })
  deleteTask(@Param("id") id: string) {
    return this.tasks.remove(id);
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
}

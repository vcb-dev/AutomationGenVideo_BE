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
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import * as path from "path";
import * as fs from "fs";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

const PRODUCT_IMAGES_DIR = path.join(process.cwd(), "uploads", "products");

import { TaskAutoTasksService } from "./task-auto-tasks.service";
import { TaskAutoTeamsService } from "./task-auto-teams.service";
import { TaskAutoCatalogService } from "./task-auto-catalog.service";
import { TaskAutoKpiService } from "./task-auto-kpi.service";
import { TaskAutoAssignService } from "./task-auto-assign/task-auto-assign.service";
import { TaskAutoVideoService } from "./task-auto-video.service";
import { TaskAutoWarehouseService } from "./task-auto-warehouse.service";
import { GoogleDriveStorageService } from "../social-publishing/upload/google-drive-storage.service";
import * as os from "os";

import {
  CreateTaskDto,
  UpdateTaskDto,
  QueryTaskDto,
  SubmitTaskDto,
  ReviewTaskDto,
} from "./dto/task.dto";
import {
  CreateTeamDto,
  UpdateTeamDto,
  EditorApprovalDto,
  SetEditorDto,
} from "./dto/team.dto";
import {
  CreateProductDto,
  UpdateProductDto,
  QueryProductDto,
  CreateContentDto,
  UpdateContentDto,
  QueryContentDto,
  CreateSourceDto,
  UpdateSourceDto,
  QuerySourceDto,
  CreateTeamProductDto,
  UpdateTeamProductDto,
  CreateTeamContentDto,
  UpdateTeamContentDto,
  CreateTeamSourceDto,
  UpdateTeamSourceDto,
  CreateEditorProductDto,
  UpdateEditorProductDto,
  QueryEditorProductDto,
  CreateEditorContentDto,
  UpdateEditorContentDto,
  QueryEditorContentDto,
  CreateEditorSourceDto,
  UpdateEditorSourceDto,
  QueryEditorSourceDto,
} from "./dto/catalog.dto";
import {
  GetWarehouseQuery,
  AddToWarehouseDto,
  RemoveFromWarehouseDto,
  PushToMonthDto,
  AutoCarryDto,
} from "./dto/warehouse.dto";
import {
  UpsertTeamKpiDto,
  UpsertEditorKpiDto,
  UpsertEditorWeekendKpiDto,
} from "./dto/kpi.dto";
import { UpdateAutoAssignSettingDto } from "./dto/settings.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoController {
  constructor(
    private tasks: TaskAutoTasksService,
    private teams: TaskAutoTeamsService,
    private catalog: TaskAutoCatalogService,
    private kpi: TaskAutoKpiService,
    private assign: TaskAutoAssignService,
    private video: TaskAutoVideoService,
    private googleDrive: GoogleDriveStorageService,
    private warehouse: TaskAutoWarehouseService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ── Video submission ──────────────────────────────────────────────────────

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

  // ── Local chunked video upload (file stays local until task is approved) ───

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
    limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB per chunk
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

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAMS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get("teams")
  @ApiOperation({ summary: "List all teams" })
  getTeams() {
    return this.teams.findAll();
  }

  @Get("teams/:id")
  @ApiOperation({ summary: "Get team detail" })
  getTeam(@Param("id") id: string) {
    return this.teams.findOne(id);
  }

  @Post("teams")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Create a team" })
  createTeam(@Body() dto: CreateTeamDto) {
    return this.teams.create(dto);
  }

  @Put("teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update a team. LEADER chỉ được đổi brand_type của team mình lead." })
  updateTeam(
    @Param("id") id: string,
    @Body() dto: UpdateTeamDto,
    @Request() req: any,
  ) {
    return this.teams.update(id, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a team" })
  deleteTeam(@Param("id") id: string) {
    return this.teams.remove(id);
  }

  @Patch("teams/:id/members/:userId/editor")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Directly set/unset a team member as Editor" })
  setMemberEditor(
    @Param("id") teamId: string,
    @Param("userId") userId: string,
    @Body() dto: SetEditorDto,
    @Request() req: any,
  ) {
    return this.teams.setMemberEditorDirect(
      teamId,
      userId,
      dto.is_editor,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  // ─── Team Products ─────────────────────────────────────────────────────────

  @Get("teams/:id/products")
  @ApiOperation({ summary: "List products in team inventory (standalone)" })
  listTeamProducts(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
  ) {
    return this.teams.listTeamProducts(teamId, brandType as any);
  }

  @Post("teams/:id/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Add product to team inventory (copy from catalog or create new)" })
  addTeamProduct(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamProductDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamProduct(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/products/:teamProductId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update team product (LEADER/ADMIN/MANAGER)" })
  updateTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Body() dto: UpdateTeamProductDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamProduct(teamId, teamProductId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/products/:teamProductId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push team product to global catalog (LEADER/ADMIN/MANAGER)" })
  pushTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamProductToGlobal(teamId, teamProductId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/products/:teamProductId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Remove product from team inventory (LEADER/ADMIN/MANAGER)" })
  removeTeamProduct(
    @Param("id") teamId: string,
    @Param("teamProductId") teamProductId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamProduct(teamId, teamProductId, req.user.id, req.user.roles ?? []);
  }

  // ─── Team Contents ─────────────────────────────────────────────────────────

  @Get("teams/:id/contents")
  @ApiOperation({ summary: "List contents in team storage (standalone)" })
  listTeamContents(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
  ) {
    return this.teams.listTeamContents(teamId, brandType as any);
  }

  @Post("teams/:id/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Add content to team storage (copy from catalog or create new)" })
  addTeamContent(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamContentDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamContent(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/contents/:teamContentId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update team content (LEADER/ADMIN/MANAGER)" })
  updateTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Body() dto: UpdateTeamContentDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamContent(teamId, teamContentId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/contents/:teamContentId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push team content to global catalog (LEADER/ADMIN/MANAGER)" })
  pushTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamContentToGlobal(teamId, teamContentId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/contents/:teamContentId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Remove content from team storage" })
  removeTeamContent(
    @Param("id") teamId: string,
    @Param("teamContentId") teamContentId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamContent(teamId, teamContentId, req.user.id, req.user.roles ?? []);
  }

  // ─── Team Sources ──────────────────────────────────────────────────────────

  @Get("teams/:id/sources")
  @ApiOperation({ summary: "List sources in team inventory" })
  listTeamSources(
    @Param("id") teamId: string,
    @Query("brand_type") brandType?: string,
    @Query("product_id") productId?: string,
    @Query("team_product_id") teamProductId?: string,
  ) {
    return this.teams.listTeamSources(teamId, brandType as any, productId, teamProductId);
  }

  @Post("teams/:id/sources")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER", "MEMBER")
  @ApiOperation({ summary: "Add source to team inventory (copy from catalog or create new)" })
  addTeamSource(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamSourceDto,
    @Request() req: any,
  ) {
    return this.teams.addTeamSource(teamId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/sources/:teamSourceId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Update team source (LEADER/ADMIN/MANAGER)" })
  updateTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Body() dto: UpdateTeamSourceDto,
    @Request() req: any,
  ) {
    return this.teams.updateTeamSource(teamId, teamSourceId, dto, req.user.id, req.user.roles ?? []);
  }

  @Patch("teams/:id/sources/:teamSourceId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push team source to global catalog (LEADER/ADMIN/MANAGER)" })
  pushTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamSourceToGlobal(teamId, teamSourceId, req.user.id, req.user.roles ?? []);
  }

  @Delete("teams/:id/sources/:teamSourceId")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Remove source from team inventory (LEADER/ADMIN/MANAGER)" })
  removeTeamSource(
    @Param("id") teamId: string,
    @Param("teamSourceId") teamSourceId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamSource(teamId, teamSourceId, req.user.id, req.user.roles ?? []);
  }

  @Get("users")
  @ApiOperation({ summary: "List all users (for member/assignee dropdowns)" })
  getUsers(@Query("role") role?: string) {
    return this.teams.listAllMembers(role);
  }

  @Get("dashboard")
  @ApiOperation({ summary: "Dashboard summary stats" })
  getDashboard(@Request() req: any) {
    return this.tasks.getDashboard(req.user.id, req.user.roles ?? []);
  }

  @Post("upload-image")
  @ApiOperation({ summary: "Upload product image — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("image"))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No image file provided");
    const allowed = /^image\/(jpeg|png|gif|webp)$/;
    if (!allowed.test(file.mimetype))
      throw new NotFoundException(
        "Only image files are allowed (jpg, png, gif, webp)",
      );
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "products" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    // Fallback: local disk
    if (!fs.existsSync(PRODUCT_IMAGES_DIR))
      fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(PRODUCT_IMAGES_DIR, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/images/${filename}`, storage: "local" };
  }

  @Get("images/:filename")
  @ApiOperation({ summary: "Serve product image" })
  serveProductImage(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(PRODUCT_IMAGES_DIR, safeName);
    if (!fs.existsSync(filePath))
      throw new NotFoundException("Image not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=604800");
    fs.createReadStream(filePath).pipe(res);
  }

  @Post("upload-voice")
  @ApiOperation({ summary: "Upload content voice file — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("voice"))
  async uploadVoiceFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No voice file provided");
    const allowed =
      /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac|x-m4a)|video\/mp4$/;
    if (!allowed.test(file.mimetype))
      throw new NotFoundException(
        "Only audio files are allowed (mp3, wav, ogg, aac, flac, m4a)",
      );
    const ext = path.extname(file.originalname).toLowerCase() || ".mp3";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "voices" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    // Fallback: local disk
    const voiceDir = path.join(process.cwd(), "uploads", "voices");
    if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/voices/${filename}`, storage: "local" };
  }

  @Get("voices/:filename")
  @ApiOperation({ summary: "Serve voice file" })
  serveVoiceFile(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", "voices", safeName);
    if (!fs.existsSync(filePath))
      throw new NotFoundException("Voice file not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".aac": "audio/aac",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".webm": "audio/webm",
    };
    res.setHeader("Content-Type", mime[ext] || "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(filePath).pipe(res);
  }

  @Post("upload-content")
  @ApiOperation({ summary: "Upload content file (PDF, Word, Excel…) — returns { url }" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async uploadContentFile(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new NotFoundException("No file provided");
    const ALLOWED_MIME = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];
    if (!ALLOWED_MIME.includes(file.mimetype))
      throw new NotFoundException("Chỉ chấp nhận PDF, Word, Excel, PowerPoint, TXT");
    const ext = path.extname(file.originalname).toLowerCase() || ".pdf";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

    if (this.googleDrive.isAvailable()) {
      const tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, file.buffer);
      try {
        const result = await this.googleDrive.uploadFromPath(tmpPath, filename, file.mimetype, req.user, { subfolder: "content-files" });
        return { url: result.url, storage: "google_drive" };
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    // Fallback: local disk
    const contentDir = path.join(process.cwd(), "uploads", "content-files");
    if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, filename), file.buffer);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return { url: `${baseUrl}/api/task-auto/content-files/${filename}`, storage: "local" };
  }

  @Get("content-files/:filename")
  @ApiOperation({ summary: "Serve content file" })
  serveContentFile(@Param("filename") filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), "uploads", "content-files", safeName);
    if (!fs.existsSync(filePath)) throw new NotFoundException("File not found");
    const ext = path.extname(safeName).toLowerCase();
    const mime: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".txt": "text/plain",
    };
    res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.setHeader("Cache-Control", "public, max-age=604800");
    fs.createReadStream(filePath).pipe(res);
  }

  // ─── Editor Approvals ─────────────────────────────────────────────────────

  @Get("editor-approvals")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "List editor approval requests" })
  getEditorApprovals(@Query("status") status?: string) {
    return this.teams.getEditorApprovals(status);
  }

  @Post("editor-approvals")
  @ApiOperation({ summary: "Request editor role approval" })
  requestEditorApproval(@Request() req: any) {
    return this.teams.requestEditorApproval(req.user.id);
  }

  @Put("editor-approvals/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Approve or reject an editor request" })
  reviewEditorApproval(
    @Param("id") id: string,
    @Body() dto: EditorApprovalDto,
    @Request() req: any,
  ) {
    return this.teams.reviewEditorApproval(id, dto, req.user.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG — Products
  // ═══════════════════════════════════════════════════════════════════════════

  @Get("products")
  @ApiOperation({ summary: "List products" })
  getProducts(@Query() q: QueryProductDto) {
    return this.catalog.findAllProducts(q);
  }

  @Get("products/:id")
  @ApiOperation({ summary: "Get product detail" })
  getProduct(@Param("id") id: string) {
    return this.catalog.findOneProduct(id);
  }

  @Post("products")
  @ApiOperation({ summary: "Create a product (all roles)" })
  createProduct(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.catalog.createProduct(dto, req.user.id);
  }

  @Put("products/:id")
  @ApiOperation({ summary: "Update a product (all roles)" })
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete("products/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a product from global catalog (ADMIN/MANAGER)" })
  deleteProduct(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeProduct(id, req.user.roles ?? []);
  }

  @Get("product-lines")
  @ApiOperation({ summary: "List product lines" })
  getProductLines(@Query("brand_type") brandType?: string) {
    return this.catalog.findProductLines(brandType);
  }

  @Get("materials")
  @ApiOperation({ summary: "List materials" })
  getMaterials(@Query("brand_type") brandType?: string) {
    return this.catalog.findMaterials(brandType);
  }

  // ─── Catalog — Contents ───────────────────────────────────────────────────

  @Get("contents")
  @ApiOperation({ summary: "List contents" })
  getContents(@Query() q: QueryContentDto) {
    return this.catalog.findAllContents(q);
  }

  @Get("contents/:id")
  @ApiOperation({ summary: "Get content detail" })
  getContent(@Param("id") id: string) {
    return this.catalog.findOneContent(id);
  }

  @Post("contents")
  @ApiOperation({ summary: "Create a content (all roles)" })
  createContent(@Body() dto: CreateContentDto, @Request() req: any) {
    return this.catalog.createContent(dto, req.user.id);
  }

  @Put("contents/:id")
  @ApiOperation({ summary: "Update a content (all roles)" })
  updateContent(@Param("id") id: string, @Body() dto: UpdateContentDto) {
    return this.catalog.updateContent(id, dto);
  }

  @Delete("contents/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a content from global catalog (ADMIN/MANAGER)" })
  deleteContent(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeContent(id, req.user.roles ?? []);
  }

  @Get("content-lines")
  @ApiOperation({ summary: "List content lines" })
  getContentLines() {
    return this.catalog.findContentLines();
  }

  @Post("content-lines")
  @ApiOperation({ summary: "Create a content line (all roles)" })
  createContentLine(@Body("name") name: string) {
    return this.catalog.createContentLine(name);
  }

  @Patch("content-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update content line (a_type)" })
  updateContentLine(
    @Param("id") id: string,
    @Body() body: { a_type?: string | null },
  ) {
    return this.catalog.updateContentLine(id, body);
  }

  @Delete("content-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a content line" })
  deleteContentLine(@Param("id") id: string) {
    return this.catalog.removeContentLine(id);
  }

  @Post("product-lines")
  @ApiOperation({ summary: "Create a product line (all roles)" })
  createProductLine(@Body("name") name: string, @Body("brand_type") brandType: string) {
    return this.catalog.createProductLine(name, brandType);
  }

  @Patch("product-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update product line (video_category)" })
  updateProductLine(
    @Param("id") id: string,
    @Body() body: { video_category?: string | null },
  ) {
    return this.catalog.updateProductLine(id, body);
  }

  @Delete("product-lines/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a product line" })
  deleteProductLine(@Param("id") id: string) {
    return this.catalog.removeProductLine(id);
  }

  @Post("materials")
  @ApiOperation({ summary: "Create a material (all roles)" })
  createMaterial(@Body("name") name: string, @Body("brand_type") brandType: string) {
    return this.catalog.createMaterial(name, brandType);
  }

  @Delete("materials/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a material" })
  deleteMaterial(@Param("id") id: string) {
    return this.catalog.removeMaterial(id);
  }

  // ─── Catalog — Sources ────────────────────────────────────────────────────

  @Get("sources")
  @ApiOperation({ summary: "List sources" })
  getSources(@Query() q: QuerySourceDto) {
    return this.catalog.findAllSources(q);
  }

  @Get("sources/:id")
  @ApiOperation({ summary: "Get source detail" })
  getSource(@Param("id") id: string) {
    return this.catalog.findOneSource(id);
  }

  @Post("sources")
  @ApiOperation({ summary: "Create a source (all roles)" })
  createSource(@Body() dto: CreateSourceDto, @Request() req: any) {
    return this.catalog.createSource(dto, req.user.id);
  }

  @Put("sources/:id")
  @ApiOperation({ summary: "Update a source (all roles)" })
  updateSource(@Param("id") id: string, @Body() dto: UpdateSourceDto) {
    return this.catalog.updateSource(id, dto);
  }

  @Delete("sources/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a source from global catalog (ADMIN/MANAGER)" })
  deleteSource(@Param("id") id: string, @Request() req: any) {
    return this.catalog.removeSource(id, req.user.roles ?? []);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITOR CATALOG — kho cá nhân của editor
  // Route /editors/:userId/... — bản thân dùng ID của mình, ADMIN/MANAGER xem bất kỳ
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Editor Products ───────────────────────────────────────────────────────

  @Get("editors/:userId/products")
  @ApiOperation({ summary: "List editor personal products" })
  listEditorProducts(
    @Param("userId") userId: string,
    @Query() q: QueryEditorProductDto,
  ) {
    return this.catalog.findAllEditorProducts(userId, q);
  }

  @Post("editors/:userId/products")
  @ApiOperation({ summary: "Add product to editor personal catalog (copy from global or create new)" })
  addEditorProduct(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorProductDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorProduct(userId, dto);
  }

  @Get("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Get editor product detail" })
  getEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
  ) {
    return this.catalog.findOneEditorProduct(epId);
  }

  @Patch("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Update editor product" })
  updateEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body() dto: UpdateEditorProductDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorProduct(epId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Delete editor product" })
  removeEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorProduct(epId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/products/:epId/push-to-global")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push editor product to global catalog (LEADER/ADMIN/MANAGER)" })
  pushEditorProductToGlobal(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorProductToGlobal(epId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/products/:epId/push-to-team")
  @ApiOperation({ summary: "Push editor product to team catalog" })
  pushEditorProductToTeam(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorProductToTeam(epId, teamId, req.user.id);
  }

  // ─── Editor Contents ───────────────────────────────────────────────────────

  @Get("editors/:userId/contents")
  @ApiOperation({ summary: "List editor personal contents" })
  listEditorContents(
    @Param("userId") userId: string,
    @Query() q: QueryEditorContentDto,
  ) {
    return this.catalog.findAllEditorContents(userId, q);
  }

  @Post("editors/:userId/contents")
  @ApiOperation({ summary: "Add content to editor personal catalog (copy from global or create new)" })
  addEditorContent(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorContentDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorContent(userId, dto);
  }

  @Get("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Get editor content detail" })
  getEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
  ) {
    return this.catalog.findOneEditorContent(ecId);
  }

  @Patch("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Update editor content" })
  updateEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body() dto: UpdateEditorContentDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorContent(ecId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Delete editor content" })
  removeEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorContent(ecId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/contents/:ecId/push-to-global")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push editor content to global catalog (LEADER/ADMIN/MANAGER)" })
  pushEditorContentToGlobal(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorContentToGlobal(ecId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/contents/:ecId/push-to-team")
  @ApiOperation({ summary: "Push editor content to team catalog" })
  pushEditorContentToTeam(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorContentToTeam(ecId, teamId, req.user.id);
  }

  // ─── Editor Sources ────────────────────────────────────────────────────────

  @Get("editors/:userId/sources")
  @ApiOperation({ summary: "List editor personal sources" })
  listEditorSources(
    @Param("userId") userId: string,
    @Query() q: QueryEditorSourceDto,
  ) {
    return this.catalog.findAllEditorSources(userId, q);
  }

  @Post("editors/:userId/sources")
  @ApiOperation({ summary: "Add source to editor personal catalog (copy from global or create new)" })
  addEditorSource(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorSource(userId, dto);
  }

  @Get("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Get editor source detail" })
  getEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
  ) {
    return this.catalog.findOneEditorSource(esId);
  }

  @Patch("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Update editor source" })
  updateEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body() dto: UpdateEditorSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorSource(esId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Delete editor source" })
  removeEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorSource(esId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/sources/:esId/push-to-global")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push editor source to global catalog (LEADER/ADMIN/MANAGER)" })
  pushEditorSourceToGlobal(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorSourceToGlobal(esId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/sources/:esId/push-to-team")
  @ApiOperation({ summary: "Push editor source to team catalog" })
  pushEditorSourceToTeam(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorSourceToTeam(esId, teamId, req.user.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KPI
  // ═══════════════════════════════════════════════════════════════════════════

  @Get("kpi/teams")
  @ApiOperation({ summary: "Get team KPIs" })
  getTeamKpis(@Query("month") month?: string) {
    return this.kpi.getTeamKpis(month);
  }

  @Post("kpi/teams")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert team KPI (LEADER: own team only)" })
  upsertTeamKpi(@Body() dto: UpsertTeamKpiDto, @Request() req: any) {
    return this.kpi.upsertTeamKpi(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/teams/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete team KPI" })
  deleteTeamKpi(@Param("id") id: string) {
    return this.kpi.deleteTeamKpi(id);
  }

  @Get("kpi/editors")
  @ApiOperation({ summary: "Get editor KPIs" })
  getEditorKpis(
    @Query("month") month?: string,
    @Query("user_id") userId?: string,
  ) {
    return this.kpi.getEditorKpis(month, userId);
  }

  @Post("kpi/editors")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert editor KPI" })
  upsertEditorKpi(@Body() dto: UpsertEditorKpiDto, @Request() req: any) {
    return this.kpi.upsertEditorKpi(dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("kpi/editors/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete editor KPI" })
  deleteEditorKpi(@Param("id") id: string) {
    return this.kpi.deleteEditorKpi(id);
  }

  @Get("kpi/weekend-editors")
  @ApiOperation({ summary: "Get per-Sunday editor KPIs" })
  getEditorWeekendKpis(@Query("month") month?: string) {
    return this.kpi.getEditorWeekendKpis(month);
  }

  @Post("kpi/weekend-editors")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Upsert per-Sunday editor KPI" })
  upsertEditorWeekendKpi(
    @Body() dto: UpsertEditorWeekendKpiDto,
    @Request() req: any,
  ) {
    return this.kpi.upsertEditorWeekendKpi(
      dto,
      req.user.id,
      req.user.roles ?? [],
    );
  }

  @Delete("kpi/weekend-editors/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Delete per-Sunday editor KPI" })
  deleteEditorWeekendKpi(@Param("id") id: string) {
    return this.kpi.deleteEditorWeekendKpi(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-ASSIGN SETTINGS & RUNS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get("settings")
  @ApiOperation({ summary: "Get auto-assign settings" })
  getSettings() {
    return this.assign.getSettings();
  }

  @Put("settings")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Update auto-assign settings" })
  updateSettings(@Body() dto: UpdateAutoAssignSettingDto, @Request() req: any) {
    return this.assign.updateSettings(dto, req.user.id);
  }

  @Get("assignment-runs")
  @ApiOperation({ summary: "Get recent assignment runs" })
  getRuns(@Query("limit") limit?: string) {
    return this.assign.getRuns(limit ? parseInt(limit) : 50);
  }

  @Post("assignment-runs/trigger")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Manually trigger auto-assign run" })
  async triggerRun() {
    const result = await this.assign.triggerManually();
    return {
      message: "Auto-assign triggered",
      timestamp: new Date(),
      ...result,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KHO THÁNG (WAREHOUSE)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Kho tổng ──────────────────────────────────────────────────────────────

  @Get("warehouse/global")
  @ApiOperation({ summary: "Lấy kho tháng tổng (global)" })
  getGlobalWarehouse(@Query() q: GetWarehouseQuery) {
    return this.warehouse.getGlobalWarehouse(q.month);
  }

  @Post("warehouse/global/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng tổng" })
  addGlobalProducts(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalProducts(dto);
  }

  @Delete("warehouse/global/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng tổng" })
  removeGlobalProducts(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalProducts(dto);
  }

  @Post("warehouse/global/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Thêm content vào kho tháng tổng" })
  addGlobalContents(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalContents(dto);
  }

  @Delete("warehouse/global/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng tổng" })
  removeGlobalContents(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalContents(dto);
  }

  @Post("warehouse/global/sources")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Thêm source vào kho tháng tổng" })
  addGlobalSources(@Body() dto: AddToWarehouseDto) {
    return this.warehouse.addGlobalSources(dto);
  }

  @Delete("warehouse/global/sources")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Xoá source khỏi kho tháng tổng" })
  removeGlobalSources(@Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeGlobalSources(dto);
  }

  // ── Kho team ──────────────────────────────────────────────────────────────

  @Get("warehouse/teams/:teamId")
  @ApiOperation({ summary: "Lấy kho tháng của team" })
  getTeamWarehouse(@Param("teamId") teamId: string, @Query() q: GetWarehouseQuery) {
    return this.warehouse.getTeamWarehouse(teamId, q.month);
  }

  @Post("warehouse/teams/:teamId/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng team" })
  addTeamProducts(@Param("teamId") teamId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addTeamProducts(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/products")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng team" })
  removeTeamProducts(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamProducts(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Thêm content vào kho tháng team" })
  addTeamContents(@Param("teamId") teamId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addTeamContents(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/contents")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng team" })
  removeTeamContents(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamContents(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/sources")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Thêm source vào kho tháng team" })
  addTeamSources(@Param("teamId") teamId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addTeamSources(teamId, dto);
  }

  @Delete("warehouse/teams/:teamId/sources")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Xoá source khỏi kho tháng team" })
  removeTeamSources(@Param("teamId") teamId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeTeamSources(teamId, dto);
  }

  @Post("warehouse/teams/:teamId/push")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER", "LEADER")
  @ApiOperation({ summary: "Push kho team từ tháng này sang tháng khác" })
  pushTeamToMonth(@Param("teamId") teamId: string, @Body() dto: PushToMonthDto) {
    return this.warehouse.pushTeamToMonth(teamId, dto);
  }

  // ── Kho editor ────────────────────────────────────────────────────────────

  @Get("warehouse/editors/:editorId")
  @ApiOperation({ summary: "Lấy kho tháng của editor" })
  getEditorWarehouse(@Param("editorId") editorId: string, @Query() q: GetWarehouseQuery) {
    return this.warehouse.getEditorWarehouse(editorId, q.month);
  }

  @Post("warehouse/editors/:editorId/products")
  @ApiOperation({ summary: "Thêm sản phẩm vào kho tháng editor" })
  addEditorProducts(@Param("editorId") editorId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addEditorProducts(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/products")
  @ApiOperation({ summary: "Xoá sản phẩm khỏi kho tháng editor" })
  removeEditorProducts(@Param("editorId") editorId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeEditorProducts(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/contents")
  @ApiOperation({ summary: "Thêm content vào kho tháng editor" })
  addEditorContents(@Param("editorId") editorId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addEditorContents(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/contents")
  @ApiOperation({ summary: "Xoá content khỏi kho tháng editor" })
  removeEditorContents(@Param("editorId") editorId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeEditorContents(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/sources")
  @ApiOperation({ summary: "Thêm source vào kho tháng editor" })
  addEditorSources(@Param("editorId") editorId: string, @Body() dto: AddToWarehouseDto) {
    return this.warehouse.addEditorSources(editorId, dto);
  }

  @Delete("warehouse/editors/:editorId/sources")
  @ApiOperation({ summary: "Xoá source khỏi kho tháng editor" })
  removeEditorSources(@Param("editorId") editorId: string, @Body() dto: RemoveFromWarehouseDto) {
    return this.warehouse.removeEditorSources(editorId, dto);
  }

  @Post("warehouse/editors/:editorId/push")
  @ApiOperation({ summary: "Push kho editor từ tháng này sang tháng khác" })
  pushEditorToMonth(@Param("editorId") editorId: string, @Body() dto: PushToMonthDto) {
    return this.warehouse.pushEditorToMonth(editorId, dto);
  }

  // ── Auto-carry ────────────────────────────────────────────────────────────

  @Post("warehouse/auto-carry")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Copy kho tháng trước sang tháng mới (auto-carry)" })
  autoCarry(@Body() dto: AutoCarryDto) {
    return this.warehouse.autoCarry(dto);
  }
}

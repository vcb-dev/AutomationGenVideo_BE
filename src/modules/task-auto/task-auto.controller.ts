import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, Request, UseInterceptors, UploadedFile, Res, NotFoundException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import * as path from 'path'
import * as fs from 'fs'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'

const PRODUCT_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'products')

import { TaskAutoTasksService } from './task-auto-tasks.service'
import { TaskAutoTeamsService } from './task-auto-teams.service'
import { TaskAutoCatalogService } from './task-auto-catalog.service'
import { TaskAutoKpiService } from './task-auto-kpi.service'
import { TaskAutoAssignService } from './task-auto-assign.service'
import { TaskAutoVideoService } from './task-auto-video.service'

import { CreateTaskDto, UpdateTaskDto, QueryTaskDto, SubmitTaskDto, ReviewTaskDto } from './dto/task.dto'
import { CreateTeamDto, UpdateTeamDto, AddMemberDto, EditorApprovalDto, SetEditorDto } from './dto/team.dto'
import {
  CreateProductDto, UpdateProductDto, QueryProductDto,
  CreateContentDto, UpdateContentDto, QueryContentDto,
  CreateSourceDto, UpdateSourceDto, QuerySourceDto,
} from './dto/catalog.dto'
import { UpsertTeamKpiDto, UpsertEditorKpiDto, UpsertEditorWeekendKpiDto } from './dto/kpi.dto'
import { UpdateAutoAssignSettingDto } from './dto/settings.dto'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('task-auto')
export class TaskAutoController {
  constructor(
    private tasks: TaskAutoTasksService,
    private teams: TaskAutoTeamsService,
    private catalog: TaskAutoCatalogService,
    private kpi: TaskAutoKpiService,
    private assign: TaskAutoAssignService,
    private video: TaskAutoVideoService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('tasks')
  @ApiOperation({ summary: 'List tasks with filters' })
  getTasks(@Query() q: QueryTaskDto) {
    return this.tasks.findAll(q)
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Get task detail' })
  getTask(@Param('id') id: string) {
    return this.tasks.findOne(id)
  }

  @Post('tasks')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Create a task (ADMIN/MANAGER/LEADER)' })
  createTask(@Body() dto: CreateTaskDto, @Request() req: any) {
    return this.tasks.create(dto, req.user.id)
  }

  @Put('tasks/:id')
  @ApiOperation({ summary: 'Update task status/assignee/deadline' })
  updateTask(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Request() req: any) {
    return this.tasks.update(id, dto, req.user.id, req.user.roles ?? [])
  }

  @Post('tasks/:id/submit')
  @ApiOperation({ summary: 'Submit task result (assignee only)' })
  submitTask(@Param('id') id: string, @Body() dto: SubmitTaskDto, @Request() req: any) {
    return this.tasks.submit(id, dto, req.user.id)
  }

  @Post('tasks/:id/review')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Approve or reject a submitted task' })
  reviewTask(@Param('id') id: string, @Body() dto: ReviewTaskDto, @Request() req: any) {
    return this.tasks.review(id, dto, req.user.id)
  }

  @Delete('tasks/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a task (ADMIN/MANAGER)' })
  deleteTask(@Param('id') id: string) {
    return this.tasks.remove(id)
  }

  // ── Video submission ──────────────────────────────────────────────────────

  @Post('tasks/:id/attach-video')
  @ApiOperation({ summary: 'Gắn video đã upload vào task (lưu vào bộ nhớ tạm)' })
  attachTaskVideo(
    @Param('id') id: string,
    @Body() body: { filename: string; originalname: string; mimetype: string; size: number; url: string; storage: string },
    @Request() req: any,
  ) {
    return this.video.attachVideo(id, req.user.id, body)
  }

  @Post('tasks/:id/promote-video')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'LEADER chuyển video tạm vào thư viện media' })
  promoteTaskVideo(@Param('id') id: string, @Request() req: any) {
    return this.video.promoteToLibrary(id, req.user.id)
  }

  @Delete('tasks/:id/pending-video')
  @ApiOperation({ summary: 'Xoá video tạm của task (editor upload lại hoặc LEADER dọn dẹp)' })
  deleteTaskVideo(@Param('id') id: string, @Request() req: any) {
    return this.video.removeVideo(id, req.user.id, req.user.roles ?? [])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAMS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('teams')
  @ApiOperation({ summary: 'List all teams' })
  getTeams() {
    return this.teams.findAll()
  }

  @Get('teams/:id')
  @ApiOperation({ summary: 'Get team detail' })
  getTeam(@Param('id') id: string) {
    return this.teams.findOne(id)
  }

  @Post('teams')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Create a team' })
  createTeam(@Body() dto: CreateTeamDto) {
    return this.teams.create(dto)
  }

  @Put('teams/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Update a team' })
  updateTeam(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teams.update(id, dto)
  }

  @Delete('teams/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a team' })
  deleteTeam(@Param('id') id: string) {
    return this.teams.remove(id)
  }

  @Post('teams/:id/members')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Add a member to a team' })
  addMember(@Param('id') teamId: string, @Body() dto: AddMemberDto) {
    return this.teams.addMember(teamId, dto.user_id)
  }

  @Delete('teams/:id/members/:userId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Remove a member from a team' })
  removeMember(@Param('id') teamId: string, @Param('userId') userId: string) {
    return this.teams.removeMember(teamId, userId)
  }

  @Patch('teams/:id/members/:userId/editor')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Directly set/unset a team member as Editor' })
  setMemberEditor(
    @Param('id') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: SetEditorDto,
    @Request() req: any,
  ) {
    return this.teams.setMemberEditorDirect(
      teamId, userId, dto.is_editor, req.user.id, req.user.roles ?? [],
    )
  }

  // ─── Team Products ─────────────────────────────────────────────────────────

  @Get('teams/:id/products')
  @ApiOperation({ summary: 'List products in team inventory' })
  listTeamProducts(@Param('id') teamId: string) {
    return this.teams.listTeamProducts(teamId)
  }

  @Post('teams/:id/products')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER', 'MEMBER')
  @ApiOperation({ summary: 'Add product to team inventory' })
  addTeamProduct(
    @Param('id') teamId: string,
    @Body('product_id') productId: string,
    @Request() req: any,
  ) {
    return this.teams.addTeamProduct(teamId, productId, req.user.id, req.user.roles ?? [])
  }

  @Delete('teams/:id/products/:productId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER', 'MEMBER')
  @ApiOperation({ summary: 'Remove product from team inventory (leader/members of that team only)' })
  removeTeamProduct(
    @Param('id') teamId: string,
    @Param('productId') productId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamProduct(teamId, productId, req.user.id, req.user.roles ?? [])
  }

  // ─── Team Contents ─────────────────────────────────────────────────────────

  @Get('teams/:id/contents')
  @ApiOperation({ summary: 'List contents in team storage' })
  listTeamContents(@Param('id') teamId: string) {
    return this.teams.listTeamContents(teamId)
  }

  @Post('teams/:id/contents')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER', 'MEMBER')
  @ApiOperation({ summary: 'Add content to team storage' })
  addTeamContent(
    @Param('id') teamId: string,
    @Body('content_id') contentId: string,
    @Request() req: any,
  ) {
    return this.teams.addTeamContent(teamId, contentId, req.user.id, req.user.roles ?? [])
  }

  @Delete('teams/:id/contents/:contentId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER', 'MEMBER')
  @ApiOperation({ summary: 'Remove content from team storage' })
  removeTeamContent(
    @Param('id') teamId: string,
    @Param('contentId') contentId: string,
    @Request() req: any,
  ) {
    return this.teams.removeTeamContent(teamId, contentId, req.user.id, req.user.roles ?? [])
  }

  @Patch('teams/:id/contents/:contentId/push')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Push content from team storage to global catalog (LEADER/ADMIN/MANAGER)' })
  pushTeamContent(
    @Param('id') teamId: string,
    @Param('contentId') contentId: string,
    @Request() req: any,
  ) {
    return this.teams.pushTeamContentToGlobal(teamId, contentId, req.user.id, req.user.roles ?? [])
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

  @Post('upload-image')
  @ApiOperation({ summary: 'Upload product image — returns { url }' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image'))
  uploadProductImage(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new NotFoundException('No image file provided')
    const allowed = /^image\/(jpeg|png|gif|webp)$/
    if (!allowed.test(file.mimetype)) throw new NotFoundException('Only image files are allowed (jpg, png, gif, webp)')
    if (!fs.existsSync(PRODUCT_IMAGES_DIR)) fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true })
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
    fs.writeFileSync(path.join(PRODUCT_IMAGES_DIR, filename), file.buffer)
    const baseUrl = `${req.protocol}://${req.get('host')}`
    return { url: `${baseUrl}/api/task-auto/images/${filename}` }
  }

  @Get('images/:filename')
  @ApiOperation({ summary: 'Serve product image' })
  serveProductImage(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = path.basename(filename)
    const filePath = path.join(PRODUCT_IMAGES_DIR, safeName)
    if (!fs.existsSync(filePath)) throw new NotFoundException('Image not found')
    const ext = path.extname(safeName).toLowerCase()
    const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=604800')
    fs.createReadStream(filePath).pipe(res)
  }

  @Post('upload-voice')
  @ApiOperation({ summary: 'Upload content voice file — returns { url }' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('voice'))
  uploadVoiceFile(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new NotFoundException('No voice file provided')
    const allowed = /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac|x-m4a)|video\/mp4$/
    if (!allowed.test(file.mimetype)) throw new NotFoundException('Only audio files are allowed (mp3, wav, ogg, aac, flac, m4a)')
    const voiceDir = path.join(process.cwd(), 'uploads', 'voices')
    if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true })
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3'
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
    fs.writeFileSync(path.join(voiceDir, filename), file.buffer)
    const baseUrl = `${req.protocol}://${req.get('host')}`
    return { url: `${baseUrl}/api/task-auto/voices/${filename}` }
  }

  @Get('voices/:filename')
  @ApiOperation({ summary: 'Serve voice file' })
  serveVoiceFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = path.basename(filename)
    const filePath = path.join(process.cwd(), 'uploads', 'voices', safeName)
    if (!fs.existsSync(filePath)) throw new NotFoundException('Voice file not found')
    const ext = path.extname(safeName).toLowerCase()
    const mime: Record<string, string> = {
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
    }
    res.setHeader('Content-Type', mime[ext] || 'audio/mpeg')
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Accept-Ranges', 'bytes')
    fs.createReadStream(filePath).pipe(res)
  }

  // ─── Editor Approvals ─────────────────────────────────────────────────────

  @Get('editor-approvals')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'List editor approval requests' })
  getEditorApprovals(@Query('status') status?: string) {
    return this.teams.getEditorApprovals(status)
  }

  @Post('editor-approvals')
  @ApiOperation({ summary: 'Request editor role approval' })
  requestEditorApproval(@Request() req: any) {
    return this.teams.requestEditorApproval(req.user.id)
  }

  @Put('editor-approvals/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Approve or reject an editor request' })
  reviewEditorApproval(
    @Param('id') id: string,
    @Body() dto: EditorApprovalDto,
    @Request() req: any,
  ) {
    return this.teams.reviewEditorApproval(id, dto, req.user.id)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG — Products
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('products')
  @ApiOperation({ summary: 'List products' })
  getProducts(@Query() q: QueryProductDto) {
    return this.catalog.findAllProducts(q)
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Get product detail' })
  getProduct(@Param('id') id: string) {
    return this.catalog.findOneProduct(id)
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a product (all roles)' })
  createProduct(@Body() dto: CreateProductDto, @Request() req: any) {
    return this.catalog.createProduct(dto, req.user.id)
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Update a product (all roles)' })
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto)
  }

  @Delete('products/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a product' })
  deleteProduct(@Param('id') id: string) {
    return this.catalog.removeProduct(id)
  }

  @Get('product-lines')
  @ApiOperation({ summary: 'List product lines' })
  getProductLines() { return this.catalog.findProductLines() }

  @Get('materials')
  @ApiOperation({ summary: 'List materials' })
  getMaterials() { return this.catalog.findMaterials() }

  // ─── Catalog — Contents ───────────────────────────────────────────────────

  @Get('contents')
  @ApiOperation({ summary: 'List contents' })
  getContents(@Query() q: QueryContentDto) {
    return this.catalog.findAllContents(q)
  }

  @Get('contents/:id')
  @ApiOperation({ summary: 'Get content detail' })
  getContent(@Param('id') id: string) {
    return this.catalog.findOneContent(id)
  }

  @Post('contents')
  @ApiOperation({ summary: 'Create a content (all roles)' })
  createContent(@Body() dto: CreateContentDto, @Request() req: any) {
    return this.catalog.createContent(dto, req.user.id)
  }

  @Put('contents/:id')
  @ApiOperation({ summary: 'Update a content (all roles)' })
  updateContent(@Param('id') id: string, @Body() dto: UpdateContentDto) {
    return this.catalog.updateContent(id, dto)
  }

  @Delete('contents/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a content' })
  deleteContent(@Param('id') id: string) {
    return this.catalog.removeContent(id)
  }

  @Get('content-lines')
  @ApiOperation({ summary: 'List content lines' })
  getContentLines() { return this.catalog.findContentLines() }

  @Post("content-lines")
  @ApiOperation({ summary: "Create a content line (all roles)" })
  createContentLine(@Body("name") name: string) {
    return this.catalog.createContentLine(name);
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
  createProductLine(@Body("name") name: string) {
    return this.catalog.createProductLine(name);
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
  createMaterial(@Body("name") name: string) {
    return this.catalog.createMaterial(name);
  }

  @Delete("materials/:id")
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "MANAGER")
  @ApiOperation({ summary: "Delete a material" })
  deleteMaterial(@Param("id") id: string) {
    return this.catalog.removeMaterial(id);
  }

  // ─── Catalog — Sources ────────────────────────────────────────────────────

  @Get('sources')
  @ApiOperation({ summary: 'List sources' })
  getSources(@Query() q: QuerySourceDto) {
    return this.catalog.findAllSources(q)
  }

  @Get('sources/:id')
  @ApiOperation({ summary: 'Get source detail' })
  getSource(@Param('id') id: string) {
    return this.catalog.findOneSource(id)
  }

  @Post('sources')
  @ApiOperation({ summary: 'Create a source (all roles)' })
  createSource(@Body() dto: CreateSourceDto, @Request() req: any) {
    return this.catalog.createSource(dto, req.user.id)
  }

  @Put('sources/:id')
  @ApiOperation({ summary: 'Update a source (all roles)' })
  updateSource(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    return this.catalog.updateSource(id, dto)
  }

  @Delete('sources/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete a source' })
  deleteSource(@Param('id') id: string) {
    return this.catalog.removeSource(id)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KPI
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('kpi/teams')
  @ApiOperation({ summary: 'Get team KPIs' })
  getTeamKpis(@Query('month') month?: string) {
    return this.kpi.getTeamKpis(month)
  }

  @Post('kpi/teams')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Upsert team KPI (LEADER: own team only)' })
  upsertTeamKpi(@Body() dto: UpsertTeamKpiDto, @Request() req: any) {
    return this.kpi.upsertTeamKpi(dto, req.user.id, req.user.roles ?? [])
  }

  @Delete('kpi/teams/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Delete team KPI' })
  deleteTeamKpi(@Param('id') id: string) {
    return this.kpi.deleteTeamKpi(id)
  }

  @Get('kpi/editors')
  @ApiOperation({ summary: 'Get editor KPIs' })
  getEditorKpis(@Query('month') month?: string, @Query('user_id') userId?: string) {
    return this.kpi.getEditorKpis(month, userId)
  }

  @Post('kpi/editors')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Upsert editor KPI' })
  upsertEditorKpi(@Body() dto: UpsertEditorKpiDto, @Request() req: any) {
    return this.kpi.upsertEditorKpi(dto, req.user.id, req.user.roles ?? [])
  }

  @Delete('kpi/editors/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Delete editor KPI' })
  deleteEditorKpi(@Param('id') id: string) {
    return this.kpi.deleteEditorKpi(id)
  }

  @Get('kpi/weekend-editors')
  @ApiOperation({ summary: 'Get per-Sunday editor KPIs' })
  getEditorWeekendKpis(@Query('month') month?: string) {
    return this.kpi.getEditorWeekendKpis(month)
  }

  @Post('kpi/weekend-editors')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Upsert per-Sunday editor KPI' })
  upsertEditorWeekendKpi(@Body() dto: UpsertEditorWeekendKpiDto, @Request() req: any) {
    return this.kpi.upsertEditorWeekendKpi(dto, req.user.id, req.user.roles ?? [])
  }

  @Delete('kpi/weekend-editors/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Delete per-Sunday editor KPI' })
  deleteEditorWeekendKpi(@Param('id') id: string) {
    return this.kpi.deleteEditorWeekendKpi(id)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-ASSIGN SETTINGS & RUNS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('settings')
  @ApiOperation({ summary: 'Get auto-assign settings' })
  getSettings() {
    return this.assign.getSettings()
  }

  @Put('settings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update auto-assign settings' })
  updateSettings(@Body() dto: UpdateAutoAssignSettingDto, @Request() req: any) {
    return this.assign.updateSettings(dto, req.user.id)
  }

  @Get('assignment-runs')
  @ApiOperation({ summary: 'Get recent assignment runs' })
  getRuns(@Query('limit') limit?: string) {
    return this.assign.getRuns(limit ? parseInt(limit) : 50)
  }

  @Post('assignment-runs/trigger')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Manually trigger auto-assign run' })
  async triggerRun() {
    const result = await this.assign.triggerManually()
    return { message: 'Auto-assign triggered', timestamp: new Date(), ...result }
  }
}

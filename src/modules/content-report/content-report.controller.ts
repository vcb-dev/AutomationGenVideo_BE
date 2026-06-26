import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ContentReportService } from './content-report.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, PeriodType } from '@prisma/client';
import {
  CreateTeamDto,
  CreatePeriodDto,
  CreateContentVideoDto,
  UpdateContentVideoDto,
  CreateCaseStudyDto,
  UpdateCaseStudyDto,
  CreateEditorPerformanceDto,
  UpdateEditorPerformanceDto,
  CreateCloneVideoDto,
  UpdateCloneVideoDto,
  CreateActionItemDto,
  UpdateActionItemDto,
} from './dto';

@ApiTags('Content Report')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('content-report')
export class ContentReportController {
  constructor(private readonly contentReportService: ContentReportService) {}

  // ───────────────────── TEAMS ─────────────────────

  @Get('teams')
  @ApiOperation({ summary: 'Lấy danh sách các team' })
  async getTeams() {
    return this.contentReportService.getTeams();
  }

  @Post('teams')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  @ApiOperation({ summary: 'Tạo team mới (Chỉ Admin/Leader)' })
  async createTeam(@Body() dto: CreateTeamDto) {
    return this.contentReportService.createTeam(dto);
  }

  // ───────────────────── PERIODS ─────────────────────

  @Get('periods')
  @ApiOperation({ summary: 'Lấy danh sách các kỳ báo cáo' })
  @ApiQuery({ name: 'type', enum: PeriodType, required: false })
  async getPeriods(@Query('type') type?: PeriodType) {
    return this.contentReportService.getPeriods(type);
  }

  @Post('periods')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  @ApiOperation({ summary: 'Tạo kỳ báo cáo mới (Chỉ Admin/Leader)' })
  async createPeriod(@Body() dto: CreatePeriodDto) {
    return this.contentReportService.createPeriod(dto);
  }

  // ───────────────────── MAIN REPORT DATA ─────────────────────

  @Get('data')
  @ApiOperation({ summary: 'Lấy toàn bộ dữ liệu báo cáo cho 1 team và 1 kỳ báo cáo' })
  @ApiQuery({ name: 'team', type: String, required: true, example: 'K1' })
  @ApiQuery({ name: 'periodId', type: String, required: true })
  async getReportData(
    @Query('team') team: string,
    @Query('periodId') periodId: string,
  ) {
    return this.contentReportService.getReportData(team, periodId);
  }

  @Get('data/all-teams')
  @ApiOperation({ summary: 'Lấy dữ liệu báo cáo của tất cả các team theo kỳ báo cáo' })
  @ApiQuery({ name: 'periodId', type: String, required: true })
  async getAllTeamsReportData(@Query('periodId') periodId: string) {
    return this.contentReportService.getAllTeamsReportData(periodId);
  }

  // ───────────────────── CONTENT VIDEOS CRUD ─────────────────────

  @Post('content-videos')
  @ApiOperation({ summary: 'Thêm video win/fail mới cho team' })
  async createContentVideo(@Body() dto: CreateContentVideoDto) {
    return this.contentReportService.createContentVideo(dto);
  }

  @Patch('content-videos/:id')
  @ApiOperation({ summary: 'Cập nhật video win/fail' })
  async updateContentVideo(
    @Param('id') id: string,
    @Body() dto: UpdateContentVideoDto,
  ) {
    return this.contentReportService.updateContentVideo(id, dto);
  }

  @Delete('content-videos/:id')
  @ApiOperation({ summary: 'Xóa video win/fail' })
  async deleteContentVideo(@Param('id') id: string) {
    return this.contentReportService.deleteContentVideo(id);
  }

  // ───────────────────── CASE STUDIES CRUD ─────────────────────

  @Post('case-studies')
  @ApiOperation({ summary: 'Thêm case study mới' })
  async createCaseStudy(@Body() dto: CreateCaseStudyDto) {
    return this.contentReportService.createCaseStudy(dto);
  }

  @Patch('case-studies/:id')
  @ApiOperation({ summary: 'Cập nhật case study' })
  async updateCaseStudy(
    @Param('id') id: string,
    @Body() dto: UpdateCaseStudyDto,
  ) {
    return this.contentReportService.updateCaseStudy(id, dto);
  }

  @Delete('case-studies/:id')
  @ApiOperation({ summary: 'Xóa case study' })
  async deleteCaseStudy(@Param('id') id: string) {
    return this.contentReportService.deleteCaseStudy(id);
  }

  // ───────────────────── EDITOR PERFORMANCE CRUD ─────────────────────

  @Post('editor-performance')
  @ApiOperation({ summary: 'Thêm/cập nhật hiệu suất editor' })
  async createEditorPerformance(@Body() dto: CreateEditorPerformanceDto) {
    return this.contentReportService.createEditorPerformance(dto);
  }

  @Patch('editor-performance/:id')
  @ApiOperation({ summary: 'Cập nhật hiệu suất editor' })
  async updateEditorPerformance(
    @Param('id') id: string,
    @Body() dto: UpdateEditorPerformanceDto,
  ) {
    return this.contentReportService.updateEditorPerformance(id, dto);
  }

  @Delete('editor-performance/:id')
  @ApiOperation({ summary: 'Xóa hiệu suất editor' })
  async deleteEditorPerformance(@Param('id') id: string) {
    return this.contentReportService.deleteEditorPerformance(id);
  }

  // ───────────────────── CLONE VIDEOS CRUD ─────────────────────

  @Post('clone-videos')
  @ApiOperation({ summary: 'Thêm video clone mới' })
  async createCloneVideo(@Body() dto: CreateCloneVideoDto) {
    return this.contentReportService.createCloneVideo(dto);
  }

  @Patch('clone-videos/:id')
  @ApiOperation({ summary: 'Cập nhật video clone' })
  async updateCloneVideo(
    @Param('id') id: string,
    @Body() dto: UpdateCloneVideoDto,
  ) {
    return this.contentReportService.updateCloneVideo(id, dto);
  }

  @Delete('clone-videos/:id')
  @ApiOperation({ summary: 'Xóa video clone' })
  async deleteCloneVideo(@Param('id') id: string) {
    return this.contentReportService.deleteCloneVideo(id);
  }

  // ───────────────────── ACTION ITEMS CRUD ─────────────────────

  @Post('action-items')
  @ApiOperation({ summary: 'Thêm action item mới' })
  async createActionItem(@Body() dto: CreateActionItemDto) {
    return this.contentReportService.createActionItem(dto);
  }

  @Patch('action-items/:id')
  @ApiOperation({ summary: 'Cập nhật action item' })
  async updateActionItem(
    @Param('id') id: string,
    @Body() dto: UpdateActionItemDto,
  ) {
    return this.contentReportService.updateActionItem(id, dto);
  }

  @Delete('action-items/:id')
  @ApiOperation({ summary: 'Xóa action item' })
  async deleteActionItem(@Param('id') id: string) {
    return this.contentReportService.deleteActionItem(id);
  }

  // ───────────────────── KPI SNAPSHOT ─────────────────────

  @Post('kpi-snapshot/compute')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  @ApiOperation({ summary: 'Tính toán và lưu cache KPI snapshot cho team + period (Chỉ Admin/Leader)' })
  async computeKpiSnapshot(
    @Body('team') team: string,
    @Body('periodId') periodId: string,
  ) {
    return this.contentReportService.computeKpiSnapshot(team, periodId);
  }

  // ───────────────────── SEED ─────────────────────

  @Post('seed')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Tạo dữ liệu team và kỳ báo cáo mặc định (Chỉ Admin)' })
  async seedInitialData() {
    return this.contentReportService.seedInitialData();
  }
}

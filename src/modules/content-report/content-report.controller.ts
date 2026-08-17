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
  Request,
} from '@nestjs/common';
import axios from 'axios';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ContentReportService } from './content-report.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  CreateVideoScoreDto,
  CreateMeetingSessionDto,
  UpsertAttendanceDto,
  BulkAttendanceDto,
  AttendanceHistoryQueryDto,
  UserHistoryQueryDto,
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

  // ───────────────────── TIKTOK RESOLVER ─────────────────────

  @Get('resolve-tiktok')
  @ApiOperation({ summary: 'Giải mã link rút gọn vt.tiktok.com thành id video nhúng' })
  @ApiQuery({ name: 'url', type: String, required: true })
  async resolveTiktokUrl(@Query('url') url: string) {
    // 1. Check if the input URL already contains the video ID
    const ttRegex = /tiktok\.com\/.*\/(?:video|photo)\/(\d+)/;
    const initialMatch = url.match(ttRegex);
    if (initialMatch && initialMatch[1]) {
      const isPhoto = url.includes('/photo/');
      return { success: true, videoId: initialMatch[1], isPhoto };
    }

    // 2. Otherwise, resolve the redirect on server side
    try {
      const res = await axios.get(url, {
        maxRedirects: 5,
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const resolvedUrl = res.request?.res?.responseUrl || res.config?.url || url;
      
      const ttMatch = resolvedUrl.match(ttRegex);
      if (ttMatch && ttMatch[1]) {
        const isPhoto = resolvedUrl.includes('/photo/');
        return { success: true, videoId: ttMatch[1], isPhoto };
      }
      return { success: false, message: 'Could not extract video ID from resolved URL: ' + resolvedUrl };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ───────────────────── VIDEO SCORING ─────────────────────

  @Post('content-videos/:id/score')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Chấm điểm hoặc cập nhật điểm số video (1-10)' })
  async upsertVideoScore(
    @Param('id') contentVideoId: string,
    @Request() req: any,
    @Body() dto: CreateVideoScoreDto,
  ) {
    return this.contentReportService.upsertVideoScore(contentVideoId, req.user.id, dto);
  }

  @Get('content-videos/:id/scores')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy toàn bộ điểm chấm chéo của một video' })
  async getVideoScores(@Param('id') contentVideoId: string) {
    return this.contentReportService.getVideoScores(contentVideoId);
  }

  // ───────────────────── SEED ─────────────────────

  @Post('seed')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Tạo dữ liệu team và kỳ báo cáo mặc định (Chỉ Admin)' })
  async seedInitialData() {
    return this.contentReportService.seedInitialData();
  }

  // ───────────────────── ATTENDANCE ─────────────────────

  /**
   * Lịch sử điểm danh cả team theo tháng (bảng ma trận).
   * Chỉ Manager/Leader của team đó hoặc Admin.
   */
  @Get('attendance/history')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Lịch sử điểm danh cả team (Manager/Leader/Admin)' })
  @ApiQuery({ name: 'team', type: String, required: true, example: 'K1' })
  @ApiQuery({ name: 'month', type: Number, required: true, example: 7 })
  @ApiQuery({ name: 'year', type: Number, required: true, example: 2026 })
  async getAttendanceHistory(
    @Query() query: AttendanceHistoryQueryDto,
    @Request() req: any,
  ) {
    return this.contentReportService.getAttendanceHistory(query, req.user.id);
  }

  /**
   * Lịch sử điểm danh của 1 cá nhân theo tháng.
   * Member xem chính mình; Manager/Leader xem member thuộc team mình; Admin xem tất cả.
   */
  @Get('attendance/history/:userId')
  @ApiOperation({ summary: 'Lịch sử điểm danh cá nhân' })
  @ApiQuery({ name: 'month', type: Number, required: true, example: 7 })
  @ApiQuery({ name: 'year', type: Number, required: true, example: 2026 })
  async getUserAttendanceHistory(
    @Param('userId') userId: string,
    @Query() query: UserHistoryQueryDto,
    @Request() req: any,
  ) {
    return this.contentReportService.getUserAttendanceHistory(userId, query, req.user.id);
  }

  /**
   * Tạo hoặc cập nhật buổi họp.
   * Chỉ Manager/Leader/Admin. Manager chỉ được tạo cho team của mình.
   */
  @Post('meetings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Tạo / cập nhật buổi họp (Manager/Leader/Admin)' })
  async upsertMeetingSession(
    @Body() dto: CreateMeetingSessionDto,
    @Request() req: any,
  ) {
    return this.contentReportService.upsertMeetingSession(dto, req.user.id);
  }

  /**
   * Lấy session + DS điểm danh của team theo kỳ.
   */
  @Get('meetings')
  @ApiOperation({ summary: 'Lấy session họp + DS điểm danh theo team và kỳ' })
  @ApiQuery({ name: 'team', type: String, required: true, example: 'K1' })
  @ApiQuery({ name: 'periodId', type: String, required: true })
  async getMeetingSession(
    @Query('team') team: string,
    @Query('periodId') periodId: string,
  ) {
    return this.contentReportService.getMeetingSession(team, periodId);
  }

  /**
   * Tự điểm danh (self check-in).
   * user_id BUỘC từ req.user.id (JWT) — không nhận từ body.
   * Kiểm tra user thuộc team của session trước khi upsert.
   */
  @Post('meetings/:id/attendance')
  @ApiOperation({ summary: 'Tự điểm danh (self check-in) — user_id lấy từ JWT' })
  async selfCheckIn(
    @Param('id') sessionId: string,
    @Request() req: any,
    @Body() dto: UpsertAttendanceDto,
  ) {
    return this.contentReportService.selfCheckIn(sessionId, req.user.id, dto);
  }

  /**
   * Manager/Admin bulk upsert điểm danh nhiều người trong 1 request.
   * Toàn bộ chạy trong transaction — 1 fail → rollback hết.
   */
  @Patch('meetings/:id/attendance/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Bulk điểm danh cả team trong 1 transaction (Manager/Leader/Admin)' })
  async bulkUpsertAttendance(
    @Param('id') sessionId: string,
    @Request() req: any,
    @Body() dto: BulkAttendanceDto,
  ) {
    return this.contentReportService.bulkUpsertAttendance(sessionId, dto, req.user.id);
  }

  /**
   * Manager/Admin sửa điểm danh 1 người.
   * Kiểm tra session.team_id khớp team mà actor quản lý.
   */
  @Patch('meetings/:id/attendance/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Manager sửa điểm danh 1 người (Manager/Leader/Admin)' })
  async managerUpsertAttendance(
    @Param('id') sessionId: string,
    @Param('userId') targetUserId: string,
    @Request() req: any,
    @Body() dto: UpsertAttendanceDto,
  ) {
    return this.contentReportService.managerUpsertAttendance(
      sessionId,
      targetUserId,
      dto,
      req.user.id,
    );
  }

  @Post('meetings/:id/finalize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Chốt buổi họp (Manager/Leader/Admin)' })
  async finalizeMeetingSession(
    @Param('id') sessionId: string,
    @Request() req: any,
  ) {
    return this.contentReportService.finalizeMeetingSession(sessionId, req.user.id);
  }

  @Post('meetings/:id/reopen')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mở lại buổi họp (Manager/Leader/Admin)' })
  async reopenMeetingSession(
    @Param('id') sessionId: string,
    @Request() req: any,
  ) {
    return this.contentReportService.reopenMeetingSession(sessionId, req.user.id);
  }
}

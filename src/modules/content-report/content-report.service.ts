import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { PeriodType, VideoStatus, AttendanceStatus, UserRole } from '@prisma/client';
import { DateTime } from 'luxon';
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

// Báo cáo content chỉ áp dụng cho 4 team này — không phải toàn bộ team trong hệ thống
// (bảng `teams` còn chứa nhiều team/phòng ban khác như AFF, Đá Quý, Global, MEDIA...
// không thuộc phạm vi báo cáo content hàng tuần).
export const CONTENT_REPORT_TEAM_NAMES = ['Team K1', 'Team K2', 'Team K3', 'Team K4'];

@Injectable()
export class ContentReportService {
  private readonly logger = new Logger(ContentReportService.name);

  /**
   * Cache TTL cho dữ liệu báo cáo content. DB ở xa (Supabase Tokyo, RTT ~300ms/query)
   * nên mỗi lần load 1 team tốn ~1.4s thuần round-trip; user chuyển tab K1→K2→K1 liên tục
   * khiến trang cảm giác rất chậm. Mọi mutation trong module này đều invalidate prefix
   * (xem invalidateReportCache) nên TTL dài một chút cũng không hiển thị dữ liệu cũ.
   */
  private static readonly REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly CACHE_PREFIX = 'content-report:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) { }

  /** Xoá toàn bộ cache báo cáo content — gọi sau MỌI mutation để dữ liệu mới hiện ngay. */
  private invalidateReportCache(): void {
    // fire-and-forget: invalidate in-memory là đồng bộ, Redis (nếu bật) chạy nền
    void this.cacheService.invalidate(ContentReportService.CACHE_PREFIX);
  }

  /** Await mutation xong mới xoá cache (tránh race refill cache bằng dữ liệu cũ), rồi trả kết quả. */
  private async mutate<T>(op: Promise<T>): Promise<T> {
    const result = await op;
    this.invalidateReportCache();
    return result;
  }

  private async resolveUser(id?: string, name?: string): Promise<string> {
    if (id && id.length > 10) {
      const user = await this.prisma.user.findUnique({ where: { id } });
      if (user) return user.id;
    }
    if (name) {
      const user = await this.prisma.user.findFirst({
        where: { full_name: { equals: name.trim(), mode: 'insensitive' } }
      });
      if (user) return user.id;
    }
    const fallbackUser = await this.prisma.user.findFirst();
    if (!fallbackUser) {
      throw new NotFoundException('Không tìm thấy user nào trong database để làm fallback');
    }
    return fallbackUser.id;
  }

  // ───────────────────── TEAMS ─────────────────────

  async getTeams() {
    return this.cacheService.get(
      `${ContentReportService.CACHE_PREFIX}teams`,
      ContentReportService.REPORT_CACHE_TTL_MS,
      () => this.prisma.team.findMany({
        where: { name: { in: CONTENT_REPORT_TEAM_NAMES } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async createTeam(dto: CreateTeamDto) {
    try {
      return await this.mutate(this.prisma.team.create({
        data: { name: dto.name },
      }));
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Team "${dto.name}" đã tồn tại`);
      }
      throw e;
    }
  }

  // ───────────────────── PERIODS ─────────────────────

  async getPeriods(type?: PeriodType) {
    return this.cacheService.get(
      `${ContentReportService.CACHE_PREFIX}periods:${type || 'all'}`,
      ContentReportService.REPORT_CACHE_TTL_MS,
      () => this.prisma.reportPeriod.findMany({
        where: type ? { type } : undefined,
        orderBy: { start_date: 'desc' },
      }),
    );
  }

  async createPeriod(dto: CreatePeriodDto) {
    try {
      return await this.mutate(this.prisma.reportPeriod.create({
        data: {
          type: dto.type,
          label: dto.label,
          start_date: new Date(dto.start_date),
          end_date: new Date(dto.end_date),
        },
      }));
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Kỳ báo cáo ${dto.type} bắt đầu ${dto.start_date} đã tồn tại`);
      }
      throw e;
    }
  }

  // ───────────────────── MAIN REPORT DATA ─────────────────────

  /**
   * API chính — lấy toàn bộ data báo cáo cho 1 team + 1 kỳ.
   * Trả về cấu trúc tương tự TeamData trên FE.
   */
  async getReportData(teamName: string, periodId: string) {
    return this.cacheService.get(
      `${ContentReportService.CACHE_PREFIX}data:${teamName}:${periodId}`,
      ContentReportService.REPORT_CACHE_TTL_MS,
      () => this.buildReportData(teamName, periodId),
    );
  }

  private async buildReportData(teamName: string, periodId: string) {
    // Chạy song song — DB ở xa nên mỗi round-trip tuần tự cộng thẳng vào thời gian phản hồi
    const [team, period] = await Promise.all([
      this.prisma.team.findUnique({ where: { name: teamName } }),
      this.prisma.reportPeriod.findUnique({ where: { id: periodId } }),
    ]);
    if (!team) throw new NotFoundException(`Team "${teamName}" không tồn tại`);
    if (!period) throw new NotFoundException(`Kỳ báo cáo không tồn tại`);

    // Resolve period IDs to query (if MONTH, include child WEEKs)
    let periodIds = [periodId];
    if (period.type === 'MONTH') {
      const childWeeks = await this.prisma.reportPeriod.findMany({
        where: {
          type: 'WEEK',
          start_date: { gte: period.start_date },
          end_date: { lte: period.end_date },
        },
        select: { id: true }
      });
      periodIds = [periodId, ...childWeeks.map(w => w.id)];
    }

    const whereTeamPeriod = {
      team_id: team.id,
      period_id: { in: periodIds }
    };

    const [winVideos, failVideos, caseStudies, editorPerformance, cloneVideos, actionItems, kpiSnapshot, teamMembers] =
      await Promise.all([
        this.prisma.contentVideo.findMany({
          where: { ...whereTeamPeriod, status: VideoStatus.WIN },
          include: {
            editor: { select: { id: true, full_name: true, image_url: true } },
            scores: { include: { scored_by: { select: { id: true, full_name: true } } } },
          },
          orderBy: [
            { order_index: 'asc' },
            { post_date: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.contentVideo.findMany({
          where: { ...whereTeamPeriod, status: VideoStatus.FAIL },
          include: {
            editor: { select: { id: true, full_name: true, image_url: true } },
            scores: { include: { scored_by: { select: { id: true, full_name: true } } } },
          },
          orderBy: [
            { order_index: 'asc' },
            { post_date: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.caseStudy.findMany({
          where: whereTeamPeriod,
          include: { creator: { select: { id: true, full_name: true } } },
          orderBy: [
            { order_index: 'asc' },
            { post_date: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.editorPerformance.findMany({
          where: whereTeamPeriod,
          include: { user: { select: { id: true, full_name: true, image_url: true } } },
        }),
        this.prisma.cloneVideo.findMany({
          where: whereTeamPeriod,
          include: { editor: { select: { id: true, full_name: true } } },
          orderBy: [
            { order_index: 'asc' },
            { post_date: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.actionItem.findMany({
          where: whereTeamPeriod,
          include: { assignee: { select: { id: true, full_name: true } } },
          orderBy: [
            { deadline: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.teamKpiSnapshot.findUnique({
          where: { team_id_period_id: { team_id: team.id, period_id: periodId } },
        }),
        this.prisma.user.findMany({
          where: {
            is_active: true,
            team: {
              contains: teamName,
              mode: 'insensitive',
            },
          },
          select: {
            full_name: true,
          },
        }),
      ]);

    // Transform to FE-friendly format
    const totalVids = winVideos.length + failVideos.length;
    const winCount = winVideos.length;
    const members = (teamMembers || []).map((m) => m.full_name);

    return {
      teamId: team.id,
      teamName: team.name,
      periodId: period.id,
      periodLabel: period.label,
      members,
      win5Stats: kpiSnapshot
        ? {
          total: kpiSnapshot.total_videos,
          win: kpiSnapshot.win_videos,
          fail: kpiSnapshot.fail_videos,
          percent: kpiSnapshot.total_videos > 0
            ? `${((kpiSnapshot.win_videos / kpiSnapshot.total_videos) * 100).toFixed(1)}%`
            : '0.0%',
        }
        : {
          total: totalVids,
          win: winCount,
          fail: failVideos.length,
          percent: totalVids > 0 ? `${((winCount / totalVids) * 100).toFixed(1)}%` : '0.0%',
        },
      newVideoStats: kpiSnapshot
        ? {
          total: kpiSnapshot.total_new_videos,
          win: kpiSnapshot.new_win_videos,
          fail: kpiSnapshot.total_new_videos - kpiSnapshot.new_win_videos,
          percent: kpiSnapshot.total_new_videos > 0
            ? `${((kpiSnapshot.new_win_videos / kpiSnapshot.total_new_videos) * 100).toFixed(1)}%`
            : '0.0%',
        }
        : { total: 0, win: 0, fail: 0, percent: '0.0%' },
      videos: winVideos.map((v, i) => ({
        id: i + 1,
        dbId: v.id,
        label: `Video ${i + 1}`,
        content: v.content,
        analysis: v.analysis || '',
        editor: v.editor.full_name,
        editorId: v.editor_id,
        views: this.formatViews(Number(v.views)),
        likes: String(v.likes),
        comments: String(v.comments),
        shares: String(v.shares),
        platform: v.platform || '',
        postDate: v.post_date?.toISOString().split('T')[0] || '',
        highlights: v.highlights || '',
        improvements: v.improvements || '',
        leaderComment: v.leader_comment || '',
        notes: v.notes || '',
        thumbnail: v.thumbnail_url || '',
        videoUrl: v.video_url || '',
        scores: v.scores || [],
      })),
      failVideos: failVideos.map((v, i) => ({
        id: i + 1,
        dbId: v.id,
        label: `Video ${i + 1}`,
        content: v.content,
        failReason: v.analysis || '',
        editor: v.editor.full_name,
        editorId: v.editor_id,
        views: this.formatViews(Number(v.views)),
        likes: String(v.likes),
        comments: String(v.comments),
        shares: String(v.shares),
        platform: v.platform || '',
        postDate: v.post_date?.toISOString().split('T')[0] || '',
        highlights: v.highlights || '',
        improvements: v.improvements || '',
        leaderComment: v.leader_comment || '',
        notes: v.notes || '',
        thumbnail: v.thumbnail_url || '',
        videoUrl: v.video_url || '',
        scores: v.scores || [],
      })),
      caseStudies: caseStudies.map((cs, i) => ({
        id: i + 1,
        dbId: cs.id,
        label: `Case ${i + 1}`,
        title: cs.title,
        channel: cs.channel || '',
        views: this.formatViews(Number(cs.views)),
        takeaway: cs.takeaway || '',
        platform: cs.platform || '',
        postDate: cs.post_date?.toISOString().split('T')[0] || '',
      })),
      editorPerformance: editorPerformance.map((ep) => ({
        dbId: ep.id,
        editor: ep.user.full_name,
        editorId: ep.user_id,
        totalVideos: ep.total_videos,
        winVideos: ep.win_videos,
        failVideos: ep.total_videos - ep.win_videos,
        winRate: ep.total_videos > 0
          ? `${((ep.win_videos / ep.total_videos) * 100).toFixed(1)}%`
          : '0.0%',
        notes: ep.notes || '',
        analysis: ep.analysis || '',
      })),
      cloneVideos: cloneVideos.map((cv, i) => ({
        id: i + 1,
        dbId: cv.id,
        label: `Clone ${i + 1}`,
        content: cv.content,
        targetChannel: cv.target_channel || '',
        editor: cv.editor.full_name,
        editorId: cv.editor_id,
        views: this.formatViews(Number(cv.views)),
        likes: String(cv.likes),
        comments: String(cv.comments),
        shares: String(cv.shares),
        platform: cv.platform || '',
        postDate: cv.post_date?.toISOString().split('T')[0] || '',
        analysis: cv.analysis || '',
        highlights: cv.highlights || '',
        improvements: cv.improvements || '',
        leaderComment: cv.leader_comment || '',
        notes: cv.notes || '',
        videoUrl: cv.video_url || '',
      })),
      actions: actionItems.map((ai, i) => ({
        id: i + 1,
        dbId: ai.id,
        title: ai.title,
        description: ai.description || '',
        assignee: ai.assignee.full_name,
        assigneeId: ai.assignee_id,
        deadline: ai.deadline?.toISOString().split('T')[0] || '',
        status: ai.status,
        priority: ai.priority,
        notes: ai.notes || '',
        leaderComment: ai.leader_comment || '',
      })),
    };
  }

  /**
   * Lấy report data cho TẤT CẢ teams theo period
   * (dùng khi FE cần load tất cả team 1 lần — giống constants.ts hiện tại)
   */
  async getAllTeamsReportData(periodId: string) {
    const teams = await this.prisma.team.findMany({
      where: { name: { in: CONTENT_REPORT_TEAM_NAMES } },
      orderBy: { name: 'asc' },
    });
    const result: Record<string, any> = {};

    for (const team of teams) {
      result[team.name] = await this.getReportData(team.name, periodId);
    }

    return result;
  }

  // ───────────────────── CONTENT VIDEOS CRUD ─────────────────────

  async createContentVideo(dto: CreateContentVideoDto) {
    const editor_id = await this.resolveUser(dto.editor_id, dto.editor);
    return this.mutate(this.prisma.contentVideo.create({
      data: {
        team_id: dto.team_id,
        period_id: dto.period_id,
        editor_id,
        status: dto.status,
        content: dto.content,
        analysis: dto.analysis,
        link: dto.link,
        platform: dto.platform,
        post_date: dto.post_date ? new Date(dto.post_date) : undefined,
        views: dto.views ?? 0,
        likes: dto.likes ?? 0,
        comments: dto.comments ?? 0,
        shares: dto.shares ?? 0,
        thumbnail_url: dto.thumbnail_url,
        video_url: dto.video_url,
        highlights: dto.highlights,
        improvements: dto.improvements,
        leader_comment: dto.leader_comment,
        notes: dto.notes,
        order_index: dto.order_index ?? 0,
      },
      include: { editor: { select: { id: true, full_name: true } } },
    }));
  }

  async updateContentVideo(id: string, dto: UpdateContentVideoDto) {
    const data: any = {};

    // Resolve editor name → editor_id
    if (dto.editor || dto.editor_id) {
      data.editor_id = await this.resolveUser(dto.editor_id, dto.editor);
    }

    // Only pick fields that exist in Prisma ContentVideo model
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.analysis !== undefined) data.analysis = dto.analysis;
    if (dto.link !== undefined) data.link = dto.link;
    if (dto.platform !== undefined) data.platform = dto.platform;
    if (dto.post_date !== undefined) data.post_date = new Date(dto.post_date);
    if (dto.views !== undefined) data.views = dto.views;
    if (dto.likes !== undefined) data.likes = dto.likes;
    if (dto.comments !== undefined) data.comments = dto.comments;
    if (dto.shares !== undefined) data.shares = dto.shares;
    if (dto.thumbnail_url !== undefined) data.thumbnail_url = dto.thumbnail_url;
    if (dto.video_url !== undefined) data.video_url = dto.video_url;
    if (dto.highlights !== undefined) data.highlights = dto.highlights;
    if (dto.improvements !== undefined) data.improvements = dto.improvements;
    if (dto.leader_comment !== undefined) data.leader_comment = dto.leader_comment;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.order_index !== undefined) data.order_index = dto.order_index;

    return this.mutate(this.prisma.contentVideo.update({
      where: { id },
      data,
      include: { editor: { select: { id: true, full_name: true } } },
    }));
  }

  async deleteContentVideo(id: string) {
    return this.mutate(this.prisma.contentVideo.delete({ where: { id } }));
  }

  // ───────────────────── CASE STUDIES CRUD ─────────────────────

  async createCaseStudy(dto: CreateCaseStudyDto) {
    const created_by = await this.resolveUser(dto.created_by, dto.creator_name);
    return this.mutate(this.prisma.caseStudy.create({
      data: {
        team_id: dto.team_id,
        period_id: dto.period_id,
        created_by,
        title: dto.title,
        channel: dto.channel,
        content: dto.content,
        takeaway: dto.takeaway,
        link: dto.link,
        platform: dto.platform,
        post_date: dto.post_date ? new Date(dto.post_date) : undefined,
        views: dto.views ?? 0,
        order_index: dto.order_index ?? 0,
      },
      include: { creator: { select: { id: true, full_name: true } } },
    }));
  }

  async updateCaseStudy(id: string, dto: UpdateCaseStudyDto) {
    const data: any = { ...dto };
    if (dto.post_date) data.post_date = new Date(dto.post_date);
    return this.mutate(this.prisma.caseStudy.update({
      where: { id },
      data,
      include: { creator: { select: { id: true, full_name: true } } },
    }));
  }

  async deleteCaseStudy(id: string) {
    return this.mutate(this.prisma.caseStudy.delete({ where: { id } }));
  }

  // ───────────────────── EDITOR PERFORMANCE CRUD ─────────────────────

  async createEditorPerformance(dto: CreateEditorPerformanceDto) {
    try {
      const user_id = await this.resolveUser(dto.user_id, dto.editor);
      return await this.mutate(this.prisma.editorPerformance.create({
        data: {
          team_id: dto.team_id,
          period_id: dto.period_id,
          user_id,
          total_videos: dto.total_videos ?? 0,
          win_videos: dto.win_videos ?? 0,
          notes: dto.notes,
          analysis: dto.analysis,
        },
        include: { user: { select: { id: true, full_name: true } } },
      }));
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('Editor này đã có record trong kỳ báo cáo này');
      }
      throw e;
    }
  }

  async updateEditorPerformance(id: string, dto: UpdateEditorPerformanceDto) {
    const data: any = { ...dto };
    if (dto.editor || dto.user_id) {
      data.user_id = await this.resolveUser(dto.user_id, dto.editor);
      delete data.editor;
    }
    return this.mutate(this.prisma.editorPerformance.update({
      where: { id },
      data,
      include: { user: { select: { id: true, full_name: true } } },
    }));
  }

  async deleteEditorPerformance(id: string) {
    return this.mutate(this.prisma.editorPerformance.delete({ where: { id } }));
  }

  // ───────────────────── CLONE VIDEOS CRUD ─────────────────────

  async createCloneVideo(dto: CreateCloneVideoDto) {
    const editor_id = await this.resolveUser(dto.editor_id, dto.editor);
    return this.mutate(this.prisma.cloneVideo.create({
      data: {
        team_id: dto.team_id,
        period_id: dto.period_id,
        editor_id,
        content: dto.content,
        target_channel: dto.target_channel,
        link: dto.link,
        platform: dto.platform,
        post_date: dto.post_date ? new Date(dto.post_date) : undefined,
        views: dto.views ?? 0,
        likes: dto.likes ?? 0,
        comments: dto.comments ?? 0,
        shares: dto.shares ?? 0,
        analysis: dto.analysis,
        highlights: dto.highlights,
        improvements: dto.improvements,
        leader_comment: dto.leader_comment,
        notes: dto.notes,
        video_url: dto.video_url,
        order_index: dto.order_index ?? 0,
      },
      include: { editor: { select: { id: true, full_name: true } } },
    }));
  }

  async updateCloneVideo(id: string, dto: UpdateCloneVideoDto) {
    const data: any = { ...dto };
    if (dto.post_date) data.post_date = new Date(dto.post_date);
    if (dto.editor || dto.editor_id) {
      data.editor_id = await this.resolveUser(dto.editor_id, dto.editor);
      delete data.editor;
    }
    return this.mutate(this.prisma.cloneVideo.update({
      where: { id },
      data,
      include: { editor: { select: { id: true, full_name: true } } },
    }));
  }

  async deleteCloneVideo(id: string) {
    return this.mutate(this.prisma.cloneVideo.delete({ where: { id } }));
  }

  // ───────────────────── ACTION ITEMS CRUD ─────────────────────

  async createActionItem(dto: CreateActionItemDto) {
    const assignee_id = await this.resolveUser(dto.assignee_id, dto.assignee);
    return this.mutate(this.prisma.actionItem.create({
      data: {
        team_id: dto.team_id,
        period_id: dto.period_id,
        assignee_id,
        title: dto.title,
        description: dto.description,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        status: dto.status ?? 'PENDING',
        priority: dto.priority ?? 'MEDIUM',
        notes: dto.notes,
        leader_comment: dto.leader_comment,
      },
      include: { assignee: { select: { id: true, full_name: true } } },
    }));
  }

  async updateActionItem(id: string, dto: UpdateActionItemDto) {
    const data: any = { ...dto };
    if (dto.deadline) data.deadline = new Date(dto.deadline);
    if (dto.assignee || dto.assignee_id) {
      data.assignee_id = await this.resolveUser(dto.assignee_id, dto.assignee);
      delete data.assignee;
    }
    return this.mutate(this.prisma.actionItem.update({
      where: { id },
      data,
      include: { assignee: { select: { id: true, full_name: true } } },
    }));
  }

  async deleteActionItem(id: string) {
    return this.mutate(this.prisma.actionItem.delete({ where: { id } }));
  }

  // ───────────────────── KPI SNAPSHOT ─────────────────────

  async computeKpiSnapshot(teamName: string, periodId: string) {
    const team = await this.prisma.team.findUnique({ where: { name: teamName } });
    if (!team) throw new NotFoundException(`Team "${teamName}" không tồn tại`);

    const whereTeamPeriod = { team_id: team.id, period_id: periodId };

    const [totalWin, totalFail] = await Promise.all([
      this.prisma.contentVideo.count({ where: { ...whereTeamPeriod, status: VideoStatus.WIN } }),
      this.prisma.contentVideo.count({ where: { ...whereTeamPeriod, status: VideoStatus.FAIL } }),
    ]);

    const totalVideos = totalWin + totalFail;
    const winRate = totalVideos > 0 ? (totalWin / totalVideos) * 100 : 0;

    return this.mutate(this.prisma.teamKpiSnapshot.upsert({
      where: { team_id_period_id: { team_id: team.id, period_id: periodId } },
      create: {
        team_id: team.id,
        period_id: periodId,
        total_videos: totalVideos,
        win_videos: totalWin,
        fail_videos: totalFail,
        win_rate: parseFloat(winRate.toFixed(1)),
        computed_at: new Date(),
      },
      update: {
        total_videos: totalVideos,
        win_videos: totalWin,
        fail_videos: totalFail,
        win_rate: parseFloat(winRate.toFixed(1)),
        computed_at: new Date(),
      },
    }));
  }

  // ───────────────────── SEED ─────────────────────

  /**
   * Seed dữ liệu ban đầu: teams K1-K4 + kỳ báo cáo tháng 6/2026
   */
  async seedInitialData() {
    const teamNames = CONTENT_REPORT_TEAM_NAMES;

    const teams = [];
    for (const name of teamNames) {
      const team = await this.prisma.team.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      teams.push(team);
    }

    // Tạo kỳ báo cáo tuần 1-4 tháng 6/2026
    const weeks = [
      { label: 'Tuần 1 - T6/2026', start: '2026-06-01', end: '2026-06-07' },
      { label: 'Tuần 2 - T6/2026', start: '2026-06-08', end: '2026-06-14' },
      { label: 'Tuần 3 - T6/2026', start: '2026-06-15', end: '2026-06-21' },
      { label: 'Tuần 4 - T6/2026', start: '2026-06-22', end: '2026-06-28' },
    ];

    const periods = [];
    for (const w of weeks) {
      const period = await this.prisma.reportPeriod.upsert({
        where: {
          type_start_date: {
            type: PeriodType.WEEK,
            start_date: new Date(w.start),
          },
        },
        update: {},
        create: {
          type: PeriodType.WEEK,
          label: w.label,
          start_date: new Date(w.start),
          end_date: new Date(w.end),
        },
      });
      periods.push(period);
    }

    // Tạo kỳ tháng
    const monthPeriod = await this.prisma.reportPeriod.upsert({
      where: {
        type_start_date: {
          type: PeriodType.MONTH,
          start_date: new Date('2026-06-01'),
        },
      },
      update: {},
      create: {
        type: PeriodType.MONTH,
        label: 'Tháng 6/2026',
        start_date: new Date('2026-06-01'),
        end_date: new Date('2026-06-30'),
      },
    });
    periods.push(monthPeriod);

    this.invalidateReportCache();
    return { teams, periods };
  }

  // ───────────────────── VIDEO SCORING ─────────────────────

  async upsertVideoScore(contentVideoId: string, userId: string, dto: CreateVideoScoreDto) {
    const video = await this.prisma.contentVideo.findUnique({
      where: { id: contentVideoId },
    });
    if (!video) throw new NotFoundException(`Video không tồn tại`);

    // Calculate score_total as average of 5 criteria
    const total = (dto.score_hook + dto.score_content + dto.score_editing + dto.score_cta + dto.score_thumbnail) / 5;
    const score_total = Math.round(total * 100) / 100;

    return this.mutate(this.prisma.videoScore.upsert({
      where: {
        content_video_id_scored_by_id: {
          content_video_id: contentVideoId,
          scored_by_id: userId,
        },
      },
      update: {
        score_hook: dto.score_hook,
        score_content: dto.score_content,
        score_editing: dto.score_editing,
        score_cta: dto.score_cta,
        score_thumbnail: dto.score_thumbnail,
        score_total,
        comment: dto.comment,
      },
      create: {
        content_video_id: contentVideoId,
        scored_by_id: userId,
        score_hook: dto.score_hook,
        score_content: dto.score_content,
        score_editing: dto.score_editing,
        score_cta: dto.score_cta,
        score_thumbnail: dto.score_thumbnail,
        score_total,
        comment: dto.comment,
      },
      include: {
        scored_by: {
          select: {
            id: true,
            full_name: true,
          },
        },
      },
    }));
  }

  async getVideoScores(contentVideoId: string) {
    return this.prisma.videoScore.findMany({
      where: { content_video_id: contentVideoId },
      include: {
        scored_by: {
          select: {
            id: true,
            full_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ───────────────────── HELPERS ─────────────────────

  private formatViews(views: number): string {
    return views.toString();
  }

  // ───────────────────── ATTENDANCE ─────────────────────

  /**
   * Kiểm tra actor có quyền quản lý team không.
   * Admin: được mọi team.
   * Manager/Leader: chỉ được team của mình (team_id khớp với user.team hoặc user là leader).
   */
  private async assertManagerCanEditTeam(actorId: string, teamId: string): Promise<void> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        roles: true,
        team: true,
        teams_leading: { select: { id: true, name: true } },
        team_memberships: { select: { team_id: true } }
      },
    });
    if (!actor) throw new NotFoundException('Không tìm thấy user');

    this.logger.log(
      `assertManagerCanEditTeam debug: actorId=${actorId}, teamId=${teamId}, roles=${JSON.stringify(actor.roles)}, teamName=${actor.team}`
    );

    // Admin bypasses all checks
    if (actor.roles.includes(UserRole.ADMIN)) return;

    // Resolve team_ids from actor.team (parsed as comma-separated list, e.g. "Team K1, MEDIA, Scale Data" -> ["K1", "MEDIA", "Scale Data"])
    const resolvedTeamIds: string[] = [];
    if (actor.team) {
      const parsedNames = actor.team
        .split(',')
        .map((t) => {
          let trimmed = t.trim();
          if (trimmed.toLowerCase().startsWith('team ')) {
            trimmed = trimmed.substring(5).trim();
          }
          return trimmed;
        })
        .filter((t) => t.length > 0);

      this.logger.log(`assertManagerCanEditTeam debug: parsedNames=${JSON.stringify(parsedNames)}`);

      if (parsedNames.length > 0) {
        const matchedTeams = await this.prisma.team.findMany({
          where: {
            name: {
              in: parsedNames,
              mode: 'insensitive',
            },
          },
          select: { id: true },
        });
        matchedTeams.forEach((t) => resolvedTeamIds.push(t.id));
      }
    }

    // Collect all team IDs this user is associated with
    const associatedTeamIds = new Set<string>();
    resolvedTeamIds.forEach((id) => associatedTeamIds.add(id));
    (actor.teams_leading || []).forEach((t) => associatedTeamIds.add(t.id));
    (actor.team_memberships || []).forEach((m) => associatedTeamIds.add(m.team_id));

    this.logger.log(
      `assertManagerCanEditTeam debug: resolvedTeamIds=${JSON.stringify(resolvedTeamIds)}, leadingTeamIds=${JSON.stringify(
        (actor.teams_leading || []).map((t) => t.id)
      )}, associatedTeamIds=${JSON.stringify(Array.from(associatedTeamIds))}`
    );

    const hasAccess = associatedTeamIds.has(teamId);
    const hasRequiredRole =
      actor.roles.includes(UserRole.MANAGER) || actor.roles.includes(UserRole.LEADER);

    if (!hasRequiredRole || !hasAccess) {
      throw new ForbiddenException('Bạn không có quyền quản lý session của team này');
    }
  }

  /**
   * Kiểm tra member có thuộc team của session không
   * (tránh member team này điểm danh vào session team khác).
   */
  private async assertMemberBelongsToTeam(userId: string, teamId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: true,
        team: true,
        team_memberships: { select: { team_id: true } }
      },
    });
    if (!user) throw new NotFoundException('Không tìm thấy user');

    this.logger.log(
      `assertMemberBelongsToTeam debug: userId=${userId}, teamId=${teamId}, teamName=${user.team}`
    );

    // Resolve team_ids from user.team (comma-separated list)
    const resolvedTeamIds: string[] = [];
    if (user.team) {
      const parsedNames = user.team
        .split(',')
        .map((t) => {
          let trimmed = t.trim();
          if (trimmed.toLowerCase().startsWith('team ')) {
            trimmed = trimmed.substring(5).trim();
          }
          return trimmed;
        })
        .filter((t) => t.length > 0);

      this.logger.log(`assertMemberBelongsToTeam debug: parsedNames=${JSON.stringify(parsedNames)}`);

      if (parsedNames.length > 0) {
        const matchedTeams = await this.prisma.team.findMany({
          where: {
            name: {
              in: parsedNames,
              mode: 'insensitive',
            },
          },
          select: { id: true },
        });
        matchedTeams.forEach((t) => resolvedTeamIds.push(t.id));
      }
    }

    const associatedTeamIds = new Set<string>();
    resolvedTeamIds.forEach((id) => associatedTeamIds.add(id));
    (user.team_memberships || []).forEach((m) => associatedTeamIds.add(m.team_id));

    this.logger.log(
      `assertMemberBelongsToTeam debug: resolvedTeamIds=${JSON.stringify(resolvedTeamIds)}, associatedTeamIds=${JSON.stringify(
        Array.from(associatedTeamIds)
      )}`
    );

    if (!associatedTeamIds.has(teamId)) {
      throw new ForbiddenException('Bạn chỉ có thể điểm danh trong team của mình');
    }
  }

  /**
   * Tạo hoặc cập nhật buổi họp cho 1 team + kỳ.
   * Unique key: [team_id, period_id] → upsert an toàn.
   */
  async upsertMeetingSession(dto: CreateMeetingSessionDto, actorId: string) {
    const team = await this.prisma.team.findUnique({ where: { name: dto.team } });
    if (!team) throw new NotFoundException(`Team "${dto.team}" không tồn tại`);

    const period = await this.prisma.reportPeriod.findUnique({ where: { id: dto.period_id } });
    if (!period) throw new NotFoundException('Kỳ báo cáo không tồn tại');

    // Kiểm tra quyền: Manager/Leader chỉ tạo được cho team mình
    await this.assertManagerCanEditTeam(actorId, team.id);

    return this.prisma.meetingSession.upsert({
      where: { team_id_period_id: { team_id: team.id, period_id: dto.period_id } },
      create: {
        team_id: team.id,
        period_id: dto.period_id,
        title: dto.title,
        scheduled_at: new Date(dto.scheduled_at),
        notes: dto.notes,
        created_by: actorId,
      },
      update: {
        title: dto.title,
        scheduled_at: new Date(dto.scheduled_at),
        notes: dto.notes,
      },
      include: {
        team: { select: { id: true, name: true } },
        period: { select: { id: true, label: true, start_date: true, end_date: true } },
        creator: { select: { id: true, full_name: true } },
        attendances: {
          include: {
            user: { select: { id: true, full_name: true, image_url: true } },
            marked_by: { select: { id: true, full_name: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
  }

  /**
   * Lấy session + DS điểm danh của 1 team + kỳ.
   */
  async getMeetingSession(team: string, periodId: string) {
    const teamRecord = await this.prisma.team.findUnique({ where: { name: team } });
    if (!teamRecord) throw new NotFoundException(`Team "${team}" không tồn tại`);

    const session = await this.prisma.meetingSession.findUnique({
      where: { team_id_period_id: { team_id: teamRecord.id, period_id: periodId } },
      include: {
        team: { select: { id: true, name: true } },
        period: { select: { id: true, label: true, start_date: true, end_date: true } },
        creator: { select: { id: true, full_name: true } },
        finalized_by: { select: { id: true, full_name: true } },
        attendances: {
          include: {
            user: { select: { id: true, full_name: true, image_url: true } },
            marked_by: { select: { id: true, full_name: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    // Query all active users that belong to this team by parsing their user.team field
    const allUsers = await this.prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, full_name: true, team: true, image_url: true },
      orderBy: { full_name: 'asc' }
    });

    const teamMembers = allUsers
      .filter((user) => {
        if (!user.team) return false;
        const parsedNames = user.team
          .split(',')
          .map((t) => {
            let trimmed = t.trim();
            if (trimmed.toLowerCase().startsWith('team ')) {
              trimmed = trimmed.substring(5).trim();
            }
            return trimmed;
          })
          .filter((t) => t.length > 0);
        return parsedNames.some((name) => name.toLowerCase() === team.toLowerCase());
      })
      .map((user) => ({
        id: user.id,
        full_name: user.full_name,
        image_url: user.image_url,
      }));

    return {
      session,
      teamMembers,
    };
  }

  /**
   * Tự điểm danh (self check-in).
   * userId BUỘC lấy từ JWT (req.user.id), không nhận từ body.
   * Kiểm tra user phải thuộc team của session.
   */
  async selfCheckIn(sessionId: string, userId: string, dto: UpsertAttendanceDto) {
    const session = await this.prisma.meetingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, team_id: true, is_finalized: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi họp');

    if (session.is_finalized) {
      throw new ForbiddenException('Buổi họp đã chốt, không thể chỉnh sửa điểm danh');
    }

    // Member chỉ được điểm danh trong team của mình
    await this.assertMemberBelongsToTeam(userId, session.team_id);

    return this.prisma.attendanceRecord.upsert({
      where: { session_id_user_id: { session_id: sessionId, user_id: userId } },
      create: {
        session_id: sessionId,
        user_id: userId,
        status: dto.status,
        note: dto.note,
        marked_by_id: userId,
      },
      update: {
        status: dto.status,
        note: dto.note,
        marked_by_id: userId,
      },
      include: {
        user: { select: { id: true, full_name: true } },
        marked_by: { select: { id: true, full_name: true } },
      },
    });
  }

  /**
   * Manager/Admin sửa điểm danh từng người.
   * Kiểm tra session.team_id khớp với team mà actor đang quản lý.
   */
  async managerUpsertAttendance(
    sessionId: string,
    targetUserId: string,
    dto: UpsertAttendanceDto,
    actorId: string,
  ) {
    const session = await this.prisma.meetingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, team_id: true, is_finalized: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi họp');

    if (session.is_finalized) {
      throw new ForbiddenException('Buổi họp đã chốt, không thể chỉnh sửa điểm danh');
    }

    // Kiểm tra actor có quyền quản lý team này
    await this.assertManagerCanEditTeam(actorId, session.team_id);

    // Kiểm tra targetUser tồn tại
    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw new NotFoundException('Không tìm thấy user cần điểm danh');

    return this.prisma.attendanceRecord.upsert({
      where: { session_id_user_id: { session_id: sessionId, user_id: targetUserId } },
      create: {
        session_id: sessionId,
        user_id: targetUserId,
        status: dto.status,
        note: dto.note,
        marked_by_id: actorId,
      },
      update: {
        status: dto.status,
        note: dto.note,
        marked_by_id: actorId,
      },
      include: {
        user: { select: { id: true, full_name: true } },
        marked_by: { select: { id: true, full_name: true } },
      },
    });
  }

  /**
   * Manager/Admin bulk upsert điểm danh nhiều người trong 1 transaction.
   * Nếu bất kỳ item nào lỗi → toàn bộ rollback.
   */
  async bulkUpsertAttendance(sessionId: string, dto: BulkAttendanceDto, actorId: string) {
    const session = await this.prisma.meetingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, team_id: true, is_finalized: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi họp');

    if (session.is_finalized) {
      throw new ForbiddenException('Buổi họp đã chốt, không thể chỉnh sửa điểm danh');
    }

    // Kiểm tra actor có quyền quản lý team này
    await this.assertManagerCanEditTeam(actorId, session.team_id);

    // Chạy toàn bộ trong 1 transaction — nếu 1 item fail → rollback hết
    const results = await this.prisma.$transaction(
      dto.records.map((r) =>
        this.prisma.attendanceRecord.upsert({
          where: { session_id_user_id: { session_id: sessionId, user_id: r.user_id } },
          create: {
            session_id: sessionId,
            user_id: r.user_id,
            status: r.status,
            note: r.note,
            marked_by_id: actorId,
          },
          update: {
            status: r.status,
            note: r.note,
            marked_by_id: actorId,
          },
          include: {
            user: { select: { id: true, full_name: true } },
            marked_by: { select: { id: true, full_name: true } },
          },
        }),
      ),
    );

    return { updated: results.length, records: results };
  }

  /**
   * Chốt buổi họp.
   */
  async finalizeMeetingSession(sessionId: string, actorId: string) {
    const session = await this.prisma.meetingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, team_id: true, is_finalized: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi họp');

    // Ném lỗi rõ ràng nếu đã chốt rồi
    if (session.is_finalized) {
      throw new BadRequestException('Buổi họp đã được chốt trước đó, không cần chốt lại');
    }

    // Kiểm tra actor có quyền quản lý team của session không
    await this.assertManagerCanEditTeam(actorId, session.team_id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meetingSession.update({
        where: { id: sessionId },
        data: {
          is_finalized: true,
          finalized_at: new Date(),
          finalized_by_id: actorId,
        },
        include: {
          team: { select: { id: true, name: true } },
          period: { select: { id: true, label: true } },
          creator: { select: { id: true, full_name: true } },
          finalized_by: { select: { id: true, full_name: true } },
        },
      });

      // Tạo nhật ký log chốt session
      await tx.meetingSessionLog.create({
        data: {
          session_id: sessionId,
          actor_id: actorId,
          action: 'FINALIZE',
        },
      });

      return updated;
    });
  }

  /**
   * Mở lại buổi họp.
   */
  async reopenMeetingSession(sessionId: string, actorId: string) {
    const session = await this.prisma.meetingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, team_id: true, is_finalized: true, finalized_at: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi họp');

    if (!session.is_finalized) {
      throw new BadRequestException('Buổi họp chưa được chốt, không cần mở lại');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { roles: true },
    });
    if (!actor) throw new NotFoundException('Không tìm thấy user');

    const isAdmin = actor.roles.includes(UserRole.ADMIN);

    if (!isAdmin) {
      // Leader/Manager chỉ được phép mở lại nếu là người quản lý team và trong cùng ngày chốt
      await this.assertManagerCanEditTeam(actorId, session.team_id);

      if (!session.finalized_at) {
        throw new ForbiddenException('Thời điểm chốt buổi họp không hợp lệ');
      }

      const nowVn = DateTime.now().setZone('Asia/Ho_Chi_Minh');
      const finalizedVn = DateTime.fromJSDate(session.finalized_at).setZone('Asia/Ho_Chi_Minh');

      if (!nowVn.hasSame(finalizedVn, 'day')) {
        throw new ForbiddenException('Đã quá thời hạn cho phép mở lại buổi họp (chỉ được phép trong ngày chốt)');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meetingSession.update({
        where: { id: sessionId },
        data: {
          is_finalized: false,
          finalized_at: null,
          finalized_by_id: null,
        },
        include: {
          team: { select: { id: true, name: true } },
          period: { select: { id: true, label: true } },
          creator: { select: { id: true, full_name: true } },
          finalized_by: { select: { id: true, full_name: true } },
        },
      });

      // Tạo nhật ký log mở lại session
      await tx.meetingSessionLog.create({
        data: {
          session_id: sessionId,
          actor_id: actorId,
          action: 'REOPEN',
        },
      });

      return updated;
    });
  }

  // ─────────────────────────────────────────────
  // ATTENDANCE HISTORY (read-only, lịch sử điểm danh)
  // ─────────────────────────────────────────────

  /**
   * Bảng ma trận chuyên cần cả team trong 1 tháng.
   * Chỉ Manager/Leader của team đó hoặc Admin mới xem được.
   */
  async getAttendanceHistory(dto: AttendanceHistoryQueryDto, actorId: string) {
    const { team: teamName, month, year } = dto;

    // Tìm team theo tên
    const team = await this.prisma.team.findUnique({ where: { name: teamName } });
    if (!team) throw new NotFoundException(`Team "${teamName}" không tồn tại`);

    // Kiểm tra quyền: Admin bypass, Manager/Leader phải thuộc team
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { roles: true },
    });
    if (!actor) throw new NotFoundException('Không tìm thấy user');

    const isAdmin = actor.roles.includes(UserRole.ADMIN);
    if (!isAdmin) {
      await this.assertManagerCanEditTeam(actorId, team.id);
    }

    // Tính range tháng/năm theo UTC
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Lấy tất cả sessions của team trong tháng
    const sessions = await this.prisma.meetingSession.findMany({
      where: {
        team_id: team.id,
        scheduled_at: { gte: startOfMonth, lte: endOfMonth },
      },
      include: {
        period: { select: { id: true, label: true, type: true } },
        attendances: {
          include: {
            user: { select: { id: true, full_name: true } },
            marked_by: { select: { id: true, full_name: true } },
          },
        },
      },
      orderBy: { scheduled_at: 'asc' },
    });

    // Lấy toàn bộ member thuộc team (dùng lại helper parse)
    const allUsers = await this.prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, full_name: true, team: true, image_url: true },
      orderBy: { full_name: 'asc' },
    });

    const teamMembers = allUsers.filter((user) => {
      if (!user.team) return false;
      const parsedNames = user.team
        .split(',')
        .map((t) => {
          let trimmed = t.trim();
          if (trimmed.toLowerCase().startsWith('team ')) {
            trimmed = trimmed.substring(5).trim();
          }
          return trimmed;
        })
        .filter((t) => t.length > 0);
      return parsedNames.some((n) => n.toLowerCase() === teamName.toLowerCase());
    });

    const totalMembers = teamMembers.length;

    // Build session_summaries: tỉ lệ team có mặt mỗi buổi
    const sessionSummaries: Record<string, { present_count: number; total_members: number; rate: number }> = {};
    for (const session of sessions) {
      const presentCount = session.attendances.filter(
        (a) => a.status === 'PRESENT' || a.status === 'LATE',
      ).length;
      sessionSummaries[session.id] = {
        present_count: presentCount,
        total_members: totalMembers,
        rate: totalMembers > 0 ? Math.round((presentCount / totalMembers) * 100) : 0,
      };
    }

    // Build per-member attendance_map và summary
    const membersWithHistory = teamMembers.map((member) => {
      const attendanceMap: Record<string, {
        status: string;
        note: string | null;
        marked_by: { id: string; full_name: string };
        created_at: Date;
      } | null> = {};

      let present = 0, late = 0, absent = 0, on_leave = 0, no_record = 0;

      for (const session of sessions) {
        const record = session.attendances.find((a) => a.user_id === member.id);
        if (!record) {
          attendanceMap[session.id] = null;
          no_record++;
        } else {
          attendanceMap[session.id] = {
            status: record.status,
            note: record.note,
            marked_by: record.marked_by,
            created_at: record.created_at,
          };
          if (record.status === 'PRESENT') present++;
          else if (record.status === 'LATE') late++;
          else if (record.status === 'ABSENT') absent++;
          else if (record.status === 'ON_LEAVE') on_leave++;
        }
      }

      const total_sessions = sessions.length;
      const attendance_rate =
        total_sessions > 0 ? Math.round(((present + late) / total_sessions) * 100) : 0;

      return {
        id: member.id,
        full_name: member.full_name,
        image_url: member.image_url,
        attendance_map: attendanceMap,
        summary: { present, late, absent, on_leave, no_record, total_sessions, attendance_rate },
      };
    });

    return {
      team: { id: team.id, name: team.name },
      period: { month, year, label: `Tháng ${month}/${year}` },
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduled_at: s.scheduled_at,
        week_label: s.period?.label ?? '',
        is_finalized: s.is_finalized,
      })),
      members: membersWithHistory,
      session_summaries: sessionSummaries,
    };
  }

  /**
   * Lịch sử điểm danh chi tiết của 1 người trong 1 tháng.
   * - actorId === targetUserId → xem chính mình
   * - Admin → bypass mọi kiểm tra
   * - Manager/Leader → phải chung team với targetUser
   * - Còn lại → 403
   */
  async getUserAttendanceHistory(targetUserId: string, dto: UserHistoryQueryDto, actorId: string) {
    const { month, year } = dto;

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, full_name: true, image_url: true, team: true },
    });
    if (!targetUser) throw new NotFoundException('Không tìm thấy user');

    // Phân quyền
    if (actorId !== targetUserId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { roles: true },
      });
      if (!actor) throw new NotFoundException('Không tìm thấy actor');

      const isAdmin = actor.roles.includes(UserRole.ADMIN);
      const isManagerOrLeader =
        actor.roles.includes(UserRole.MANAGER) || actor.roles.includes(UserRole.LEADER);

      if (!isAdmin && !isManagerOrLeader) {
        throw new ForbiddenException('Bạn không có quyền xem lịch sử điểm danh của người khác');
      }

      if (!isAdmin) {
        // Manager/Leader: kiểm tra targetUser phải ở trong team họ quản lý
        const actorFull = await this.prisma.user.findUnique({
          where: { id: actorId },
          select: {
            team: true,
            teams_leading: { select: { id: true } },
          },
        });
        if (!actorFull) throw new NotFoundException('Không tìm thấy actor');

        const managedTeamIds = new Set<string>();
        (actorFull.teams_leading || []).forEach((t) => managedTeamIds.add(t.id));

        if (actorFull.team) {
          const parsedNames = actorFull.team
            .split(',')
            .map((t) => {
              let trimmed = t.trim();
              if (trimmed.toLowerCase().startsWith('team ')) trimmed = trimmed.substring(5).trim();
              return trimmed;
            })
            .filter((t) => t.length > 0);
          if (parsedNames.length > 0) {
            const matchedTeams = await this.prisma.team.findMany({
              where: { name: { in: parsedNames, mode: 'insensitive' } },
              select: { id: true },
            });
            matchedTeams.forEach((t) => managedTeamIds.add(t.id));
          }
        }

        if (managedTeamIds.size === 0) {
          throw new ForbiddenException('Bạn không quản lý team nào');
        }

        let hasAccess = false;
        if (targetUser.team) {
          const targetTeamNames = targetUser.team
            .split(',')
            .map((t) => {
              let trimmed = t.trim();
              if (trimmed.toLowerCase().startsWith('team ')) trimmed = trimmed.substring(5).trim();
              return trimmed;
            })
            .filter((t) => t.length > 0);

          if (targetTeamNames.length > 0) {
            const targetTeams = await this.prisma.team.findMany({
              where: { name: { in: targetTeamNames, mode: 'insensitive' } },
              select: { id: true },
            });
            hasAccess = targetTeams.some((t) => managedTeamIds.has(t.id));
          }
        }

        if (!hasAccess) {
          throw new ForbiddenException('Bạn không có quyền xem lịch sử điểm danh của người này');
        }
      }
    }

    // Tính range tháng/năm
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Tìm team IDs của targetUser
    const userTeamIds: string[] = [];
    if (targetUser.team) {
      const parsedNames = targetUser.team
        .split(',')
        .map((t) => {
          let trimmed = t.trim();
          if (trimmed.toLowerCase().startsWith('team ')) trimmed = trimmed.substring(5).trim();
          return trimmed;
        })
        .filter((t) => t.length > 0);
      if (parsedNames.length > 0) {
        const matchedTeams = await this.prisma.team.findMany({
          where: { name: { in: parsedNames, mode: 'insensitive' } },
          select: { id: true },
        });
        matchedTeams.forEach((t) => userTeamIds.push(t.id));
      }
    }

    // Lấy tất cả sessions trong tháng thuộc team của user
    const allSessions = userTeamIds.length > 0
      ? await this.prisma.meetingSession.findMany({
          where: {
            team_id: { in: userTeamIds },
            scheduled_at: { gte: startOfMonth, lte: endOfMonth },
          },
          include: {
            team: { select: { id: true, name: true } },
            period: { select: { id: true, label: true } },
          },
          orderBy: { scheduled_at: 'asc' },
        })
      : [];

    // Lấy attendance records của user trong tháng
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        user_id: targetUserId,
        session: { scheduled_at: { gte: startOfMonth, lte: endOfMonth } },
      },
      include: {
        marked_by: { select: { id: true, full_name: true } },
      },
    });

    // Build timeline: merge session + attendance record (null = Chưa điểm danh)
    const recordMap = new Map(records.map((r) => [r.session_id, r]));
    const sessionTimeline = allSessions.map((session) => {
      const rec = recordMap.get(session.id);
      return {
        session_id: session.id,
        title: session.title,
        week_label: session.period?.label ?? '',
        scheduled_at: session.scheduled_at,
        team: session.team,
        attendance: rec
          ? {
              status: rec.status,
              note: rec.note,
              marked_by: rec.marked_by,
              created_at: rec.created_at,
            }
          : null,
      };
    });

    // Tính summary
    let present = 0, late = 0, absent = 0, on_leave = 0, no_record = 0;
    for (const item of sessionTimeline) {
      if (!item.attendance) no_record++;
      else if (item.attendance.status === 'PRESENT') present++;
      else if (item.attendance.status === 'LATE') late++;
      else if (item.attendance.status === 'ABSENT') absent++;
      else if (item.attendance.status === 'ON_LEAVE') on_leave++;
    }
    const total_sessions = sessionTimeline.length;
    const attendance_rate =
      total_sessions > 0 ? Math.round(((present + late) / total_sessions) * 100) : 0;

    return {
      user: {
        id: targetUser.id,
        full_name: targetUser.full_name,
        image_url: targetUser.image_url,
      },
      period: { month, year },
      sessions: sessionTimeline,
      summary: { present, late, absent, on_leave, no_record, total_sessions, attendance_rate },
    };
  }
}

import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PeriodType, VideoStatus } from '@prisma/client';
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

@Injectable()
export class ContentReportService {
  private readonly logger = new Logger(ContentReportService.name);

  constructor(private readonly prisma: PrismaService) { }

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
    return this.prisma.team.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createTeam(dto: CreateTeamDto) {
    try {
      return await this.prisma.team.create({
        data: { name: dto.name },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Team "${dto.name}" đã tồn tại`);
      }
      throw e;
    }
  }

  // ───────────────────── PERIODS ─────────────────────

  async getPeriods(type?: PeriodType) {
    return this.prisma.reportPeriod.findMany({
      where: type ? { type } : undefined,
      orderBy: { start_date: 'desc' },
    });
  }

  async createPeriod(dto: CreatePeriodDto) {
    try {
      return await this.prisma.reportPeriod.create({
        data: {
          type: dto.type,
          label: dto.label,
          start_date: new Date(dto.start_date),
          end_date: new Date(dto.end_date),
        },
      });
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
    const team = await this.prisma.team.findUnique({ where: { name: teamName } });
    if (!team) throw new NotFoundException(`Team "${teamName}" không tồn tại`);

    const period = await this.prisma.reportPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`Kỳ báo cáo không tồn tại`);

    const whereTeamPeriod = { team_id: team.id, period_id: periodId };

    const [winVideos, failVideos, caseStudies, editorPerformance, cloneVideos, actionItems, kpiSnapshot, teamMembers] =
      await Promise.all([
        this.prisma.contentVideo.findMany({
          where: { ...whereTeamPeriod, status: VideoStatus.WIN },
          include: { editor: { select: { id: true, full_name: true, image_url: true } } },
          orderBy: [
            { order_index: 'asc' },
            { post_date: 'asc' },
            { created_at: 'asc' },
          ],
        }),
        this.prisma.contentVideo.findMany({
          where: { ...whereTeamPeriod, status: VideoStatus.FAIL },
          include: { editor: { select: { id: true, full_name: true, image_url: true } } },
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
    const teams = await this.prisma.team.findMany({ orderBy: { name: 'asc' } });
    const result: Record<string, any> = {};

    for (const team of teams) {
      result[team.name] = await this.getReportData(team.name, periodId);
    }

    return result;
  }

  // ───────────────────── CONTENT VIDEOS CRUD ─────────────────────

  async createContentVideo(dto: CreateContentVideoDto) {
    const editor_id = await this.resolveUser(dto.editor_id, dto.editor);
    return this.prisma.contentVideo.create({
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
    });
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

    return this.prisma.contentVideo.update({
      where: { id },
      data,
      include: { editor: { select: { id: true, full_name: true } } },
    });
  }

  async deleteContentVideo(id: string) {
    return this.prisma.contentVideo.delete({ where: { id } });
  }

  // ───────────────────── CASE STUDIES CRUD ─────────────────────

  async createCaseStudy(dto: CreateCaseStudyDto) {
    const created_by = await this.resolveUser(dto.created_by, dto.creator_name);
    return this.prisma.caseStudy.create({
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
    });
  }

  async updateCaseStudy(id: string, dto: UpdateCaseStudyDto) {
    const data: any = { ...dto };
    if (dto.post_date) data.post_date = new Date(dto.post_date);
    return this.prisma.caseStudy.update({
      where: { id },
      data,
      include: { creator: { select: { id: true, full_name: true } } },
    });
  }

  async deleteCaseStudy(id: string) {
    return this.prisma.caseStudy.delete({ where: { id } });
  }

  // ───────────────────── EDITOR PERFORMANCE CRUD ─────────────────────

  async createEditorPerformance(dto: CreateEditorPerformanceDto) {
    try {
      const user_id = await this.resolveUser(dto.user_id, dto.editor);
      return await this.prisma.editorPerformance.create({
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
      });
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
    return this.prisma.editorPerformance.update({
      where: { id },
      data,
      include: { user: { select: { id: true, full_name: true } } },
    });
  }

  async deleteEditorPerformance(id: string) {
    return this.prisma.editorPerformance.delete({ where: { id } });
  }

  // ───────────────────── CLONE VIDEOS CRUD ─────────────────────

  async createCloneVideo(dto: CreateCloneVideoDto) {
    const editor_id = await this.resolveUser(dto.editor_id, dto.editor);
    return this.prisma.cloneVideo.create({
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
    });
  }

  async updateCloneVideo(id: string, dto: UpdateCloneVideoDto) {
    const data: any = { ...dto };
    if (dto.post_date) data.post_date = new Date(dto.post_date);
    if (dto.editor || dto.editor_id) {
      data.editor_id = await this.resolveUser(dto.editor_id, dto.editor);
      delete data.editor;
    }
    return this.prisma.cloneVideo.update({
      where: { id },
      data,
      include: { editor: { select: { id: true, full_name: true } } },
    });
  }

  async deleteCloneVideo(id: string) {
    return this.prisma.cloneVideo.delete({ where: { id } });
  }

  // ───────────────────── ACTION ITEMS CRUD ─────────────────────

  async createActionItem(dto: CreateActionItemDto) {
    const assignee_id = await this.resolveUser(dto.assignee_id, dto.assignee);
    return this.prisma.actionItem.create({
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
    });
  }

  async updateActionItem(id: string, dto: UpdateActionItemDto) {
    const data: any = { ...dto };
    if (dto.deadline) data.deadline = new Date(dto.deadline);
    if (dto.assignee || dto.assignee_id) {
      data.assignee_id = await this.resolveUser(dto.assignee_id, dto.assignee);
      delete data.assignee;
    }
    return this.prisma.actionItem.update({
      where: { id },
      data,
      include: { assignee: { select: { id: true, full_name: true } } },
    });
  }

  async deleteActionItem(id: string) {
    return this.prisma.actionItem.delete({ where: { id } });
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

    return this.prisma.teamKpiSnapshot.upsert({
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
    });
  }

  // ───────────────────── SEED ─────────────────────

  /**
   * Seed dữ liệu ban đầu: 5 teams + kỳ báo cáo tháng 6/2026
   */
  async seedInitialData() {
    const teamNames = ['K1', 'K2', 'K3', 'K4', 'K5'];

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

    return { teams, periods };
  }

  // ───────────────────── HELPERS ─────────────────────

  private formatViews(views: number): string {
    return views.toString();
  }
}

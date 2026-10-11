import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import { TaskVideoMatchService } from './task-video-match.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto/tasks')
export class VideoMatchingController {
  constructor(private readonly videoMatch: TaskVideoMatchService) {}

  @Post('match-videos')
  @ApiOperation({ summary: 'Chạy tay job khớp video kênh nội bộ với task trong phạm vi được phép.' })
  matchVideos(@Req() req: any, @Body() body: {
    since_days?: number
    max_videos?: number
    date_from?: string
    date_to?: string
    team_id?: string
    assignee_id?: string
    content_line_id?: string
    product_line_id?: string
    task_type?: 'auto' | 'extra' | 'manual'
    status?: string
    search?: string
    search_target?: 'task' | 'video'
  }) {
    const sinceDays = Number(body?.since_days)
    const maxVideos = Number(body?.max_videos)
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    const teamIds = String(body?.team_id || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
    return this.videoMatch.runManualMatch({
      // Chặn request tay quét vô hạn làm nghẽn DB; giá trị không hợp lệ dùng mặc định service.
      sinceDays: Number.isFinite(sinceDays) ? Math.min(60, Math.max(1, Math.trunc(sinceDays))) : undefined,
      maxVideos: Number.isFinite(maxVideos) ? Math.min(3_000, Math.max(1, Math.trunc(maxVideos))) : undefined,
      dateFrom: datePattern.test(body?.date_from || '') ? body.date_from : undefined,
      dateTo: datePattern.test(body?.date_to || '') ? body.date_to : undefined,
      teamIds: teamIds.length ? teamIds : undefined,
      assigneeId: body?.assignee_id?.trim() || undefined,
      contentLineId: body?.content_line_id?.trim() || undefined,
      productLineId: body?.product_line_id?.trim() || undefined,
      taskType: body?.task_type,
      status: body?.status?.trim() || undefined,
      search: body?.search?.trim() || undefined,
      searchTarget: body?.search_target === 'video' ? 'video' : 'task',
    }, req.user)
  }

  @Get(':id/video-matches')
  @ApiOperation({ summary: 'Lịch sử job tự động khớp video với task.' })
  getVideoMatches(@Param('id') id: string) {
    return this.videoMatch.listMatchesForTask(id)
  }
}

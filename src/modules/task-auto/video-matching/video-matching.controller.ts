import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { TaskVideoMatchService } from './task-video-match.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto/tasks')
export class VideoMatchingController {
  constructor(private readonly videoMatch: TaskVideoMatchService) {}

  @Post('match-videos')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({
    summary:
      'Chạy tay job khớp video kênh nội bộ (FB/IG) với task + gắn link bài đăng (thường chạy cron 07:45). Dùng để test/backfill.',
  })
  matchVideos(@Body() body: { since_days?: number; max_videos?: number }) {
    return this.videoMatch.runDailyMatch({
      sinceDays: body?.since_days,
      maxVideos: body?.max_videos,
    })
  }

  @Get(':id/video-matches')
  @ApiOperation({ summary: 'Lịch sử job tự động khớp video với task.' })
  getVideoMatches(@Param('id') id: string) {
    return this.videoMatch.listMatchesForTask(id)
  }
}

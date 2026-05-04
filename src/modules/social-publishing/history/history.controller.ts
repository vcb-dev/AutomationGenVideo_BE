import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { HistoryService } from './history.service';

@ApiTags('Social History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Lịch sử đăng bài (tất cả platforms)' })
  findAll(@Request() req, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 50;
    const safeLimit = isNaN(parsed) || parsed <= 0 ? 50 : Math.min(parsed, 200);
    return this.historyService.findAll(req.user.id, safeLimit);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê: total, success, failed, byPlatform' })
  getStats(@Request() req) {
    return this.historyService.getStats(req.user.id);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Bài failed trong 24h gần nhất' })
  getNotifications(@Request() req) {
    return this.historyService.getNotifications(req.user.id);
  }
}

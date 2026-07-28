import { Controller, Get, Query, Sse, MessageEvent, UseGuards, Request } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { NotificationStreamService } from '../../../common/push/notification-stream.service';
import { HistoryService } from './history.service';

@ApiTags('Social History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/history')
export class HistoryController {
  constructor(
    private readonly historyService: HistoryService,
    private readonly notifyStream: NotificationStreamService,
  ) {}

  // EventSource không set được header Authorization — token truyền qua `?access_token=`
  // (JwtStrategy đã hỗ trợ sẵn, dùng chung cơ chế với task-auto/notifications/stream).
  @Sse('notifications/stream')
  @ApiOperation({ summary: 'Real-time (SSE) stream báo có post FAILED mới của user hiện tại' })
  notificationsStream(@Request() req: any): Observable<MessageEvent> {
    return this.notifyStream.stream(req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Lịch sử đăng bài. Admin/Manager/Leader có thể filter theo team hoặc nhân viên' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'team', required: false, description: 'Lọc theo team (vd: Vietnam, Global) — chỉ admin/manager/leader' })
  @ApiQuery({ name: 'employeeId', required: false, description: 'Lọc theo ID nhân viên — chỉ admin/manager/leader' })
  findAll(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('team') team?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : 50;
    const safeLimit = isNaN(parsed) || parsed <= 0 ? 50 : Math.min(parsed, 200);
    return this.historyService.findAll(req.user.id, req.user.roles || [], { team, employeeId }, safeLimit);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Thống kê: total, success, failed, byPlatform. Admin/Manager/Leader có thể filter theo team hoặc nhân viên' })
  @ApiQuery({ name: 'team', required: false, description: 'Lọc theo team (vd: Vietnam, Global)' })
  @ApiQuery({ name: 'employeeId', required: false, description: 'Lọc theo ID nhân viên' })
  getStats(
    @Request() req,
    @Query('team') team?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.historyService.getStats(req.user.id, req.user.roles || [], { team, employeeId });
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Bài failed trong 24h gần nhất. Admin/Manager/Leader có thể filter theo team hoặc nhân viên' })
  @ApiQuery({ name: 'team', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  getNotifications(
    @Request() req,
    @Query('team') team?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.historyService.getNotifications(req.user.id, req.user.roles || [], { team, employeeId });
  }

  @Get('members')
  @ApiOperation({ summary: 'Danh sách nhân viên để filter thống kê — chỉ admin/manager/leader' })
  @ApiQuery({ name: 'team', required: false, description: 'Lọc theo team' })
  getMembers(@Request() req, @Query('team') team?: string) {
    return this.historyService.getMembers(req.user.id, req.user.roles || [], team);
  }

  @Get('teams')
  @ApiOperation({ summary: 'Danh sách team hiện có — chỉ admin/manager/leader (member trả [])' })
  getTeams(@Request() req) {
    return this.historyService.getTeams(req.user.id, req.user.roles || []);
  }
}

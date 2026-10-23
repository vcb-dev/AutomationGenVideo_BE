import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ReturnAlertsService } from './return-alerts.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsReturnAlertsController {
  constructor(private readonly alerts: ReturnAlertsService) {}

  @Get('return-alerts')
  @ApiOperation({ summary: 'Phiếu quá hạn hoặc sắp tới hạn trả — thành viên chỉ thấy phiếu của mình' })
  returnAlerts(@Request() req: any) {
    return this.alerts.list({ id: req.user.id, roles: req.user.roles ?? [], team: req.user.team });
  }
}

import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ReportIncidentDto } from './dto/incident.dto';
import { MemsIncidentsService } from './incidents.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsIncidentsController {
  constructor(private readonly incidents: MemsIncidentsService) {}

  /** Cố ý không có @Roles: người mượn tự báo sự cố cho phiếu của mình, quyền chốt trong service. */
  @Post('requests/:id/incidents')
  @ApiOperation({ summary: 'Báo sự cố cho một máy đang mượn' })
  reportIncident(@Request() req: any, @Param('id') id: string, @Body() dto: ReportIncidentDto) {
    return this.incidents.report(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team }, dto);
  }
}

import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ApprovalService } from './approvals.service';
import { ApproveRequestDto, RejectRequestDto } from './dto/approval.dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsApprovalsController {
  constructor(private readonly approvals: ApprovalService) {}

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/approve')
  @ApiOperation({ summary: 'Duyệt một cấp (NV-09)' })
  approve(@Request() req: any, @Param('id') id: string, @Body() dto: ApproveRequestDto) {
    return this.approvals.approve(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team }, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối phiếu, nhả giữ chỗ ngay (BR-32)' })
  reject(@Request() req: any, @Param('id') id: string, @Body() dto: RejectRequestDto) {
    return this.approvals.reject(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team }, dto);
  }
}

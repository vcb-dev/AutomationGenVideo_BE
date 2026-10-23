import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { DecideExtensionDto, RequestExtensionDto } from './dto/loan-extension.dto';
import { LoanExtensionsService } from './loan-extensions.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsLoanExtensionsController {
  constructor(private readonly extensions: LoanExtensionsService) {}

  /** Cố ý không có @Roles: chủ phiếu tự xin gia hạn, quyền chốt trong service. */
  @Post('requests/:id/extensions')
  @ApiOperation({ summary: 'Xin gia hạn hạn trả của phiếu đang mượn' })
  requestExtension(@Request() req: any, @Param('id') id: string, @Body() dto: RequestExtensionDto) {
    return this.extensions.request(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team }, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/extensions/decision')
  @ApiOperation({ summary: 'Duyệt hoặc từ chối yêu cầu gia hạn đang chờ' })
  decideExtension(@Request() req: any, @Param('id') id: string, @Body() dto: DecideExtensionDto) {
    return this.extensions.decide(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team }, dto);
  }
}

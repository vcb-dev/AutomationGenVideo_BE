import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CreateHandoverDto } from './dto/handover.dto';
import { HandoverService } from './handover.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsHandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Get('requests/:id/handover-sheet')
  @ApiOperation({ summary: 'Dữ liệu dựng biên bản bàn giao (MH-11)' })
  handoverSheet(@Param('id') id: string) {
    return this.handovers.prepareSheet(id);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/handover')
  @ApiOperation({ summary: 'Lập biên bản bàn giao (NV-11)' })
  handover(@Request() req: any, @Param('id') id: string, @Body() dto: CreateHandoverDto) {
    return this.handovers.create(id, req.user.id, dto);
  }
}

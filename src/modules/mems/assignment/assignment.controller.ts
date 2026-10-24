import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AssignmentService } from './assignment.service';
import { AssignSerialsDto } from './dto/assignment.dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsAssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Get('request-lines/:lineId/assignable-assets')
  @ApiOperation({ summary: 'Máy hợp lệ để gán cho một dòng phiếu (BR-25)' })
  assignable(@Param('lineId') lineId: string) {
    return this.assignment.assignableUnits(lineId);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/assign')
  @ApiOperation({ summary: 'Gán máy cụ thể cho phiếu đã duyệt (NV-10)' })
  assign(@Param('id') id: string, @Body() dto: AssignSerialsDto) {
    return this.assignment.assign(id, dto);
  }
}

import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { InspectAssetDto } from './dto/inspection.dto';
import { InspectionService } from './inspection.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsInspectionController {
  constructor(private readonly inspection: InspectionService) {}

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Get('pending-inspection')
  @ApiOperation({ summary: 'Máy đang chờ kết luận kiểm tra (NV-14)' })
  pendingInspection() {
    return this.inspection.listPending();
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('assets/:assetCode/inspect')
  @ApiOperation({ summary: 'Kết luận kiểm tra, đưa máy ra khỏi bàn nhận (NV-14)' })
  inspect(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @Body() dto: InspectAssetDto,
  ) {
    return this.inspection.inspect(assetCode, req.user.id, dto);
  }
}

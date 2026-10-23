import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CreateReturnDto } from './dto/return.dto';
import { ReturnService } from './return.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsReturnsController {
  constructor(private readonly returns: ReturnService) {}

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Get('requests/:id/pending-returns')
  @ApiOperation({ summary: 'Những máy của phiếu còn đang ở ngoài (MH-13)' })
  pendingReturns(@Param('id') id: string) {
    return this.returns.pendingUnits(id);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/return')
  @ApiOperation({ summary: 'Tiếp nhận máy trả về, kết luận theo BR-42 (NV-13)' })
  receiveReturn(@Request() req: any, @Param('id') id: string, @Body() dto: CreateReturnDto) {
    return this.returns.create(id, req.user.id, dto);
  }
}

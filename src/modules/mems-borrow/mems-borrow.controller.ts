import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../common/guards/mems-media-leader.guard';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { BorrowHistoryLogService } from './borrow-history-log.service';
import { HandoverService } from './handover.service';
import { ReturnService } from './return.service';
import {
  CreateHandoverDto,
  CreateReturnDto,
  BorrowHistoryQueryDto,
} from './dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsBorrowController {
  constructor(
    private readonly borrowHistory: AssetBorrowHistoryService,
    private readonly historyLog: BorrowHistoryLogService,
    private readonly handovers: HandoverService,
    private readonly returns: ReturnService,
  ) {}

  @Get('borrow-history')
  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @ApiOperation({
    summary:
      'Nhật ký toàn bộ lượt mượn của cả kho, lọc theo trạng thái và khoảng ngày (chỉ quản lý kho)',
  })
  borrowHistoryLog(@Query() query: BorrowHistoryQueryDto) {
    return this.historyLog.list(query);
  }

  @Get('assets/:id/borrow-history')
  @ApiOperation({
    summary:
      'Lịch sử máy này từng ai mượn — thành viên chỉ thấy lượt của mình, ADMIN/quản lý thấy tất',
  })
  assetBorrowHistory(@Param('id') id: string, @Request() req: any) {
    return this.borrowHistory.forAsset(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team });
  }

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

import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../common/guards/mems-media-leader.guard';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { BorrowHistoryLogService } from './borrow-history-log.service';
import { BorrowHistoryQueryDto } from './dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsBorrowController {
  constructor(
    private readonly borrowHistory: AssetBorrowHistoryService,
    private readonly historyLog: BorrowHistoryLogService,
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
}

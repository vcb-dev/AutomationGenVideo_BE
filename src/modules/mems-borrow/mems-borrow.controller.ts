import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../common/guards/mems-media-leader.guard';
import { ApprovalService } from './approval.service';
import { AssignmentService } from './assignment.service';
import { AvailabilityService } from './availability.service';
import { AssetBorrowHistoryService } from './asset-borrow-history.service';
import { BorrowHistoryLogService } from './borrow-history-log.service';
import { BorrowRequestService } from './borrow-request.service';
import { HandoverService } from './handover.service';
import { ReturnService } from './return.service';
import {
  ApproveRequestDto,
  AssignSerialsDto,
  CheckAvailabilityQueryDto,
  CreateBorrowRequestDto,
  CreateHandoverDto,
  CreateReturnDto,
  RejectRequestDto,
} from './dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsBorrowController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly requests: BorrowRequestService,
    private readonly borrowHistory: AssetBorrowHistoryService,
    private readonly historyLog: BorrowHistoryLogService,
    private readonly approvals: ApprovalService,
    private readonly assignment: AssignmentService,
    private readonly handovers: HandoverService,
    private readonly returns: ReturnService,
  ) {}

  @Get('availability')
  @ApiOperation({ summary: 'Kiểm tra khả dụng theo khoảng thời gian (NV-07)' })
  check(@Query() query: CheckAvailabilityQueryDto) {
    return this.availability.check({
      modelId: query.modelId,
      fromTime: new Date(query.fromTime),
      toTime: new Date(query.toTime),
      quantity: query.quantity ?? 1,
    });
  }

  @Post('requests')
  @ApiOperation({ summary: 'Tạo phiếu mượn (NV-06)' })
  create(@Request() req: any, @Body() dto: CreateBorrowRequestDto) {
    return this.requests.create(req.user.id, dto);
  }

  @Get('borrow-history')
  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @ApiOperation({
    summary:
      'Nhật ký toàn bộ lượt mượn của cả kho, lọc theo trạng thái và khoảng ngày (chỉ quản lý kho)',
  })
  borrowHistoryLog(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.historyLog.list({
      status,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('assets/:id/borrow-history')
  @ApiOperation({
    summary:
      'Lịch sử máy này từng ai mượn — thành viên chỉ thấy lượt của mình, ADMIN/quản lý thấy tất',
  })
  assetBorrowHistory(@Param('id') id: string, @Request() req: any) {
    return this.borrowHistory.forAsset(id, { id: req.user.id, roles: req.user.roles ?? [] });
  }

  @Get('requests')
  @ApiOperation({ summary: 'Danh sách phiếu mượn, lọc theo trạng thái (MH-09)' })
  listRequests(@Query('status') status?: string) {
    return this.approvals.list({ status });
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Chi tiết một phiếu kèm số cấp duyệt cần có' })
  requestDetail(@Param('id') id: string) {
    return this.approvals.detail(id);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/approve')
  @ApiOperation({ summary: 'Duyệt một cấp (NV-09)' })
  approve(@Request() req: any, @Param('id') id: string, @Body() dto: ApproveRequestDto) {
    return this.approvals.approve(id, { id: req.user.id, roles: req.user.roles ?? [] }, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('requests/:id/reject')
  @ApiOperation({ summary: 'Từ chối phiếu, nhả giữ chỗ ngay (BR-32)' })
  reject(@Request() req: any, @Param('id') id: string, @Body() dto: RejectRequestDto) {
    return this.approvals.reject(id, { id: req.user.id, roles: req.user.roles ?? [] }, dto);
  }

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

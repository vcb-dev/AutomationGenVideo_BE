import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ApprovalService } from '../approvals/approval.service';
import { BorrowRequestService } from './borrow-request.service';
import { CreateBorrowRequestDto, ListRequestsQueryDto } from './dto/borrow-request.dto';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsBorrowRequestsController {
  constructor(
    private readonly requests: BorrowRequestService,
    private readonly approvals: ApprovalService,
  ) {}

  @Post('requests')
  @ApiOperation({ summary: 'Tạo phiếu mượn (NV-06)' })
  create(@Request() req: any, @Body() dto: CreateBorrowRequestDto) {
    return this.requests.create(req.user.id, dto);
  }

  @Get('requests')
  @ApiOperation({
    summary:
      'Danh sách phiếu mượn, lọc theo trạng thái (MH-09) — thành viên chỉ thấy phiếu của mình',
  })
  listRequests(@Request() req: any, @Query() query: ListRequestsQueryDto) {
    return this.approvals.list(
      { status: query.status },
      { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team },
    );
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'Chi tiết một phiếu kèm số cấp duyệt cần có — thành viên chỉ xem được phiếu của mình',
  })
  requestDetail(@Request() req: any, @Param('id') id: string) {
    return this.approvals.detail(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team });
  }

  /**
   * Cố ý KHÔNG có `@Roles`: người đứng tên phiếu phải tự huỷ được phiếu của mình, mà họ thường
   * là MEMBER. Quyền chốt trong service — ở đó mới biết ai là chủ phiếu.
   */
  @Post('requests/:id/cancel')
  @ApiOperation({
    summary:
      'Huỷ phiếu chưa giao máy. Chủ phiếu huỷ được khi phiếu chưa duyệt; quản lý kho huỷ được tới trước lúc bàn giao',
  })
  cancel(@Request() req: any, @Param('id') id: string) {
    return this.requests.cancel(id, {
      id: req.user.id,
      roles: req.user.roles ?? [],
      team: req.user.team,
    });
  }
}

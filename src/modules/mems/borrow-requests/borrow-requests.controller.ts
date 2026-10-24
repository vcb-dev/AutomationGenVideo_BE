import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ApprovalService } from '../approvals/approvals.service';
import { BorrowRequestService } from './borrow-requests.service';
import { CreateBorrowRequestDto, ListRequestsQueryDto } from './dto/borrow-request.dto';
import { RequestExtrasService } from './request-extras.service';

@ApiTags('MEMS — Mượn thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsBorrowRequestsController {
  constructor(
    private readonly requests: BorrowRequestService,
    private readonly approvals: ApprovalService,
    private readonly extras: RequestExtrasService,
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
  async listRequests(@Request() req: any, @Query() query: ListRequestsQueryDto) {
    const rows = await this.approvals.list(
      { status: query.status },
      { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team },
    );
    return this.extras.attach(rows);
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'Chi tiết một phiếu kèm số cấp duyệt cần có — thành viên chỉ xem được phiếu của mình',
  })
  async requestDetail(@Request() req: any, @Param('id') id: string) {
    const detail = await this.approvals.detail(id, { id: req.user.id, roles: req.user.roles ?? [], team: req.user.team });
    const [withExtras] = await this.extras.attach([detail]);
    return withExtras;
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

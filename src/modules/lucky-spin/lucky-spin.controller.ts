import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LuckySpinService, SpinActor } from './lucky-spin.service';
import {
  AwardGiftDto,
  ConfirmRoundDto,
  DrawRoundDto,
  BulkCreateGiftsDto,
  BulkCreateMembersDto,
  CreateGiftDto,
  CreateMemberDto,
  CreateTeamDto,
  RecordMemberWinDto,
  RecordTeamWinDto,
  ResetStatusesDto,
  UpdateGiftDto,
  UpdateMemberDto,
  UpdateTeamDto,
} from './dto';

/**
 * Vòng quay may mắn — dữ liệu dùng chung toàn công ty.
 *
 * Chỉ yêu cầu đăng nhập, không phân quyền theo role: đây là công cụ sự kiện nội bộ, ai cũng
 * cần mở xem và thao tác được. Bù lại, mọi thao tác ghi lịch sử đều lưu lại người thực hiện.
 */
@ApiTags('Lucky Spin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lucky-spin')
export class LuckySpinController {
  constructor(private readonly service: LuckySpinService) {}

  private actorOf(req: any): SpinActor {
    return { id: req.user?.id, name: req.user?.full_name ?? req.user?.email };
  }

  @Get('workspaces')
  @ApiOperation({ summary: 'Danh sách các vòng quay' })
  listWorkspaces() {
    return this.service.listWorkspaces();
  }

  @Get(':workspace/state')
  @ApiOperation({ summary: 'Toàn bộ dữ liệu của một vòng quay (FE poll endpoint này)' })
  getState(@Param('workspace') workspace: string) {
    return this.service.getState(workspace);
  }

  @Get(':workspace/history/:kind')
  @ApiOperation({ summary: 'Toàn bộ lịch sử một loại — dùng khi xuất Excel/PDF' })
  listFullHistory(@Param('workspace') workspace: string, @Param('kind') kind: 'members' | 'teams' | 'gifts') {
    return this.service.listFullHistory(workspace, kind);
  }

  /* ──────────────────────── Khóa điều khiển ──────────────────────── */

  @Post(':workspace/control/claim')
  @ApiOperation({ summary: 'Nhận quyền điều khiển; force=true để tiếp quản từ người đang giữ' })
  claimControl(@Request() req: any, @Param('workspace') workspace: string, @Body() body: { force?: boolean }) {
    return this.service.claimControl(workspace, this.actorOf(req), body?.force === true);
  }

  @Post(':workspace/control/release')
  @ApiOperation({ summary: 'Nhả quyền điều khiển cho người khác dùng ngay' })
  releaseControl(@Request() req: any, @Param('workspace') workspace: string) {
    return this.service.releaseControl(workspace, this.actorOf(req));
  }

  /* ────────────────────────── Lượt quay ──────────────────────────── */

  @Post(':workspace/rounds/draw')
  @ApiOperation({ summary: 'Server bốc kết quả và chốt thứ tự ô trên bánh xe' })
  drawRound(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: DrawRoundDto) {
    return this.service.drawRound(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/rounds/:id/confirm')
  @ApiOperation({ summary: 'Ghi toàn bộ người trúng của lượt quay vào lịch sử' })
  confirmRound(
    @Request() req: any,
    @Param('workspace') workspace: string,
    @Param('id') id: string,
    @Body() dto: ConfirmRoundDto,
  ) {
    return this.service.confirmRound(workspace, id, dto, this.actorOf(req));
  }

  @Post(':workspace/rounds/:id/cancel')
  @ApiOperation({ summary: 'Hủy lượt quay chưa xác nhận' })
  cancelRound(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string) {
    return this.service.cancelRound(workspace, id, this.actorOf(req));
  }

  /* ───────────────────────────── Teams ───────────────────────────── */

  @Post(':workspace/teams')
  @ApiOperation({ summary: 'Thêm team' })
  createTeam(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: CreateTeamDto) {
    return this.service.createTeam(workspace, dto, this.actorOf(req));
  }

  @Patch(':workspace/teams/:id')
  @ApiOperation({ summary: 'Sửa team' })
  updateTeam(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.service.updateTeam(workspace, id, dto, this.actorOf(req));
  }

  @Delete(':workspace/teams/:id')
  @ApiOperation({ summary: 'Xóa team (chặn nếu còn thành viên)' })
  deleteTeam(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string) {
    return this.service.deleteTeam(workspace, id, this.actorOf(req));
  }

  /* ──────────────────────────── Members ──────────────────────────── */

  @Post(':workspace/members')
  @ApiOperation({ summary: 'Thêm thành viên' })
  createMember(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: CreateMemberDto) {
    return this.service.createMember(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/members/bulk')
  @ApiOperation({ summary: 'Nhập hàng loạt thành viên từ file Excel' })
  bulkCreateMembers(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: BulkCreateMembersDto) {
    return this.service.bulkCreateMembers(workspace, dto, this.actorOf(req));
  }

  @Patch(':workspace/members/:id')
  @ApiOperation({ summary: 'Sửa thành viên' })
  updateMember(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.service.updateMember(workspace, id, dto, this.actorOf(req));
  }

  @Delete(':workspace/members/:id')
  @ApiOperation({ summary: 'Xóa thành viên (lịch sử trúng thưởng vẫn giữ nguyên)' })
  deleteMember(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string) {
    return this.service.deleteMember(workspace, id, this.actorOf(req));
  }

  /* ───────────────────────────── Gifts ───────────────────────────── */

  @Post(':workspace/gifts')
  @ApiOperation({ summary: 'Thêm quà' })
  createGift(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: CreateGiftDto) {
    return this.service.createGift(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/gifts/bulk')
  @ApiOperation({ summary: 'Nhập hàng loạt quà từ file Excel' })
  bulkCreateGifts(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: BulkCreateGiftsDto) {
    return this.service.bulkCreateGifts(workspace, dto, this.actorOf(req));
  }

  @Patch(':workspace/gifts/:id')
  @ApiOperation({ summary: 'Sửa quà (số còn lại tự kẹp không vượt tổng)' })
  updateGift(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string, @Body() dto: UpdateGiftDto) {
    return this.service.updateGift(workspace, id, dto, this.actorOf(req));
  }

  @Delete(':workspace/gifts/:id')
  @ApiOperation({ summary: 'Xóa quà' })
  deleteGift(@Request() req: any, @Param('workspace') workspace: string, @Param('id') id: string) {
    return this.service.deleteGift(workspace, id, this.actorOf(req));
  }

  /* ─────────────────────── Kết quả quay ──────────────────────────── */

  @Post(':workspace/wins/member')
  @ApiOperation({ summary: 'Ghi nhận thành viên trúng' })
  recordMemberWin(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: RecordMemberWinDto) {
    return this.service.recordMemberWin(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/wins/team')
  @ApiOperation({ summary: 'Ghi nhận team trúng' })
  recordTeamWin(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: RecordTeamWinDto) {
    return this.service.recordTeamWin(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/gift-awards')
  @ApiOperation({ summary: 'Trao quà cho cá nhân hoặc cả team' })
  awardGift(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: AwardGiftDto) {
    return this.service.awardGift(workspace, dto, this.actorOf(req));
  }

  /* ──────────────────────────── Đặt lại ──────────────────────────── */

  @Post(':workspace/reset-statuses')
  @ApiOperation({ summary: 'Đưa tất cả thành viên hoặc team về chưa quay' })
  resetStatuses(@Request() req: any, @Param('workspace') workspace: string, @Body() dto: ResetStatusesDto) {
    return this.service.resetStatuses(workspace, dto, this.actorOf(req));
  }

  @Post(':workspace/reset-gifts')
  @ApiOperation({ summary: 'Khôi phục tồn kho quà và trạng thái đã nhận' })
  resetGifts(@Request() req: any, @Param('workspace') workspace: string) {
    return this.service.resetGifts(workspace, this.actorOf(req));
  }

  /* ──────────────────────────── Lịch sử ──────────────────────────── */

  @Delete(':workspace/history/:kind/:id')
  @ApiOperation({ summary: 'Xóa một dòng lịch sử' })
  deleteHistoryEntry(
    @Request() req: any,
    @Param('workspace') workspace: string,
    @Param('kind') kind: 'members' | 'teams' | 'gifts',
    @Param('id') id: string,
  ) {
    return this.service.deleteHistoryEntry(workspace, kind, id, this.actorOf(req));
  }

  @Delete(':workspace/history/:kind')
  @ApiOperation({ summary: 'Xóa toàn bộ một loại lịch sử' })
  clearHistory(@Request() req: any, @Param('workspace') workspace: string, @Param('kind') kind: 'members' | 'teams' | 'gifts') {
    return this.service.clearHistory(workspace, kind, this.actorOf(req));
  }
}

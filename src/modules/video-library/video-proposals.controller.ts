import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { VideoLibraryService } from './video-library.service';
import { ProposeVideoDto, ReviewProposalDto } from './video-library.dto';

// Hàng đợi duyệt video (member đề xuất → leader/admin duyệt) trước khi vào
// video_library — mirror team_push_requests (catalog.controller.ts).
@UseGuards(JwtAuthGuard)
@Controller('video-proposals')
export class VideoProposalsController {
  constructor(private readonly service: VideoLibraryService) {}

  @Post()
  async propose(@Body() dto: ProposeVideoDto, @Request() req: any) {
    const proposal = await this.service.proposeVideo(req.user.id, dto);
    return { status: 'ok', message: 'Đã gửi đề xuất, chờ leader/admin duyệt.', proposal };
  }

  @Get('my')
  async myProposals(@Query('status') status: string | undefined, @Request() req: any) {
    return this.service.listMyProposals(req.user.id, status);
  }

  @Get('pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async pending(@Query('status') status: string | undefined) {
    return this.service.listPendingProposals(status);
  }

  @Patch(':id/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async review(@Param('id') id: string, @Body() dto: ReviewProposalDto, @Request() req: any) {
    const result = await this.service.reviewProposal(
      id,
      dto.action,
      dto.note,
      req.user.id,
      req.user.full_name || '',
      req.user.roles ?? [],
    );
    return { status: 'ok', proposal: result };
  }
}

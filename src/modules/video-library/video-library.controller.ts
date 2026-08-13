import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { VideoLibraryService } from './video-library.service';
import { ProposeVideoDto } from './video-library.dto';

// Hoàn thiện route /video-library + /approved-content mà FE (dashboard/video-library/page.tsx)
// đã gọi sẵn từ trước nhưng chưa từng có BE — schema (VideoLibrary/ApprovedContent) đã có
// từ migration init.
@UseGuards(JwtAuthGuard)
@Controller()
export class VideoLibraryController {
  constructor(private readonly service: VideoLibraryService) {}

  @Get('video-library')
  async list(@Query('type') type?: string) {
    const t = type === 'SHARED' ? 'SHARED' : 'TEAM';
    return this.service.listVideoLibrary(t);
  }

  @Post('video-library/direct')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async addDirect(@Body() dto: ProposeVideoDto, @Request() req: any) {
    const result = await this.service.addVideoDirectly(req.user.id, req.user.full_name || '', req.user.roles ?? [], dto);
    return { status: 'ok', message: 'Đã thêm video vào bộ sưu tập.', ...result };
  }

  @Delete('video-library/:id')
  async remove(@Param('id') id: string, @Request() req: any) {
    await this.service.deleteVideoLibrary(id, req.user.roles ?? []);
    return { status: 'ok' };
  }

  @Get('approved-content')
  async listContent() {
    return this.service.listApprovedContent();
  }

  @Delete('approved-content/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async removeContent(@Param('id') id: string, @Request() req: any) {
    await this.service.deleteApprovedContent(id, req.user.roles ?? []);
    return { status: 'ok' };
  }
}

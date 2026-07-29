import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AccountsService } from './accounts.service';

@ApiTags('Social Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tài khoản MXH đã kết nối' })
  findAll(@Request() req) {
    return this.accountsService.findAll(req.user.id);
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Lấy danh sách account sắp hết hạn token (trong 7 ngày)' })
  getExpiring(@Request() req) {
    return this.accountsService.getExpiringAccounts(req.user.id);
  }

  @Get(':id/pages')
  @ApiOperation({ summary: 'Lấy Facebook Pages + Instagram liên kết (cache 5 phút)' })
  getPages(
    @Param('id') id: string,
    @Request() req,
    @Query('refresh') refresh?: string,
  ) {
    return this.accountsService.getFacebookPages(id, req.user.id, refresh === 'true');
  }

  @Post(':id/save-page')
  @ApiOperation({ summary: 'Lưu Facebook Page (+ Instagram liên kết) thành account riêng' })
  savePage(
    @Param('id') parentAccountId: string,
    @Body() body: {
      pageId: string;
      pageName: string;
      pageToken: string;
      pagePicture?: string;
      igId?: string;
      igName?: string;
      igUsername?: string;
      igPicture?: string;
    },
    @Request() req,
  ) {
    return this.accountsService.saveFacebookPageAccount(req.user.id, {
      parentAccountId,
      ...body,
    });
  }

  @Post(':id/sync-pages')
  @ApiOperation({ summary: 'Đồng bộ lại Page Token cho tất cả Facebook Pages + Instagram liên kết' })
  async syncPages(@Param('id') id: string, @Request() req) {
    await this.accountsService.syncFacebookChildrenTokens(id, req.user.id);
    await this.accountsService.autoSaveFacebookPages(id, req.user.id);
    return { success: true, message: 'Đã đồng bộ token cho tất cả Pages/Instagram liên kết' };
  }

  @Patch(':id/shared')
  @ApiOperation({ summary: 'Bật/tắt chia sẻ account cho toàn bộ hệ thống (chỉ chủ sở hữu)' })
  setShared(
    @Param('id') id: string,
    @Body() body: { is_shared: boolean },
    @Request() req,
  ) {
    return this.accountsService.setShared(id, req.user.id, body.is_shared);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Ngắt kết nối tài khoản' })
  disconnect(@Param('id') id: string, @Request() req) {
    const isAdmin = (req.user.roles ?? []).includes('ADMIN');
    return this.accountsService.disconnect(id, req.user.id, isAdmin);
  }
}

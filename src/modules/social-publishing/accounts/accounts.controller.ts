import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AccountsService } from './accounts.service';
import { AddManualInstagramAccountDto } from './dto/account.dto';

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

  @Get('instagram/manual')
  @ApiOperation({ summary: 'Lấy danh sách tài khoản Instagram thủ công (không liên kết Facebook)' })
  async getManualInstagramAccounts(@Request() req) {
    return this.accountsService.getManualInstagramAccounts(req.user.id);
  }

  @Post('instagram/manual')
  @ApiOperation({ summary: 'Thêm tài khoản Instagram thủ công (không cần liên kết Facebook)' })
  async addManualInstagram(
    @Body() body: AddManualInstagramAccountDto,
    @Request() req,
  ) {
    return this.accountsService.addManualInstagramAccount(req.user.id, {
      name: body.name,
      username: body.username,
      access_token: body.access_token,
      parent_id: body.parent_id,
      avatar_url: body.avatar_url,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Ngắt kết nối tài khoản' })
  disconnect(@Param('id') id: string, @Request() req) {
    return this.accountsService.disconnect(id, req.user.id);
  }
}

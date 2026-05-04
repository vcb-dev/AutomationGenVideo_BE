import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
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

  @Delete(':id')
  @ApiOperation({ summary: 'Ngắt kết nối tài khoản' })
  disconnect(@Param('id') id: string, @Request() req) {
    return this.accountsService.disconnect(id, req.user.id);
  }
}

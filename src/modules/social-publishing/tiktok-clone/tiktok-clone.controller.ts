import { Controller, Post, Get, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { TiktokCloneService } from './tiktok-clone.service';
import { CloneTiktokDto } from './dto/clone-tiktok.dto';

@ApiTags('TikTok Clone')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social/tiktok-clone')
export class TiktokCloneController {
  constructor(private readonly tiktokCloneService: TiktokCloneService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Lấy thông tin preview video TikTok (dùng cho extension trước khi clone)' })
  preview(@Query('url') tiktokUrl: string) {
    return this.tiktokCloneService.getVideoPreview(tiktokUrl);
  }

  @Post()
  @ApiOperation({ summary: 'Clone video TikTok → Drive → đăng Facebook pages' })
  clone(@Body() dto: CloneTiktokDto, @Request() req) {
    return this.tiktokCloneService.cloneAndPublish(req.user.id, dto);
  }
}

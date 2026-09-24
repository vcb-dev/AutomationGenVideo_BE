import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Logger, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { extractXiaohongshuUserId } from '../../common/utils/channel-url.util';
import { normalizeTargetCount } from '../../common/utils/target-count.util';
import { XiaohongshuScraperService } from './xiaohongshu-scraper.service';
import { XiaohongshuScraperReadService } from './xiaohongshu-scraper-read.service';

function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

// Thay thế search_xiaohongshu_notes / xhs_profile_scrape / PATCH+GET của xhs_profile_detail
// bên AI (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// GET (list_xiaohongshu_videos/xiaohongshu_keyword_suggest/xhs_profiles_list/
// xhs_profile_detail/xhs_profile_videos) cũng đã chuyển hẳn sang BE (XiaohongshuScraperReadService).
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
@UseGuards(JwtAuthGuard)
@Controller('scraper/xiaohongshu')
export class XiaohongshuScraperController {
  private readonly logger = new Logger(XiaohongshuScraperController.name);

  constructor(
    private readonly service: XiaohongshuScraperService,
    private readonly readService: XiaohongshuScraperReadService,
  ) {}

  @Post(['profiles/sync-all', 'periodic-refresh'])
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async syncAll(
    @Body()
    body?: {
      scope?: 'tracked' | 'bookmarked' | 'all';
      mode?: 'count' | 'days';
      count?: number;
      days?: number;
    },
  ) {
    this.service.periodicRefresh(body).catch((err: any) => {
      this.logger.error(`[XHS-SYNC-ALL] Lỗi đồng bộ: ${err.message}`);
    });
    const scopeLabel = body?.scope === 'bookmarked' ? 'kênh đã lưu' : body?.scope === 'all' ? 'tất cả kênh' : 'kênh chú ý';
    const detailLabel = body?.mode === 'days' ? `${body.days || 7} ngày gần nhất` : `${body?.count || 20} video mới nhất`;
    return {
      status: 'ok',
      message: `Đã bắt đầu cào video XiaoHongShu (${scopeLabel}, ${detailLabel}) trong nền!`,
    };
  }

  @Get('videos')
  async videos(@Query() query: Record<string, string>) {
    return this.readService.listVideos(query);
  }

  @Get('keywords/suggest')
  async keywordSuggest(@Query('q') q?: string) {
    return this.readService.keywordSuggest((q || '').trim());
  }

  @Get('profiles')
  async profilesList(@Query() query: Record<string, string>) {
    return this.readService.listProfiles(query);
  }

  @Get('profiles/:id')
  async profileDetail(@Param('id') id: string) {
    const result = await this.readService.profileDetail(BigInt(id));
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:id/videos')
  async profileVideos(@Param('id') id: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileVideos(BigInt(id), query);
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:id/lookalikes')
  async lookalikes(@Param('id') id: string) {
    return this.readService.lookalikes(BigInt(id));
  }

  @Post('search')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async search(@Body() body: { keyword?: string; num_of_posts?: number; display_keyword?: string }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    // display_keyword = tiếng Việt user gõ (FE đã dịch sang tiếng Trung ở `keyword`).
    const displayKeyword = (body?.display_keyword || '').trim() || undefined;
    const count = Math.min(100, Math.max(1, Number(body?.num_of_posts) || 20));
    const { created, updated, auto_discovered } = await this.service.searchKeyword(keyword, count, displayKeyword);

    if (created + updated === 0) {
      return {
        status: 'ok',
        message: `Không tìm thấy video nào cho "${displayKeyword || keyword}".`,
        created: 0,
        updated: 0,
        auto_discovered: [],
        auto_discovered_count: 0,
      };
    }

    let message = `Đã tìm thấy ${created} video mới cho "${displayKeyword || keyword}".`;
    if (auto_discovered.length > 0) {
      message += ` Đang tự động khám phá ${auto_discovered.length} kênh mới: ${auto_discovered.join(', ')}.`;
    }

    return {
      status: 'ok',
      message,
      created,
      updated,
      auto_discovered,
      auto_discovered_count: auto_discovered.length,
    };
  }

  @Post('profiles/scrape')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async profileScrape(@Body() body: { user_id?: string; is_owned?: boolean; num_of_posts?: number }) {
    const input = (body?.user_id || '').trim();
    if (!input) throw new HttpException({ error: 'user_id is required' }, HttpStatus.BAD_REQUEST);

    const targetCount = normalizeTargetCount(body?.num_of_posts);

    // Link rút gọn (xhslink.com) không chứa user_id — resolve về URL thật trước.
    const raw = await resolveShortLink(input);

    const userId = extractXiaohongshuUserId(raw);
    if (!userId) {
      throw new HttpException(
        {
          error:
            'Không lấy được ID tài khoản XiaoHongShu. Vui lòng nhập link profile (vd: xiaohongshu.com/user/profile/...) hoặc user_id 24 ký tự',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.service.scrapeProfile(userId, body?.is_owned, undefined, targetCount);
  }

  @Patch('profiles/:id')
  async patchProfile(
    @Param('id') id: string,
    @Body() body: { is_tracked?: boolean; is_bookmarked?: boolean },
    @Request() req: any,
  ) {
    if (body?.is_tracked !== undefined) assertCanManageChannels(req);
    return this.service.patchProfile(BigInt(id), body || {}, req.user);
  }

  // Xoá cứng kênh: bản ghi kênh + toàn bộ video/lịch sử của nó biến mất vĩnh viễn.
  // Chỉ ADMIN/LEADER, khớp phân quyền của mọi thao tác quản lý kênh khác.
  @Delete('profiles/:profileId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async remove(@Param('profileId') profileId: string) {
    return this.service.deleteProfile(BigInt(profileId));
  }

  @Patch('profiles/:profileId/classification')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async updateClassification(
    @Param('profileId') profileId: string,
    @Body() body: { channel_type?: string; product_lines?: string[] },
  ) {
    const channel_type = body.channel_type === 'content' ? 'content' : 'product';
    const product_lines = Array.isArray(body.product_lines) ? body.product_lines : [];
    return this.service.updateClassification(BigInt(profileId), channel_type, product_lines);
  }
}

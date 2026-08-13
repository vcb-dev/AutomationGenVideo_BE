import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
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
  constructor(
    private readonly service: XiaohongshuScraperService,
    private readonly readService: XiaohongshuScraperReadService,
  ) {}

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

    // Cho phép nhập nguyên URL profile (xiaohongshu.com/user/profile/<hex_id>) hoặc user_id trần.
    const urlMatch = raw.match(/xiaohongshu\.com\/user\/profile\/([0-9a-f]+)/i);
    const userId = urlMatch ? urlMatch[1] : raw;

    return this.service.scrapeProfile(userId, body?.is_owned, undefined, targetCount);
  }

  @Patch('profiles/:id')
  async patchProfile(
    @Param('id') id: string,
    @Body() body: { is_tracked?: boolean; is_bookmarked?: boolean },
    @Request() req: any,
  ) {
    if (body?.is_tracked !== undefined) assertCanManageChannels(req);
    return this.service.patchProfile(BigInt(id), body || {});
  }
}

import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { XiaohongshuScraperService } from './xiaohongshu-scraper.service';
import { XiaohongshuScraperReadService } from './xiaohongshu-scraper-read.service';

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

  @Post('search')
  async search(@Body() body: { keyword?: string; num_of_posts?: number }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    const count = Math.min(100, Math.max(1, Number(body?.num_of_posts) || 20));
    const { created, updated } = await this.service.searchKeyword(keyword, count);

    if (created + updated === 0) {
      return {
        status: 'ok',
        message: `Không tìm thấy video nào cho "${keyword}".`,
        created: 0,
        updated: 0,
      };
    }

    return {
      status: 'ok',
      message: `Đã tìm thấy ${created} video mới cho "${keyword}".`,
      created,
      updated,
    };
  }

  @Post('profiles/scrape')
  async profileScrape(@Body() body: { user_id?: string; is_owned?: boolean }) {
    const userId = (body?.user_id || '').trim();
    if (!userId) throw new HttpException({ error: 'user_id is required' }, HttpStatus.BAD_REQUEST);

    return this.service.scrapeProfile(userId, body?.is_owned);
  }

  @Patch('profiles/:id')
  async patchProfile(
    @Param('id') id: string,
    @Body() body: { is_tracked?: boolean; is_bookmarked?: boolean },
  ) {
    return this.service.patchProfile(BigInt(id), body || {});
  }
}

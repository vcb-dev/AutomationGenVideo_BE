import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DouyinScraperService } from './douyin-scraper.service';
import { DouyinScraperReadService } from './douyin-scraper-read.service';

// Thay thế douyin_keyword_search / douyin_profile_scrape / douyin_profile_toggle bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
// GET (douyin_videos_list/douyin_keyword_suggest/douyin_profiles_list/douyin_profile_detail/
// douyin_profile_videos) cũng đã chuyển hẳn sang BE (DouyinScraperReadService).
@UseGuards(JwtAuthGuard)
@Controller('scraper/douyin')
export class DouyinScraperController {
  constructor(
    private readonly service: DouyinScraperService,
    private readonly readService: DouyinScraperReadService,
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

  @Get('profiles/:pk')
  async profileDetail(@Param('pk') pk: string) {
    const result = await this.readService.profileDetail(BigInt(pk));
    if (!result) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:pk/videos')
  async profileVideos(@Param('pk') pk: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileVideos(BigInt(pk), query);
    if (!result) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Post('search')
  async search(@Body() body: { keyword?: string; num_of_posts?: number }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const { created, updated } = await this.service.searchKeyword(keyword, count);

    return {
      status: 'ok',
      message: `Đang tìm kiếm "${keyword}" trên Douyin...`,
      created,
      updated,
    };
  }

  @Post('profile/scrape')
  async profileScrape(@Body() body: { sec_user_id?: string; is_owned?: boolean }) {
    const secUserId = (body?.sec_user_id || '').trim();
    if (!secUserId) throw new HttpException({ error: 'sec_user_id is required' }, HttpStatus.BAD_REQUEST);

    // num_of_posts client gửi bị bỏ qua có chủ đích — khớp hành vi gốc: backend luôn
    // tự quyết định 20 (đồng bộ lần đầu) / 30 (delta) / 600 (cào tiếp nền), không tin client.
    return this.service.scrapeProfile(secUserId, body?.is_owned);
  }

  @Post('profiles/:pk/toggle')
  async toggle(@Param('pk') pk: string, @Body() body: { field?: 'is_bookmarked' | 'is_tracked' }) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_tracked') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_tracked' }, HttpStatus.BAD_REQUEST);
    }
    const newValue = await this.service.toggleProfile(BigInt(pk), field);
    return { status: 'ok', [field]: newValue };
  }
}

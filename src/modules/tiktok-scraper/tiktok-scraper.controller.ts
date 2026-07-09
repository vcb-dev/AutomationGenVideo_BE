import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TiktokScraperService } from './tiktok-scraper.service';
import { TiktokScraperReadService } from './tiktok-scraper-read.service';

// Thay thế tiktok_search / tiktok_profile_scrape / tiktok_profile_toggle bên AI
// (đã xóa) — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
// GET (tiktok_videos/tiktok_keyword_suggest/tiktok_profiles_list/tiktok_profile_detail/
// tiktok_profile_videos) cũng đã chuyển hẳn sang BE (TiktokScraperReadService) — AI
// giờ không còn đụng DB ở đâu nữa cho nền tảng này.
@UseGuards(JwtAuthGuard)
@Controller('scraper/tiktok')
export class TiktokScraperController {
  constructor(
    private readonly service: TiktokScraperService,
    private readonly readService: TiktokScraperReadService,
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

  @Get('profiles/:profileId')
  async profileDetail(@Param('profileId') profileId: string) {
    const result = await this.readService.profileDetail(BigInt(profileId));
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Get('profiles/:profileId/videos')
  async profileVideos(@Param('profileId') profileId: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileVideos(BigInt(profileId), query);
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Post('search')
  async search(@Body() body: { keyword?: string; num_of_posts?: number; country?: string }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const region = body?.country || 'VN';
    const { created, updated } = await this.service.searchKeyword(keyword, count, region);

    return {
      status: 'ok',
      message: `Đã tìm thấy ${created} video mới cho "${keyword}".`,
      created,
      updated,
    };
  }

  @Post('profiles/scrape')
  async profileScrape(@Body() body: { username?: string; url?: string; is_owned?: boolean }) {
    const raw = (body?.username || body?.url || '').trim();
    if (!raw) throw new HttpException({ error: 'username is required' }, HttpStatus.BAD_REQUEST);

    const urlMatch = raw.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/);
    const username = urlMatch ? urlMatch[1] : raw.replace(/^@/, '').trim();

    if (!username || !/^[A-Za-z0-9_.]+$/.test(username)) {
      throw new HttpException({ error: 'Username không hợp lệ' }, HttpStatus.BAD_REQUEST);
    }

    return this.service.scrapeProfile(username, body?.is_owned);
  }

  @Post('profiles/:profileId/toggle')
  async toggle(@Param('profileId') profileId: string, @Body() body: { field?: 'is_bookmarked' | 'is_tracked' }) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_tracked') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_tracked' }, HttpStatus.BAD_REQUEST);
    }
    const newValue = await this.service.toggleProfile(BigInt(profileId), field);
    return { status: 'ok', [field]: newValue };
  }
}

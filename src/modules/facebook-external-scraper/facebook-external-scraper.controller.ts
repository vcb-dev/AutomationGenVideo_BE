import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FacebookExternalScraperService } from './facebook-external-scraper.service';
import { FacebookExternalScraperReadService } from './facebook-external-scraper-read.service';

// Thay thế fanpage_toggle / trigger_scrape_reels / fanpage_scrape_by_url bên AI (đã xóa)
// — route giữ nguyên path cũ để FE (scraperService.ts) không cần đổi gì.
// GET (discovered_fanpages/fanpage_detail) cũng đã chuyển hẳn sang BE
// (FacebookExternalScraperReadService); search_reels ở FacebookReelsSearchController riêng
// (path scraper/reels/search khác prefix scraper/fanpages).
// Trước đây AI tự check IsAuthenticated; giờ BE xử lý native nên phải tự guard.
@UseGuards(JwtAuthGuard)
@Controller('scraper/fanpages')
export class FacebookExternalScraperController {
  constructor(
    private readonly service: FacebookExternalScraperService,
    private readonly readService: FacebookExternalScraperReadService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    return this.readService.discoveredFanpages(query);
  }

  @Get(':fanpage_id')
  async detail(@Param('fanpage_id') fanpageId: string) {
    const result = await this.readService.fanpageDetail(BigInt(fanpageId));
    if (!result) throw new HttpException({ error: 'Not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Post(':fanpage_id/toggle')
  async toggle(
    @Param('fanpage_id') fanpageId: string,
    @Body() body: { field?: 'is_bookmarked' | 'is_periodic_crawl' },
  ) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_periodic_crawl') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_periodic_crawl' }, HttpStatus.BAD_REQUEST);
    }
    return this.service.toggleFanpage(BigInt(fanpageId), field);
  }

  @Post('scrape-reels')
  async scrapeReels(@Body() body: { fanpage_id?: number }) {
    if (!body?.fanpage_id) throw new HttpException({ error: 'fanpage_id is required' }, HttpStatus.BAD_REQUEST);
    return this.service.triggerScrapeReels(BigInt(body.fanpage_id));
  }

  @Post('scrape-by-url')
  async scrapeByUrl(@Body() body: { url?: string }) {
    const url = (body?.url || '').trim();
    if (!url) throw new HttpException({ error: 'url is required' }, HttpStatus.BAD_REQUEST);
    if (!url.includes('facebook.com')) {
      throw new HttpException({ error: 'URL không hợp lệ. Ví dụ: https://www.facebook.com/pagename' }, HttpStatus.BAD_REQUEST);
    }
    return this.service.scrapeByUrl(url);
  }
}

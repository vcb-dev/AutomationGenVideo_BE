import { Body, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { resolveShortLink } from '../../common/utils/resolve-short-link.util';
import { FacebookExternalScraperService } from './facebook-external-scraper.service';
import { FacebookExternalScraperReadService } from './facebook-external-scraper-read.service';

// Facebook không có is_tracked — field tương đương "kênh chú ý" ở đây là
// is_periodic_crawl (không phải is_tracked như 6 platform kia).
function assertCanManageChannels(req: any): void {
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.LEADER)) {
    throw new ForbiddenException('Chỉ leader/admin được quản lý kênh chú ý');
  }
}

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

  // Xoá cứng fanpage: bản ghi + toàn bộ reels/lịch sử chỉ số biến mất vĩnh viễn.
  // Chỉ ADMIN/LEADER, khớp phân quyền của scrape-reels và scrape-by-url.
  @Delete(':fanpage_id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async remove(@Param('fanpage_id') fanpageId: string) {
    return this.service.deleteFanpage(BigInt(fanpageId));
  }

  @Post(':fanpage_id/toggle')
  async toggle(
    @Param('fanpage_id') fanpageId: string,
    @Body() body: { field?: 'is_bookmarked' | 'is_periodic_crawl' },
    @Request() req: any,
  ) {
    const field = body?.field;
    if (field !== 'is_bookmarked' && field !== 'is_periodic_crawl') {
      throw new HttpException({ error: 'field must be is_bookmarked or is_periodic_crawl' }, HttpStatus.BAD_REQUEST);
    }
    if (field === 'is_periodic_crawl') assertCanManageChannels(req);
    return this.service.toggleFanpage(BigInt(fanpageId), field);
  }

  @Post('scrape-reels')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async scrapeReels(@Body() body: { fanpage_id?: number }) {
    if (!body?.fanpage_id) throw new HttpException({ error: 'fanpage_id is required' }, HttpStatus.BAD_REQUEST);
    return this.service.triggerScrapeReels(BigInt(body.fanpage_id));
  }

  @Post('scrape-by-url')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.LEADER)
  async scrapeByUrl(@Body() body: { url?: string }) {
    const input = (body?.url || '').trim();
    if (!input) throw new HttpException({ error: 'url is required' }, HttpStatus.BAD_REQUEST);

    // Link rút gọn (fb.watch) không chứa tên page — resolve về URL thật trước.
    const url = await resolveShortLink(input);

    if (!url.includes('facebook.com')) {
      throw new HttpException({ error: 'URL không hợp lệ. Ví dụ: https://www.facebook.com/pagename' }, HttpStatus.BAD_REQUEST);
    }
    return this.service.scrapeByUrl(url);
  }
}

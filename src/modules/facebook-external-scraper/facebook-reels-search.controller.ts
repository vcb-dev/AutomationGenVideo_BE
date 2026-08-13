import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FacebookExternalScraperReadService } from './facebook-external-scraper-read.service';

// Thay thế search_reels bên AI (đã xóa). Path riêng (scraper/reels/search) khác prefix
// scraper/fanpages nên cần controller riêng dù cùng module/service.
@UseGuards(JwtAuthGuard)
@Controller('scraper/reels')
export class FacebookReelsSearchController {
  constructor(private readonly readService: FacebookExternalScraperReadService) {}

  @Get('search')
  async search(@Query() query: Record<string, string>) {
    return this.readService.searchReels(query);
  }
}

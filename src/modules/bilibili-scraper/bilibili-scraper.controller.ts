import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BilibiliScraperService } from './bilibili-scraper.service';
import { BilibiliScraperReadService } from './bilibili-scraper-read.service';

// Nền tảng mới — chỉ có kênh ngoài (external), không có is_owned/internal. Toàn
// bộ route (đọc lẫn ghi) đều native ở BE ngay từ đầu. AI chỉ còn endpoint
// fetch-only (bilibili_fetch_views.py).
@UseGuards(JwtAuthGuard)
@Controller('scraper/bilibili')
export class BilibiliScraperController {
  constructor(
    private readonly service: BilibiliScraperService,
    private readonly readService: BilibiliScraperReadService,
  ) {}

  @Get('videos')
  async videos(@Query() query: Record<string, string>) {
    return this.readService.listVideos(query);
  }

  @Get('keywords/suggest')
  async keywordSuggest(@Query('q') q?: string) {
    return this.readService.keywordSuggest((q || '').trim());
  }

  @Post('search')
  async search(@Body() body: { keyword?: string; num_of_posts?: number }) {
    const keyword = (body?.keyword || '').trim();
    if (!keyword) throw new HttpException({ error: 'keyword is required' }, HttpStatus.BAD_REQUEST);

    const count = Math.min(200, Math.max(1, Number(body?.num_of_posts) || 30));
    const { created, updated } = await this.service.searchKeyword(keyword, count);

    return {
      status: 'ok',
      message: `Đã tìm thấy ${created} video mới cho "${keyword}".`,
      created,
      updated,
    };
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

  @Post('profiles/scrape')
  async profileScrape(@Body() body: { mid?: string }) {
    const raw = (body?.mid || '').trim();
    if (!raw) throw new HttpException({ error: 'mid is required' }, HttpStatus.BAD_REQUEST);

    // Cho phép nhập nguyên URL profile (space.bilibili.com/xxxx) hoặc mid trần.
    const urlMatch = raw.match(/space\.bilibili\.com\/(\d+)/i);
    const mid = urlMatch ? urlMatch[1] : raw;

    if (!/^\d+$/.test(mid)) {
      throw new HttpException({ error: 'mid không hợp lệ (phải là số)' }, HttpStatus.BAD_REQUEST);
    }

    return this.service.scrapeProfile(mid);
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

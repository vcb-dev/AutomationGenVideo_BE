import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { YoutubeScraperService } from './youtube-scraper.service';
import { YoutubeScraperReadService } from './youtube-scraper-read.service';

// Nền tảng mới — toàn bộ route (đọc lẫn ghi) đều native ở BE ngay từ đầu, không có
// gì cần "migrate" từ AI. AI chỉ còn endpoint fetch-only (youtube_fetch_views.py).
@UseGuards(JwtAuthGuard)
@Controller('scraper/youtube')
export class YoutubeScraperController {
  constructor(
    private readonly service: YoutubeScraperService,
    private readonly readService: YoutubeScraperReadService,
  ) {}

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

  @Get('profiles/:profileId/shorts')
  async profileShorts(@Param('profileId') profileId: string, @Query() query: Record<string, string>) {
    const result = await this.readService.profileShorts(BigInt(profileId), query);
    if (!result) throw new HttpException({ error: 'Profile not found' }, HttpStatus.NOT_FOUND);
    return result;
  }

  @Post('profiles/scrape')
  async profileScrape(@Body() body: { channel_id?: string; is_owned?: boolean }) {
    const raw = (body?.channel_id || '').trim();
    if (!raw) throw new HttpException({ error: 'channel_id is required' }, HttpStatus.BAD_REQUEST);

    // Cho phép nhập nguyên URL kênh (https://www.youtube.com/channel/UCxxxx) hoặc channel_id trần.
    const urlMatch = raw.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
    const channelId = urlMatch ? urlMatch[1] : raw;

    if (!/^UC[\w-]{20,}$/i.test(channelId)) {
      throw new HttpException(
        { error: 'channel_id không hợp lệ (phải bắt đầu bằng UC...). Chưa hỗ trợ resolve từ @handle.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.service.scrapeChannel(channelId, body?.is_owned);
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

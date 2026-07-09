import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ScraperAggregateReadService } from './scraper-aggregate-read.service';

// Thay thế all_external_videos / owned_channel_videos bên AI (đã xóa) — route giữ
// nguyên path cũ để FE (scraperService.ts) không cần đổi gì. Gom dữ liệu từ nhiều
// module scraper khác nhau nên đặt ở module riêng, không thuộc platform cụ thể nào.
@UseGuards(JwtAuthGuard)
@Controller('scraper')
export class ScraperAggregateController {
  constructor(private readonly readService: ScraperAggregateReadService) {}

  @Get('all-videos')
  async allVideos(@Query() query: Record<string, string>) {
    return this.readService.allExternalVideos(query);
  }

  @Get('owned/videos')
  async ownedVideos(@Query() query: Record<string, string>) {
    return this.readService.ownedChannelVideos(query);
  }
}

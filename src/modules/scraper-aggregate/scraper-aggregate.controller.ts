import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScraperAggregateReadService } from './scraper-aggregate-read.service';
import { OwnedStatsService } from './owned-stats.service';
import { OwnedScriptService } from './owned-script.service';
import { OwnedDuplicateService } from './owned-duplicate.service';

import { TrafficInsightsService } from './traffic-insights.service';

// Thay thế all_external_videos / owned_channel_videos bên AI (đã xóa) — route giữ
// nguyên path cũ để FE (scraperService.ts) không cần đổi gì. Gom dữ liệu từ nhiều
// module scraper khác nhau nên đặt ở module riêng, không thuộc platform cụ thể nào.
@UseGuards(JwtAuthGuard)
@Controller('scraper')
export class ScraperAggregateController {
  constructor(
    private readonly readService: ScraperAggregateReadService,
    private readonly statsService: OwnedStatsService,
    private readonly scriptService: OwnedScriptService,
    private readonly duplicateService: OwnedDuplicateService,
    private readonly trafficInsightsService: TrafficInsightsService,
  ) {}

  @Get('traffic-insights')
  async getTrafficInsights(
    @Query('channelId') channelId: string,
    @Query('date') date?: string,
  ) {
    if (!channelId) {
      return { success: false, views: 0, message: 'channelId is required' };
    }
    return this.trafficInsightsService.getTrafficInsights(channelId, date);
  }

  @Get('all-videos')
  async allVideos(@Query() query: Record<string, string>) {
    return this.readService.allExternalVideos(query);
  }

  /** Đổ vào ô chọn kênh — xem ownedChannels(). */
  @Get('owned/channels')
  async ownedChannels() {
    return this.readService.ownedChannels();
  }

  /** Đổ vào ô chọn hashtag — xem ownedHashtags(). */
  @Get('owned/hashtags')
  async ownedHashtags(@Query('limit') limit?: string) {
    return this.readService.ownedHashtags(Number(limit) || 60);
  }

  @Get('owned/videos')
  async ownedVideos(@Query() query: Record<string, string>) {
    return this.readService.ownedChannelVideos(query);
  }

  /**
   * Số liệu cho trang Tổng quan kênh nội bộ — xem OwnedStatsService.
   *
   * Khoảng ngày nhận theo `tu`/`den` (YYYY-MM-DD). `days` giữ lại cho các nút preset và cho
   * những lần gọi cũ; có `tu` thì `days` bị bỏ qua.
   */
  @Get('owned/stats')
  async ownedStats(
    @Query('platform') platform?: string,
    @Query('days') days?: string,
    @Query('tu') tu?: string,
    @Query('den') den?: string,
  ) {
    return this.statsService.thongKe({ platform, days, tu, den });
  }

  /**
   * Video đăng trùng giữa các kênh nội bộ — xem OwnedDuplicateService.
   *
   * Tách khỏi /owned/stats để khối trùng lặp tự tải: gộp vào đó thì cả trang phải chờ thêm
   * ba truy vấn nữa mới vẽ được ô số đầu tiên. Nhận cùng bộ tham số kỳ ngày.
   */
  @Get('owned/trung-lap')
  async ownedTrungLap(
    @Query('platform') platform?: string,
    @Query('days') days?: string,
    @Query('tu') tu?: string,
    @Query('den') den?: string,
  ) {
    return this.duplicateService.thongKe({ platform, days, tu, den });
  }

  /**
   * Trạng thái chấm điểm PAAST của nhiều video — CHỈ đọc bảng đã lưu, không gọi Graph API.
   *
   * Lưới video gọi đúng một lần cho cả trang. Nếu để mỗi thẻ tự hỏi thì mở trang là bắn 24
   * lượt gọi Graph API cho những video người dùng còn chưa buồn bấm tới.
   *
   * `ids` dạng `facebook:123,facebook:456`.
   */
  @Get('owned/paast/status')
  async paastStatus(@Query('ids') ids?: string) {
    const khoas = (ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // Tách ở dấu ':' ĐẦU TIÊN thôi — post_id của Facebook có dạng `<page>_<post>` và
        // không chứa ':', nhưng cắt bằng split(':') thì nền tảng khác sau này sẽ vỡ.
        const i = s.indexOf(':');
        return { platform: s.slice(0, i), post_id: s.slice(i + 1) };
      })
      .filter((k) => k.platform && k.post_id);
    return this.scriptService.statusMany(khoas);
  }

  /** Lấy kịch bản + chấm điểm PAAST một video. Có thể tốn một lượt LLM — chỉ gọi khi người dùng bấm. */
  @Post('owned/paast')
  async paastVideo(@Request() req: any, @Body() body: { platform: string; post_id: string }) {
    return this.scriptService.scoreVideo(
      (body?.platform || '').trim(),
      (body?.post_id || '').trim(),
      req.user.id,
    );
  }
}

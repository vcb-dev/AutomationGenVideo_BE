import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SapoIntegrationService } from './sapo-integration.service';
import { vietnamDateString } from '../../utils/date.utils';

@ApiTags('sapo-integration')
@Controller('sapo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SapoIntegrationController {
  constructor(private readonly sapoService: SapoIntegrationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Kiểm tra trạng thái kết nối và cấu hình Sapo API' })
  getStatus() {
    return {
      isConfigured: this.sapoService.isConfigured(),
      message: this.sapoService.isConfigured()
        ? 'Sapo API đã được cấu hình sẵn sàng.'
        : 'Chưa cấu hình SAPO_STORE_ALIAS hoặc SAPO_ACCESS_TOKEN.',
    };
  }

  @Get('revenue-preview')
  @ApiOperation({
    summary:
      'Lấy số liệu doanh thu từ Sapo theo ngày để tự động điền vào form báo cáo doanh thu',
  })
  @ApiQuery({ name: 'date', required: false, description: 'Ngày dạng YYYY-MM-DD (mặc định là hôm qua theo giờ VN)' })
  @ApiQuery({ name: 'team', required: false, description: 'Lọc theo tên Team nếu có tag' })
  async getRevenuePreview(
    @Query('date') dateQuery?: string,
    @Query('team') teamQuery?: string,
    @Request() req?: any,
  ) {
    // Mặc định là ngày hôm qua theo giờ VN (do form báo cáo sáng nay là báo cáo cho hôm qua)
    let targetDate = dateQuery;
    if (!targetDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = vietnamDateString(yesterday);
    }

    const team = teamQuery || req?.user?.team;
    const email = req?.user?.email;

    return this.sapoService.getDailyRevenuePreview(targetDate, team, email);
  }

  @Post('sync-revenue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đồng bộ doanh thu Sapo của ngày chỉ định vào DB' })
  async syncRevenue(
    @Body() body: { date?: string; team?: string },
    @Request() req?: any,
  ) {
    let targetDate = body.date;
    if (!targetDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = vietnamDateString(yesterday);
    }

    const team = body.team || req?.user?.team || 'Sapo Sync';
    const email = req?.user?.email || 'system@sapo.vn';
    const name = req?.user?.full_name || 'Sapo Admin Sync';

    return this.sapoService.syncDailyRevenueToDatabase(targetDate, team, email, name);
  }

  /**
   * CHỈ ADMIN. Endpoint này trả về kênh TikTok trích từ đơn hàng của TOÀN CÔNG TY, không phải
   * kênh của riêng người gọi — mở cho mọi người là lộ danh sách kênh của người khác, và ai nhập
   * cũng thành chủ sở hữu những kênh đó (syncTiktokChannels gán owner_id = người gọi).
   * Nhân sự thường tự thêm kênh của mình qua modal "Thêm thủ công".
   */
  @Get('tiktok-channels')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Quét và trích xuất danh sách kênh TikTok từ các đơn hàng Sapo gần đây (chỉ Admin)',
  })
  async getTiktokChannels() {
    return this.sapoService.discoverTiktokChannels(250);
  }

  /**
   * KHÔNG siết role: đây cũng là đường mà nhân sự thường dùng để tự thêm kênh TikTok của mình
   * (modal "Thêm thủ công" gửi đúng một kênh vào đây). Kênh tạo ra luôn thuộc về người gọi.
   */
  @Post('sync-tiktok-channels')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Thêm kênh TikTok vào danh mục kênh của hệ thống (kênh thuộc về người gọi)',
  })
  async syncTiktokChannels(
    @Body()
    body: {
      channels: Array<{
        name: string;
        channelId?: string;
        link_channel?: string | null;
        username?: string | null;
        type?: string;
        source?: string;
      }>;
    },
    @Request() req: any,
  ) {
    return this.sapoService.syncTiktokChannels(body.channels || [], req.user);
  }

  @Get('orders-count')
  @ApiOperation({ summary: 'Lấy tổng số đơn hàng Sapo theo ngày hoặc khoảng ngày' })
  @ApiQuery({ name: 'date_from', required: false })
  @ApiQuery({ name: 'date_to', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'team', required: false })
  async getOrdersCount(
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('team') team?: string,
  ) {
    const from = dateFrom || startDate || '';
    const to = dateTo || endDate || from;
    return this.sapoService.getOrderStats(from, to, team);
  }
}

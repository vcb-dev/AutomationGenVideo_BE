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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
}

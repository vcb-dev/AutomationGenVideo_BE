import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { SapoRevenueService } from './sapo-revenue.service';

@ApiTags('sapo-revenue')
@Controller('sapo')
@SkipThrottle({ long: true, short: true })
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@ApiBearerAuth()
export class SapoRevenueController {
  constructor(private readonly sapoRevenueService: SapoRevenueService) {}

  @Get('revenue')
  @ApiOperation({
    summary: 'Lấy doanh thu thực tế từ Sapo cho 1 kênh/Fanpage theo ngày hoặc tháng',
  })
  @ApiQuery({ name: 'channelName', required: true, description: 'Tên kênh hoặc Page' })
  @ApiQuery({ name: 'pageId', required: false, description: 'Facebook Page ID từ tài khoản kết nối OAuth' })
  @ApiQuery({ name: 'platform', required: false, description: 'fb, tiktok, shopee, zalo, web...' })
  @ApiQuery({ name: 'date', required: false, description: 'Ngày YYYY-MM-DD' })
  @ApiQuery({ name: 'mode', required: false, enum: ['day', 'month'], description: 'Chế độ ngày hoặc tháng' })
  async getRevenue(
    @Query('channelName') channelName: string,
    @Query('pageId') pageId?: string,
    @Query('platform') platform?: string,
    @Query('date') date?: string,
    @Query('mode') mode: 'day' | 'month' = 'day',
  ) {
    return this.sapoRevenueService.getChannelRevenue({
      channelName,
      pageId,
      platform,
      date,
      mode,
    });
  }

  @Get('all-pages')
  @ApiOperation({
    summary: 'Lấy danh sách tất cả các Facebook Page / Kênh và doanh thu tương ứng trong ngày hoặc tháng',
  })
  @ApiQuery({ name: 'date', required: false, description: 'Ngày YYYY-MM-DD' })
  @ApiQuery({ name: 'mode', required: false, enum: ['day', 'month'] })
  async getAllPages(
    @Query('date') date?: string,
    @Query('mode') mode: 'day' | 'month' = 'day',
  ) {
    return this.sapoRevenueService.getAllPagesRevenue(date, mode);
  }
}

import { Controller, Get, Post, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TelegramReportService } from './telegram-report.service';

@ApiTags('Telegram Report')
@Controller('telegram-report')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TelegramReportController {
  constructor(private readonly svc: TelegramReportService) {}

  @Get('config')
  getConfig(@Req() req: any) {
    return this.svc.getConfig(req.user.id);
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  saveConfig(@Req() req: any, @Body() body: {
    bot_token: string;
    chat_id: string;
    schedule: string;
    formats: string[];
    report_types: string[];
    is_active: boolean;
  }) {
    return this.svc.saveConfig(req.user.id, body);
  }

  @Post('send-now')
  @HttpCode(HttpStatus.OK)
  sendNow(@Req() req: any) {
    return this.svc.sendTestReport(req.user.id);
  }
}

import { Controller, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WeeklyReportService } from './weekly-report.service';

/**
 * Chạy tay báo cáo tuần.
 *
 * `run-thu` tồn tại để nghiệm thu: dựng tin trên dữ liệu THẬT rồi trả về đọc, mà không nhắn
 * ai. Không có nó thì cách duy nhất để biết tin trông thế nào là bắn thật vào mặt người nhận.
 */
@UseGuards(JwtAuthGuard)
@Controller('bao-cao-tuan')
export class WeeklyReportController {
  constructor(private readonly service: WeeklyReportService) {}

  /** Dựng tin và trả về, KHÔNG gửi, KHÔNG ghi nhật ký. */
  @Post('run-thu')
  async runTest() {
    return this.service.run(true);
  }

  /** Gửi thật ngay, không đợi cron. Có ghi nhật ký nên bấm hai lần cũng không gửi trùng. */
  @Post('send-ngay')
  async sendNow() {
    return this.service.run(false);
  }
}

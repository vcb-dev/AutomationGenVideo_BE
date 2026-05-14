import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as TelegramBot from 'node-telegram-bot-api';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType,
} from 'docx';
import { PrismaService } from '../../common/prisma/prisma.service';

const serializeBigInt = (_: string, v: any) => (typeof v === 'bigint' ? v.toString() : v);

@Injectable()
export class TelegramReportService {
  private readonly logger = new Logger(TelegramReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Config CRUD ──────────────────────────────────────────────────────────

  async getConfig(userId: string) {
    return this.prisma.telegramReportConfig.findUnique({ where: { user_id: userId } });
  }

  async saveConfig(userId: string, dto: {
    bot_token: string;
    chat_id: string;
    schedule: string;
    formats: string[];
    report_types: string[];
    is_active: boolean;
  }) {
    return this.prisma.telegramReportConfig.upsert({
      where: { user_id: userId },
      update: { ...dto, updated_at: new Date() },
      create: { user_id: userId, ...dto },
    });
  }

  // ── Send test report ──────────────────────────────────────────────────────

  async sendTestReport(userId: string): Promise<{ ok: boolean; message: string }> {
    const config = await this.getConfig(userId);
    if (!config) return { ok: false, message: 'Chưa có cấu hình Telegram' };
    if (!config.bot_token || !config.chat_id) return { ok: false, message: 'Bot token hoặc Chat ID trống' };

    try {
      await this.sendReports(config);
      return { ok: true, message: 'Đã gửi báo cáo test thành công!' };
    } catch (e) {
      return { ok: false, message: `Lỗi: ${e.message}` };
    }
  }

  // ── Cron: chạy mỗi phút, kiểm tra xem config nào đến giờ gửi ─────────────

  @Cron('0 * * * * *', { timeZone: 'Asia/Ho_Chi_Minh' }) // Mỗi phút check, giờ VN
  async handleScheduledReports() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const configs = await this.prisma.telegramReportConfig.findMany({
      where: { is_active: true },
    });

    for (const config of configs) {
      try {
        // Parse cron: "0 8 * * *" → giờ 8, phút 0
        const parts = config.schedule.split(' ');
        const schedMinute = parseInt(parts[0]);
        const schedHour   = parseInt(parts[1]);
        if (currentHour === schedHour && currentMinute === schedMinute) {
          this.logger.log(`[Telegram] Gửi báo cáo cho user ${config.user_id}`);
          await this.sendReports(config);
        }
      } catch (e) {
        this.logger.error(`[Telegram] Lỗi gửi cho ${config.user_id}: ${e.message}`);
      }
    }
  }

  // ── Core: tạo + gửi báo cáo ──────────────────────────────────────────────

  private async sendReports(config: any) {
    const bot = new TelegramBot(config.bot_token, { polling: false });
    const chatId = config.chat_id;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const types: string[] = config.report_types ?? ['ads', 'traffic'];
    const formats: string[] = config.formats ?? ['text'];

    // Lấy dữ liệu
    const [adsData, trafficData] = await Promise.all([
      types.includes('ads') ? this.getAdsData(year, month) : [],
      types.includes('traffic') ? this.getTrafficData(year, month) : [],
    ]);

    // 1. Luôn gửi text summary trước
    const text = this.buildTextReport(adsData, trafficData, year, month);
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });

    // 2. Gửi file theo format
    for (const fmt of formats) {
      if (fmt === 'text') continue;
      try {
        if (fmt === 'csv')  await this.sendCsv(bot, chatId, adsData, trafficData, year, month);
        if (fmt === 'xlsx') await this.sendXlsx(bot, chatId, adsData, trafficData, year, month);
        if (fmt === 'pdf')  await this.sendPdf(bot, chatId, adsData, trafficData, year, month);
        if (fmt === 'docx') await this.sendDocx(bot, chatId, adsData, trafficData, year, month);
      } catch (e) {
        this.logger.warn(`[Telegram] Không gửi được ${fmt}: ${e.message}`);
      }
    }
  }

  // ── Lấy data ─────────────────────────────────────────────────────────────

  private async getAdsData(year: number, month: number): Promise<any[]> {
    return this.prisma.$queryRawUnsafe(`
      SELECT platform, team, SUM(spend) as spend, SUM(mess_count) as mess,
             SUM(impressions) as impressions, SUM(clicks) as clicks
      FROM ads_campaign_stats
      WHERE year=${year} AND month=${month}
      GROUP BY platform, team ORDER BY spend DESC
    `) as any;
  }

  private async getTrafficData(year: number, month: number): Promise<any[]> {
    return this.prisma.$queryRawUnsafe(`
      SELECT platform, team, SUM(views) as views, MAX(followers) as followers,
             SUM(likes) as likes, COUNT(DISTINCT channel_name) as channels
      FROM social_video_report
      WHERE year=${year} AND month=${month}
      GROUP BY platform, team ORDER BY views DESC
    `) as any;
  }

  // ── Tạo text report ───────────────────────────────────────────────────────

  private buildTextReport(ads: any[], traffic: any[], year: number, month: number): string {
    const s = (_: string, v: any) => typeof v === 'bigint' ? Number(v) : v;
    const fmt = (n: any) => {
      const num = typeof n === 'bigint' ? Number(n) : Number(n || 0);
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
      return num.toLocaleString('vi-VN');
    };

    let msg = `📊 <b>BÁO CÁO THÁNG ${month}/${year}</b>\n`;
    msg += `⏰ Gửi lúc ${new Date().toLocaleString('vi-VN')}\n`;
    msg += `${'─'.repeat(30)}\n\n`;

    if (ads.length > 0) {
      const totalSpend = ads.reduce((a, r) => a + Number(r.spend || 0), 0);
      const totalMess  = ads.reduce((a, r) => a + Number(r.mess || 0), 0);
      msg += `💰 <b>QUẢNG CÁO</b>\n`;
      msg += `• Tổng chi phí: <b>${fmt(totalSpend)} VNĐ</b>\n`;
      msg += `• Tổng tin nhắn: <b>${fmt(totalMess)}</b>\n`;
      if (totalMess > 0) msg += `• CPMess TB: <b>${fmt(Math.round(totalSpend / totalMess))} VNĐ</b>\n`;
      msg += `\n<i>Chi tiết theo team:</i>\n`;
      for (const row of ads.slice(0, 8)) {
        const team = row.team || 'Không rõ';
        msg += `  ${row.platform === 'meta' ? '📘' : '🎵'} ${team}: ${fmt(row.spend)}đ | ${fmt(row.mess)} mess\n`;
      }
      msg += '\n';
    }

    if (traffic.length > 0) {
      const totalViews = traffic.reduce((a, r) => a + Number(r.views || 0), 0);
      const totalChannels = traffic.reduce((a, r) => a + Number(r.channels || 0), 0);
      msg += `📱 <b>TRAFFIC TỰ NHIÊN</b>\n`;
      msg += `• Tổng lượt xem: <b>${fmt(totalViews)}</b>\n`;
      msg += `• Số kênh hoạt động: <b>${totalChannels}</b>\n`;
      msg += `\n<i>Chi tiết theo team:</i>\n`;
      for (const row of traffic.slice(0, 6)) {
        const team = row.team || 'Không rõ';
        msg += `  ${row.platform === 'facebook' ? '📘' : '📷'} ${team}: ${fmt(row.views)} views | ${fmt(row.followers)} followers\n`;
      }
      msg += '\n';
    }

    msg += `${'─'.repeat(30)}\n`;
    msg += `🤖 VCB Studio AI — Báo cáo tự động`;
    return msg;
  }

  // ── CSV ───────────────────────────────────────────────────────────────────

  private async sendCsv(bot: TelegramBot, chatId: string, ads: any[], traffic: any[], year: number, month: number) {
    const fmt = (v: any) => typeof v === 'bigint' ? Number(v) : (v ?? '');

    let csv = 'Loại,Platform,Team,Chi phí/Views,Mess/Followers,Impressions/Likes\n';
    for (const r of ads) {
      csv += `Ads,${r.platform},${r.team || ''},${fmt(r.spend)},${fmt(r.mess)},${fmt(r.impressions)}\n`;
    }
    for (const r of traffic) {
      csv += `Traffic,${r.platform},${r.team || ''},${fmt(r.views)},${fmt(r.followers)},${fmt(r.likes)}\n`;
    }

    const buf = Buffer.from('﻿' + csv, 'utf-8');
    await bot.sendDocument(chatId, buf, {
      caption: `📊 Báo cáo tháng ${month}/${year}`,
    }, {
      filename: `bao-cao-${month}-${year}.csv`,
      contentType: 'text/csv',
    });
  }

  // ── XLSX ──────────────────────────────────────────────────────────────────

  private async sendXlsx(bot: TelegramBot, chatId: string, ads: any[], traffic: any[], year: number, month: number) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VCB Studio AI';

    const fmt = (v: any) => typeof v === 'bigint' ? Number(v) : (Number(v) || 0);

    // Sheet Ads
    if (ads.length > 0) {
      const ws = wb.addWorksheet('Quảng cáo');
      ws.columns = [
        { header: 'Platform', key: 'platform', width: 12 },
        { header: 'Team', key: 'team', width: 18 },
        { header: 'Chi phí (VNĐ)', key: 'spend', width: 16 },
        { header: 'Tin nhắn', key: 'mess', width: 12 },
        { header: 'Hiển thị', key: 'impressions', width: 14 },
        { header: 'Click', key: 'clicks', width: 10 },
        { header: 'CPMess', key: 'cpmess', width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      for (const r of ads) {
        const spend = fmt(r.spend);
        const mess  = fmt(r.mess);
        ws.addRow({
          platform: r.platform, team: r.team || 'Không rõ',
          spend, mess, impressions: fmt(r.impressions), clicks: fmt(r.clicks),
          cpmess: mess > 0 ? Math.round(spend / mess) : 0,
        });
      }

      // Tổng
      const lastRow = ads.length + 2;
      ws.addRow({
        platform: 'TỔNG', team: '',
        spend: ads.reduce((a, r) => a + fmt(r.spend), 0),
        mess:  ads.reduce((a, r) => a + fmt(r.mess), 0),
        impressions: ads.reduce((a, r) => a + fmt(r.impressions), 0),
        clicks: ads.reduce((a, r) => a + fmt(r.clicks), 0),
      });
      ws.getRow(lastRow).font = { bold: true };
    }

    // Sheet Traffic
    if (traffic.length > 0) {
      const ws = wb.addWorksheet('Traffic tự nhiên');
      ws.columns = [
        { header: 'Platform', key: 'platform', width: 12 },
        { header: 'Team', key: 'team', width: 18 },
        { header: 'Lượt xem', key: 'views', width: 14 },
        { header: 'Followers', key: 'followers', width: 14 },
        { header: 'Likes', key: 'likes', width: 10 },
        { header: 'Số kênh', key: 'channels', width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } };
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      for (const r of traffic) {
        ws.addRow({
          platform: r.platform, team: r.team || 'Không rõ',
          views: fmt(r.views), followers: fmt(r.followers),
          likes: fmt(r.likes), channels: fmt(r.channels),
        });
      }
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await bot.sendDocument(chatId, buf, {
      caption: `📊 Báo cáo tháng ${month}/${year}`,
    }, {
      filename: `bao-cao-${month}-${year}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ── PDF ───────────────────────────────────────────────────────────────────

  private async sendPdf(bot: TelegramBot, chatId: string, ads: any[], traffic: any[], year: number, month: number) {
    const n = (v: any) => typeof v === 'bigint' ? Number(v) : (Number(v) || 0);
    const fmt = (v: any) => {
      const num = n(v);
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
      return num.toLocaleString('vi-VN');
    };

    // Tìm font hỗ trợ tiếng Việt (dùng font hệ thống)
    const fontCandidates = [
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ];
    const fontPath = fontCandidates.find(f => fs.existsSync(f));

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const endPromise = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    if (fontPath) doc.registerFont('VN', fontPath);
    const useFont = fontPath ? 'VN' : 'Helvetica';
    const useFontBold = fontPath ? 'VN' : 'Helvetica-Bold';

    // ── Header ──
    doc.rect(0, 0, doc.page.width, 70).fill('#7C3AED');
    doc.fillColor('white').font(useFontBold).fontSize(18)
      .text(`BAO CAO THANG ${month}/${year}`, 40, 20, { align: 'center' });
    doc.fontSize(9).font(useFont)
      .text(`VCB Studio AI  |  ${new Date().toLocaleString('vi-VN')}`, 40, 46, { align: 'center' });

    doc.fillColor('#1f2937').moveDown(2);

    // ── Ads section ──
    if (ads.length > 0) {
      const totalSpend = ads.reduce((a, r) => a + n(r.spend), 0);
      const totalMess  = ads.reduce((a, r) => a + n(r.mess), 0);

      doc.font(useFontBold).fontSize(12).fillColor('#7C3AED')
        .text('QUANG CAO', 40, doc.y + 10);
      doc.font(useFont).fontSize(9).fillColor('#374151');

      // KPI row
      const kpiY = doc.y + 6;
      const kpiW = (doc.page.width - 80) / 3;
      [
        { label: 'Tong chi phi', value: `${fmt(totalSpend)} VND` },
        { label: 'Tin nhan', value: fmt(totalMess) },
        { label: 'CPMess TB', value: totalMess > 0 ? `${fmt(Math.round(totalSpend / totalMess))} VND` : '-' },
      ].forEach(({ label, value }, i) => {
        const x = 40 + i * kpiW;
        doc.rect(x, kpiY, kpiW - 8, 46).fill('#f5f3ff').stroke('#ddd6fe');
        doc.fillColor('#6d28d9').font(useFontBold).fontSize(14)
          .text(value, x + 6, kpiY + 6, { width: kpiW - 20, align: 'center' });
        doc.fillColor('#6b7280').font(useFont).fontSize(7)
          .text(label, x + 6, kpiY + 28, { width: kpiW - 20, align: 'center' });
      });

      doc.y = kpiY + 56;

      // Table header
      const cols = [160, 100, 100, 80, 80];
      const headers = ['Team', 'Chi phi (VND)', 'Tin nhan', 'Hien thi', 'Platform'];
      const tX = 40; let tY = doc.y + 6;

      doc.rect(tX, tY, cols.reduce((a, c) => a + c, 0), 18).fill('#7C3AED');
      doc.fillColor('white').font(useFontBold).fontSize(8);
      let cx = tX;
      headers.forEach((h, i) => {
        doc.text(h, cx + 4, tY + 4, { width: cols[i] - 8 });
        cx += cols[i];
      });
      tY += 18;

      ads.forEach((row, idx) => {
        doc.rect(tX, tY, cols.reduce((a, c) => a + c, 0), 16)
          .fill(idx % 2 === 0 ? '#faf5ff' : 'white');
        doc.fillColor('#374151').font(useFont).fontSize(8);
        const cells = [row.team || 'N/A', fmt(row.spend), fmt(row.mess), fmt(row.impressions), row.platform];
        cx = tX;
        cells.forEach((cell, i) => {
          doc.text(String(cell), cx + 4, tY + 3, { width: cols[i] - 8 });
          cx += cols[i];
        });
        tY += 16;
      });
      doc.y = tY + 8;
    }

    // ── Traffic section ──
    if (traffic.length > 0) {
      if (doc.y > doc.page.height - 150) doc.addPage();

      const totalViews = traffic.reduce((a, r) => a + n(r.views), 0);
      doc.font(useFontBold).fontSize(12).fillColor('#0EA5E9')
        .text('TRAFFIC TU NHIEN', 40, doc.y + 10);

      const kpiY = doc.y + 6;
      const kpiW = (doc.page.width - 80) / 2;
      [
        { label: 'Tong luot xem', value: fmt(totalViews) },
        { label: 'So kenh', value: String(traffic.reduce((a, r) => a + n(r.channels), 0)) },
      ].forEach(({ label, value }, i) => {
        const x = 40 + i * kpiW;
        doc.rect(x, kpiY, kpiW - 8, 46).fill('#f0f9ff').stroke('#bae6fd');
        doc.fillColor('#0284c7').font(useFontBold).fontSize(14)
          .text(value, x + 6, kpiY + 6, { width: kpiW - 20, align: 'center' });
        doc.fillColor('#6b7280').font(useFont).fontSize(7)
          .text(label, x + 6, kpiY + 28, { width: kpiW - 20, align: 'center' });
      });

      doc.y = kpiY + 56;
      const cols = [160, 110, 110, 80, 80];
      const headers = ['Team', 'Luot xem', 'Followers', 'Likes', 'Platform'];
      const tX = 40; let tY = doc.y + 6;

      doc.rect(tX, tY, cols.reduce((a, c) => a + c, 0), 18).fill('#0EA5E9');
      doc.fillColor('white').font(useFontBold).fontSize(8);
      let cx = tX;
      headers.forEach((h, i) => { doc.text(h, cx + 4, tY + 4, { width: cols[i] - 8 }); cx += cols[i]; });
      tY += 18;

      traffic.forEach((row, idx) => {
        doc.rect(tX, tY, cols.reduce((a, c) => a + c, 0), 16).fill(idx % 2 === 0 ? '#f0f9ff' : 'white');
        doc.fillColor('#374151').font(useFont).fontSize(8);
        const cells = [row.team || 'N/A', fmt(row.views), fmt(row.followers), fmt(row.likes), row.platform];
        cx = tX;
        cells.forEach((cell, i) => { doc.text(String(cell), cx + 4, tY + 3, { width: cols[i] - 8 }); cx += cols[i]; });
        tY += 16;
      });
    }

    // ── Footer ──
    doc.fillColor('#9ca3af').font(useFont).fontSize(7)
      .text('VCB Studio AI - Bao cao tu dong', 40, doc.page.height - 30, { align: 'center' });

    doc.end();
    const buf = await endPromise;

    await bot.sendDocument(chatId, buf, {
      caption: `📊 Báo cáo PDF tháng ${month}/${year}`,
    }, {
      filename: `bao-cao-${month}-${year}.pdf`,
      contentType: 'application/pdf',
    });
  }

  // ── DOCX ──────────────────────────────────────────────────────────────────

  private async sendDocx(bot: TelegramBot, chatId: string, ads: any[], traffic: any[], year: number, month: number) {
    const n = (v: any) => typeof v === 'bigint' ? Number(v) : (Number(v) || 0);
    const fmt = (v: any) => {
      const num = n(v);
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
      return num.toLocaleString('vi-VN');
    };

    const cellStyle = (text: string, bold = false, bg?: string) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, bold, size: 18 })],
        alignment: AlignmentType.CENTER,
      })],
      shading: bg ? { type: ShadingType.SOLID, color: bg } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
    });

    const sections: any[] = [];

    // Title
    sections.push(
      new Paragraph({
        text: `BAO CAO THANG ${month}/${year}`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `VCB Studio AI  |  ${new Date().toLocaleString('vi-VN')}`, color: '888888', size: 18 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
    );

    // Ads section
    if (ads.length > 0) {
      const totalSpend = ads.reduce((a, r) => a + n(r.spend), 0);
      const totalMess  = ads.reduce((a, r) => a + n(r.mess), 0);

      sections.push(
        new Paragraph({ text: 'QUANG CAO', heading: HeadingLevel.HEADING_2, spacing: { after: 120 } }),
        new Paragraph({
          children: [
            new TextRun({ text: `Tong chi phi: ${fmt(totalSpend)} VND  |  `, bold: true }),
            new TextRun({ text: `Tin nhan: ${fmt(totalMess)}  |  ` }),
            new TextRun({ text: `CPMess TB: ${totalMess > 0 ? fmt(Math.round(totalSpend / totalMess)) + ' VND' : '-'}` }),
          ],
          spacing: { after: 200 },
        }),
      );

      const adsTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['Team', 'Chi phi (VND)', 'Tin nhan', 'Hien thi', 'Platform']
              .map(h => cellStyle(h, true, '7C3AED')),
            tableHeader: true,
          }),
          ...ads.map((row, i) => new TableRow({
            children: [
              cellStyle(row.team || 'N/A', false, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF'),
              cellStyle(fmt(row.spend), false, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF'),
              cellStyle(fmt(row.mess), false, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF'),
              cellStyle(fmt(row.impressions), false, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF'),
              cellStyle(row.platform, false, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF'),
            ],
          })),
        ],
      });
      sections.push(adsTable, new Paragraph({ text: '', spacing: { after: 300 } }));
    }

    // Traffic section
    if (traffic.length > 0) {
      const totalViews = traffic.reduce((a, r) => a + n(r.views), 0);

      sections.push(
        new Paragraph({ text: 'TRAFFIC TU NHIEN', heading: HeadingLevel.HEADING_2, spacing: { after: 120 } }),
        new Paragraph({
          children: [
            new TextRun({ text: `Tong luot xem: ${fmt(totalViews)}  |  `, bold: true }),
            new TextRun({ text: `So kenh: ${traffic.reduce((a, r) => a + n(r.channels), 0)}` }),
          ],
          spacing: { after: 200 },
        }),
      );

      const trafficTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['Team', 'Luot xem', 'Followers', 'Likes', 'Platform']
              .map(h => cellStyle(h, true, '0EA5E9')),
            tableHeader: true,
          }),
          ...traffic.map((row, i) => new TableRow({
            children: [
              cellStyle(row.team || 'N/A', false, i % 2 === 0 ? 'F0F9FF' : 'FFFFFF'),
              cellStyle(fmt(row.views), false, i % 2 === 0 ? 'F0F9FF' : 'FFFFFF'),
              cellStyle(fmt(row.followers), false, i % 2 === 0 ? 'F0F9FF' : 'FFFFFF'),
              cellStyle(fmt(row.likes), false, i % 2 === 0 ? 'F0F9FF' : 'FFFFFF'),
              cellStyle(row.platform, false, i % 2 === 0 ? 'F0F9FF' : 'FFFFFF'),
            ],
          })),
        ],
      });
      sections.push(trafficTable);
    }

    const docFile = new Document({
      sections: [{ children: sections }],
      styles: {
        default: {
          heading1: { run: { size: 32, bold: true, color: '7C3AED' } },
          heading2: { run: { size: 24, bold: true, color: '1f2937' } },
        },
      },
    });

    const buf = await Packer.toBuffer(docFile);
    await bot.sendDocument(chatId, buf, {
      caption: `📊 Báo cáo DOCX tháng ${month}/${year}`,
    }, {
      filename: `bao-cao-${month}-${year}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as TelegramBot from 'node-telegram-bot-api';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, ShadingType,
} from 'docx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PdfReportGenerator, ReportData } from './pdf-report.generator';

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class TelegramReportService {
  private readonly logger = new Logger(TelegramReportService.name);

  private static readonly GLOBAL_KEYWORDS = ['global', 'thái lan', 'thai lan', 'indo', 'japan', 'jp'];
  private static readonly BM = { mess: { great: 18000, good: 25000, avg: 40000 } };

  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async getConfig(userId: string) {
    return this.prisma.telegramReportConfig.findUnique({ where: { user_id: userId } });
  }

  async saveConfig(userId: string, dto: any) {
    return this.prisma.telegramReportConfig.upsert({
      where: { user_id: userId },
      update: { ...dto, updated_at: new Date() },
      create: { user_id: userId, ...dto },
    });
  }

  async sendTestReport(userId: string): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.getConfig(userId);
    if (!cfg?.bot_token || !cfg?.chat_id) return { ok: false, message: 'Chưa có cấu hình Telegram' };
    try { await this.sendReports(cfg); return { ok: true, message: 'Đã gửi báo cáo test thành công!' }; }
    catch (e) { return { ok: false, message: `Lỗi: ${e.message}` }; }
  }

  // ── Cron check ────────────────────────────────────────────────────────────

  @Cron('0 * * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleScheduledReports() {
    const now = new Date();
    const configs = await this.prisma.telegramReportConfig.findMany({ where: { is_active: true } });
    for (const cfg of configs) {
      try {
        const [m, h] = (cfg.schedule || '0 8 * * *').split(' ').map(Number);
        if (now.getHours() === h && now.getMinutes() === m) {
          this.logger.log(`[Telegram] Gửi cho user ${cfg.user_id}`);
          await this.sendReports(cfg);
        }
      } catch (e) { this.logger.error(`[Telegram] Lỗi ${cfg.user_id}: ${e.message}`); }
    }
  }

  // ── Core send ─────────────────────────────────────────────────────────────

  private async sendReports(cfg: any) {
    const bot = new TelegramBot(cfg.bot_token, { polling: false });
    const chatId = cfg.chat_id;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const types: string[] = cfg.report_types ?? ['ads', 'traffic'];
    const formats: string[] = cfg.formats ?? ['text'];
    const doAds = types.includes('ads');
    const doTrf = types.includes('traffic');

    const data = await this.collectData(year, month, types);

    // ── Gửi 2 tin nhắn text riêng biệt ──
    if (doAds && data.adsTeam.length > 0) {
      await bot.sendMessage(chatId, this.buildAdsText(data, year, month), { parse_mode: 'HTML' });
    }
    if (doTrf && data.trafficTeam.length > 0) {
      await bot.sendMessage(chatId, this.buildTrafficText(data, year, month), { parse_mode: 'HTML' });
    }

    // ── Gửi file theo format ──
    for (const fmt of formats) {
      if (fmt === 'text') continue;
      try {
        if (fmt === 'csv')  await this.sendCsv(bot, chatId, data, year, month);
        if (fmt === 'xlsx') await this.sendXlsx(bot, chatId, data, year, month);
        if (fmt === 'pdf')  await this.sendPdf(bot, chatId, data, year, month);
        if (fmt === 'docx') await this.sendDocx(bot, chatId, data, year, month);
      } catch (e) {
        this.logger.error(`[Telegram] Lỗi gửi ${fmt}: ${e.message}\n${e.stack?.slice(0,300)}`);
        try {
          await bot.sendMessage(chatId, `⚠️ Không thể gửi file ${fmt.toUpperCase()}: ${e.message}`);
        } catch {}
      }
    }
  }

  // ── Collect all data ──────────────────────────────────────────────────────

  private async collectData(year: number, month: number, types: string[]) {
    const doAds = types.includes('ads');
    const doTrf = types.includes('traffic');
    const [adsCamps, adsTeam, trafficTeam, contentTypes, topSkus, topViews, topCmts] =
      await Promise.all([
        doAds ? this.qAdsCamps(year, month) : Promise.resolve([]),
        doAds ? this.qAdsTeam(year, month)  : Promise.resolve([]),
        doTrf ? this.qTrafficTeam(year, month)  : Promise.resolve([]),
        doTrf ? this.qContentTypes(year, month) : Promise.resolve([]),
        doTrf ? this.qTopSkus(year, month)      : Promise.resolve([]),
        doTrf ? this.qTopViews(year, month)     : Promise.resolve([]),
        doTrf ? this.qTopComments(year, month)  : Promise.resolve([]),
      ]);
    return { adsCamps, adsTeam, trafficTeam, contentTypes, topSkus, topViews, topCmts };
  }

  // ── SQL Queries ───────────────────────────────────────────────────────────

  private q(sql: string) { return this.prisma.$queryRawUnsafe(sql) as Promise<any[]>; }

  private qAdsCamps(y: number, m: number) {
    return this.q(`
      SELECT campaign_name, camp_type, content_type, platform, team, owner,
             SUM(spend) spend, SUM(mess_count) mess, SUM(impressions) impr,
             SUM(clicks) clicks, SUM(like_count) likes, SUM(engagement_count) engage
      FROM ads_campaign_stats WHERE year=${y} AND month=${m}
      GROUP BY campaign_name,camp_type,content_type,platform,team,owner ORDER BY spend DESC`);
  }

  private qAdsTeam(y: number, m: number) {
    return this.q(`
      SELECT platform, team,
             SUM(spend) spend, SUM(mess_count) mess, SUM(impressions) impr,
             SUM(clicks) clicks, SUM(like_count) likes, SUM(engagement_count) engage
      FROM ads_campaign_stats WHERE year=${y} AND month=${m}
      GROUP BY platform,team ORDER BY spend DESC`);
  }

  private qTrafficTeam(y: number, m: number) {
    return this.q(`
      SELECT platform, team,
             SUM(views) views, MAX(followers) followers,
             SUM(likes) likes, SUM(comments) comments, SUM(shares) shares,
             COUNT(*) videos, COUNT(DISTINCT channel_name) channels
      FROM social_video_report WHERE year=${y} AND month=${m}
      GROUP BY platform,team ORDER BY views DESC`);
  }

  private qContentTypes(y: number, m: number) {
    return this.q(`
      SELECT UPPER(tag) ct, platform, team,
             COUNT(*) videos, SUM(views) views, SUM(likes) likes
      FROM social_video_report, unnest(hashtags) tag
      WHERE year=${y} AND month=${m} AND LOWER(tag) IN ('a1','a2','a3','a4','a5')
      GROUP BY UPPER(tag),platform,team ORDER BY ct,views DESC`);
  }

  private qTopSkus(y: number, m: number) {
    return this.q(`
      SELECT UPPER(tag) sku, COUNT(*) videos,
             SUM(views) views, array_agg(DISTINCT team) teams
      FROM social_video_report, unnest(hashtags) tag
      WHERE year=${y} AND month=${m}
        AND UPPER(tag) ~ '^[A-Z]{1,2}[0-9]{5,7}$'
      GROUP BY UPPER(tag) ORDER BY videos DESC, views DESC LIMIT 10`);
  }

  private qTopViews(y: number, m: number) {
    return this.q(`
      SELECT title, channel_name, platform, team, views, likes, comments, hashtags
      FROM social_video_report WHERE year=${y} AND month=${m}
      ORDER BY views DESC LIMIT 10`);
  }

  private qTopComments(y: number, m: number) {
    return this.q(`
      SELECT title, channel_name, platform, team, views, likes, comments, hashtags
      FROM social_video_report WHERE year=${y} AND month=${m}
      ORDER BY comments DESC LIMIT 10`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private n(v: any): number { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

  private f(v: any): string {
    const x = this.n(v);
    if (x >= 1_000_000_000) return `${(x/1e9).toFixed(1)}B`;
    if (x >= 1_000_000)     return `${(x/1e6).toFixed(1)}M`;
    if (x >= 1_000)         return `${(x/1e3).toFixed(1)}K`;
    return x.toLocaleString('vi-VN');
  }

  private isGlobal(team: string): boolean {
    const t = (team || '').toLowerCase();
    return TelegramReportService.GLOBAL_KEYWORDS.some(k => t.includes(k));
  }

  private campType(c: any): string {
    const src = (c.camp_type || c.campaign_name || '').toLowerCase();
    if (src.includes('like page') || src.includes('likepage') || src.includes('like_page')) return 'Like Page';
    if (src.includes('tương tác') || src.includes('engagement')) return 'Tương tác';
    if (src.includes('mess')) return 'Mess';
    return 'Khác';
  }

  private rateLabel(cpm: number, html = false): string {
    const lt = html ? '&lt;' : '<';
    const gt = html ? '&gt;' : '>';
    const b = TelegramReportService.BM.mess;
    if (cpm <= b.great) return `🟢 Xuất sắc (${lt}18K)`;
    if (cpm <= b.good)  return `🟡 Tốt (18–25K)`;
    if (cpm <= b.avg)   return `🟠 TB (25–40K)`;
    return `🔴 Kém (${gt}40K)`;
  }

  // ── Text: Báo cáo Quảng cáo ───────────────────────────────────────────────

  private buildAdsText(d: any, year: number, month: number): string {
    const { adsTeam, adsCamps } = d;
    const ts = adsTeam.reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const tm = adsTeam.reduce((a: number, r: any) => a + this.n(r.mess), 0);
    const tl = adsTeam.reduce((a: number, r: any) => a + this.n(r.likes), 0);
    const vnS = adsTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const glS = adsTeam.filter((r: any) => this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const cpm = tm > 0 ? Math.round(ts / tm) : 0;

    const ctSpend: Record<string, {sp: number; ms: number}> = {};
    for (const c of adsCamps) {
      const ct = this.campType(c);
      if (!ctSpend[ct]) ctSpend[ct] = { sp: 0, ms: 0 };
      ctSpend[ct].sp += this.n(c.spend);
      ctSpend[ct].ms += this.n(c.mess);
    }

    let msg = `💰 <b>BÁO CÁO QUẢNG CÁO — THÁNG ${month}/${year}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('vi-VN')}\n`;
    msg += `${'─'.repeat(32)}\n\n`;

    msg += `<b>📌 TỔNG QUAN</b>\n`;
    msg += `• Tổng chi phí: <b>${this.f(ts)} VNĐ</b>\n`;
    msg += `• 🇻🇳 Vietnam: ${this.f(vnS)} VNĐ\n`;
    msg += `• 🌏 Global: ${this.f(glS)} VNĐ\n`;
    msg += `• Tin nhắn: <b>${this.f(tm)}</b>  |  CPMess: <b>${this.f(cpm)} VNĐ</b>\n`;
    msg += `• Đánh giá: ${this.rateLabel(cpm, true)}\n`;
    msg += `• Like Page: ${this.f(tl)}\n\n`;

    msg += `<b>📊 THEO LOẠI CHIẾN DỊCH</b>\n`;
    for (const [ct, v] of Object.entries(ctSpend)) {
      const cpmCt = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
      msg += `• ${ct}: ${this.f(v.sp)} VNĐ | ${this.f(v.ms)} mess | CPMess ${this.f(cpmCt)}\n`;
    }

    msg += `\n<b>🏆 TOP TEAM</b>\n`;
    for (const r of adsTeam.slice(0, 6)) {
      const mk = this.isGlobal(r.team) ? '🌏' : '🇻🇳';
      const cpmT = this.n(r.mess) > 0 ? Math.round(this.n(r.spend) / this.n(r.mess)) : 0;
      msg += `${mk} ${r.team || 'N/A'}: ${this.f(r.spend)} VNĐ | ${this.f(r.mess)} mess | ${this.f(cpmT)} CPM\n`;
    }

    msg += `\n─────────────────────────────\n🤖 VCB Studio AI`;
    return msg;
  }

  // ── Text: Báo cáo Traffic ─────────────────────────────────────────────────

  private buildTrafficText(d: any, year: number, month: number): string {
    const { trafficTeam, contentTypes, topSkus, topViews } = d;
    const tv = trafficTeam.reduce((a: number, r: any) => a + this.n(r.views), 0);
    const vnV = trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const glV = trafficTeam.filter((r: any) => this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const totalVideos = trafficTeam.reduce((a: number, r: any) => a + this.n(r.videos), 0);

    let msg = `📱 <b>BÁO CÁO TRAFFIC — THÁNG ${month}/${year}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('vi-VN')}\n`;
    msg += `${'─'.repeat(32)}\n\n`;

    msg += `<b>📌 TỔNG QUAN</b>\n`;
    msg += `• Tổng lượt xem: <b>${this.f(tv)}</b>\n`;
    msg += `• 🇻🇳 Vietnam: ${this.f(vnV)}\n`;
    msg += `• 🌏 Global: ${this.f(glV)}\n`;
    msg += `• Tổng video: ${this.f(totalVideos)}\n\n`;

    if (contentTypes.length > 0) {
      const ctSum: Record<string, {v: number; vw: number}> = {};
      for (const r of contentTypes) {
        if (!ctSum[r.ct]) ctSum[r.ct] = { v: 0, vw: 0 };
        ctSum[r.ct].v  += this.n(r.videos);
        ctSum[r.ct].vw += this.n(r.views);
      }
      msg += `<b>🎬 CONTENT THEO LOẠI</b>\n`;
      for (const ct of ['A1','A2','A3','A4','A5']) {
        if (ctSum[ct]) msg += `• ${ct}: ${ctSum[ct].v} video | ${this.f(ctSum[ct].vw)} views\n`;
      }
      msg += '\n';
    }

    msg += `<b>🏆 TOP TEAM</b>\n`;
    for (const r of trafficTeam.slice(0, 5)) {
      const mk = this.isGlobal(r.team) ? '🌏' : '🇻🇳';
      msg += `${mk} ${r.team || 'N/A'} [${r.platform}]: ${this.f(r.views)} views | ${this.f(r.videos)} video\n`;
    }

    if (topViews.length > 0) {
      msg += `\n<b>🔥 TOP 5 VIDEO NHIỀU VIEWS</b>\n`;
      for (const [i, v] of topViews.slice(0, 5).entries()) {
        const title = (v.title || 'No title').slice(0, 35);
        msg += `${i + 1}. ${title}\n   ↳ ${this.f(v.views)} views | ${v.channel_name || ''}\n`;
      }
    }

    if (topSkus.length > 0) {
      msg += `\n<b>📦 TOP SKU NHIỀU VIDEO</b>\n`;
      for (const s of topSkus.slice(0, 5)) {
        msg += `• ${s.sku}: ${this.n(s.videos)} video | ${this.f(s.views)} views\n`;
      }
    }

    msg += `\n─────────────────────────────\n🤖 VCB Studio AI`;
    return msg;
  }

  // ── Legacy compat ─────────────────────────────────────────────────────────
  private buildText(d: any, year: number, month: number): string {
    return this.buildAdsText(d, year, month);
  }

  // ── CSV ───────────────────────────────────────────────────────────────────

  private async sendCsv(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const rows: string[] = ['Loai,Platform,Team,Spend/Views,Mess/Followers,Impr/Likes'];
    for (const r of d.adsTeam)     rows.push(`Ads,${r.platform},${r.team||''},${this.n(r.spend)},${this.n(r.mess)},${this.n(r.impr)}`);
    for (const r of d.trafficTeam) rows.push(`Traffic,${r.platform},${r.team||''},${this.n(r.views)},${this.n(r.followers)},${this.n(r.likes)}`);
    const buf = Buffer.from('﻿' + rows.join('\n'), 'utf-8');
    await bot.sendDocument(chatId, buf, { caption: `📊 CSV tháng ${month}/${year}` }, { filename: `bao-cao-${month}-${year}.csv`, contentType: 'text/csv' });
  }

  // ── XLSX ──────────────────────────────────────────────────────────────────

  private async sendXlsx(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VCB Studio AI';
    const hdStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF7C3AED' } } };
    const hdBlue  = { ...hdStyle, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0EA5E9' } } };
    const addSheet = (name: string, cols: {h:string;w:number}[], rows: any[][], color: 'purple'|'blue') => {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map(c => ({ header: c.h, width: c.w }));
      const st = color === 'purple' ? hdStyle : hdBlue;
      ws.getRow(1).eachCell(cell => Object.assign(cell, st));
      rows.forEach((r, i) => { ws.addRow(r); if (i % 2 === 0) ws.getRow(i+2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color === 'purple' ? 'FFF5F3FF' : 'FFF0F9FF' } } as any; });
    };

    if (d.adsTeam.length > 0) {
      addSheet('Ads theo Team', [{h:'Market',w:10},{h:'Platform',w:10},{h:'Team',w:18},{h:'Chi phí',w:14},{h:'Mess',w:10},{h:'Hiển thị',w:12},{h:'CPMess',w:10}],
        d.adsTeam.map((r: any) => [this.isGlobal(r.team)?'Global':'Vietnam', r.platform, r.team, this.n(r.spend), this.n(r.mess), this.n(r.impr), this.n(r.mess)>0?Math.round(this.n(r.spend)/this.n(r.mess)):0]), 'purple');
    }
    if (d.adsCamps.length > 0) {
      addSheet('Camp Detail', [{h:'Campaign',w:40},{h:'Loại',w:12},{h:'Team',w:16},{h:'Chi phí',w:12},{h:'Mess',w:10}],
        d.adsCamps.map((r: any) => [(r.campaign_name||'').slice(0,50), this.campType(r), r.team, this.n(r.spend), this.n(r.mess)]), 'purple');
    }
    if (d.trafficTeam.length > 0) {
      addSheet('Traffic theo Team', [{h:'Market',w:10},{h:'Platform',w:10},{h:'Team',w:18},{h:'Views',w:12},{h:'Followers',w:12},{h:'Videos',w:8}],
        d.trafficTeam.map((r: any) => [this.isGlobal(r.team)?'Global':'Vietnam', r.platform, r.team, this.n(r.views), this.n(r.followers), this.n(r.videos)]), 'blue');
    }
    if (d.contentTypes.length > 0) {
      addSheet('Content A1-A5', [{h:'Loại',w:8},{h:'Platform',w:10},{h:'Team',w:18},{h:'Videos',w:8},{h:'Views',w:12}],
        d.contentTypes.map((r: any) => [r.ct, r.platform, r.team, this.n(r.videos), this.n(r.views)]), 'blue');
    }
    if (d.topSkus.length > 0) {
      addSheet('Top SKU', [{h:'SKU',w:10},{h:'Số video',w:10},{h:'Tổng views',w:14},{h:'Teams',w:30}],
        d.topSkus.map((r: any) => [r.sku, this.n(r.videos), this.n(r.views), Array.isArray(r.teams)?r.teams.filter(Boolean).join(', '):'']  ), 'blue');
    }
    if (d.topViews.length > 0) {
      addSheet('Top Views', [{h:'Title',w:40},{h:'Kênh',w:20},{h:'Team',w:16},{h:'Views',w:10},{h:'Likes',w:8},{h:'CMT',w:8}],
        d.topViews.map((r: any) => [(r.title||'').slice(0,50), r.channel_name, r.team, this.n(r.views), this.n(r.likes), this.n(r.comments)]), 'blue');
    }
    if (d.topCmts.length > 0) {
      addSheet('Top Comments', [{h:'Title',w:40},{h:'Kênh',w:20},{h:'Team',w:16},{h:'CMT',w:8},{h:'Views',w:10}],
        d.topCmts.map((r: any) => [(r.title||'').slice(0,50), r.channel_name, r.team, this.n(r.comments), this.n(r.views)]), 'blue');
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await bot.sendDocument(chatId, buf, { caption: `📊 XLSX tháng ${month}/${year}` }, { filename: `bao-cao-${month}-${year}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ── PDF (2 files: Ads + Traffic) ────────────────────────────────────────────

  private async sendPdf(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    // Ads PDF
    if (d.adsTeam?.length > 0) {
      const adsData: ReportData = {
        type: 'ads', year, month,
        adsTeam: d.adsTeam, adsCamps: d.adsCamps,
      };
      const adsBuf = await new PdfReportGenerator().generate(adsData);
      await bot.sendDocument(chatId, adsBuf,
        { caption: `📊 Báo cáo Quảng cáo tháng ${month}/${year}` },
        { filename: `ads-${month}-${year}.pdf`, contentType: 'application/pdf' },
      );
    }
    // Traffic PDF
    if (d.trafficTeam?.length > 0) {
      const totalViews  = d.trafficTeam.reduce((a: number, r: any) => a + (typeof r.views==='bigint'?Number(r.views):Number(r.views||0)), 0);
      const vnViews     = d.trafficTeam.filter((r: any) => !['global','thái lan','thai','indo','japan','jp'].some((k:string) => (r.team||'').toLowerCase().includes(k))).reduce((a: number, r: any) => a + (typeof r.views==='bigint'?Number(r.views):Number(r.views||0)), 0);
      const globalViews = totalViews - vnViews;
      const totalVideos = d.trafficTeam.reduce((a: number, r: any) => a + (typeof r.videos==='bigint'?Number(r.videos):Number(r.videos||0)), 0);
      const byPlatform  = await this.prisma.$queryRawUnsafe(`SELECT platform, SUM(views) views, COUNT(*) cnt FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY platform ORDER BY views DESC`) as any[];
      const topChannels = await this.prisma.$queryRawUnsafe(`SELECT channel_name, platform, team, SUM(views) views FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY channel_name,platform,team ORDER BY views DESC LIMIT 10`) as any[];
      const trafData: ReportData = {
        type: 'traffic', year, month,
        totalViews, vnViews, globalViews, totalVideos,
        byPlatform, byTeam: d.trafficTeam, topChannels,
        contentTypes: d.contentTypes, topSkus: d.topSkus,
        topViews: d.topViews, topCmts: d.topCmts,
      };
      const trafBuf = await new PdfReportGenerator().generate(trafData);
      await bot.sendDocument(chatId, trafBuf,
        { caption: `📱 Báo cáo Traffic tháng ${month}/${year}` },
        { filename: `traffic-${month}-${year}.pdf`, contentType: 'application/pdf' },
      );
    }
  }

  // ── DOCX ──────────────────────────────────────────────────────────────────

  private async sendDocx(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const f = this.f.bind(this);
    const n = this.n.bind(this);

    const hCell = (text: string, bg = '7C3AED') => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 16 })], alignment: AlignmentType.CENTER })],
      shading: { type: ShadingType.SOLID, color: bg },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

    const dCell = (text: string, bg = 'FFFFFF') => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 16 })], alignment: AlignmentType.CENTER })],
      shading: bg !== 'FFFFFF' ? { type: ShadingType.SOLID, color: bg } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
    });

    const makeTable = (headers: string[], dataRows: string[][], hColor: string) => new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: headers.map(h => hCell(h, hColor)), tableHeader: true }),
        ...dataRows.map((row, i) => new TableRow({ children: row.map(cell => dCell(cell, i%2===0?'F5F3FF':'FFFFFF')) })),
      ],
    });

    const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } });
    const h2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
    const p  = (text: string) => new Paragraph({ children: [new TextRun({ text, size: 18 })], spacing: { after: 80 } });
    const br = () => new Paragraph({ text: '' });

    const children: any[] = [
      new Paragraph({
        children: [new TextRun({ text: `BAO CAO THANG ${month}/${year}`, bold: true, size: 36, color: '7C3AED' })],
        alignment: AlignmentType.CENTER, spacing: { after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `VCB Studio AI  |  ${new Date().toLocaleString('vi-VN')}`, color: '888888', size: 18 })],
        alignment: AlignmentType.CENTER, spacing: { after: 300 },
      }),
    ];

    // ADS
    if (d.adsTeam.length > 0) {
      const ts = d.adsTeam.reduce((a: number, r: any) => a + n(r.spend), 0);
      const tm = d.adsTeam.reduce((a: number, r: any) => a + n(r.mess), 0);
      const vnS = d.adsTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.spend), 0);
      const glS = d.adsTeam.filter((r: any) => this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.spend), 0);
      const cpm = tm > 0 ? Math.round(ts / tm) : 0;

      children.push(h1('1. QUANG CAO — TONG QUAN'));
      children.push(p(`Tong chi phi: ${f(ts)} VND  |  VN: ${f(vnS)}  |  Global: ${f(glS)}`));
      children.push(p(`Tin nhan: ${f(tm)}  |  CPMess: ${f(cpm)} VND  |  Danh gia: ${this.rateLabel(cpm).replace(/[🟢🟡🟠🔴]/g,'').trim()}`));
      children.push(p(`Benchmark: <18K Xuat sac | 18-25K Tot | 25-40K Trung binh | >40K Kem`));
      children.push(br());

      // Camp type
      const ctSpend: Record<string, {sp:number;ms:number}> = {};
      for (const c of d.adsCamps) {
        const ct = this.campType(c);
        if (!ctSpend[ct]) ctSpend[ct] = {sp:0, ms:0};
        ctSpend[ct].sp += n(c.spend); ctSpend[ct].ms += n(c.mess);
      }
      children.push(h2('1a. Phan tich theo loai camp'));
      children.push(makeTable(['Loai Camp','Chi Phi (VND)','Tin Nhan','CPMess'],
        Object.entries(ctSpend).map(([ct, v]) => [ct, f(v.sp)+' VND', f(v.ms), v.ms>0?f(Math.round(v.sp/v.ms)):'-']),
        '7C3AED'));
      children.push(br());

      children.push(h2('1b. Chi tiet theo thi truong'));
      const mkData: Record<string, {sp:number;ms:number}> = {Vietnam:{sp:0,ms:0}, Global:{sp:0,ms:0}};
      for (const r of d.adsTeam) { const mk=this.isGlobal(r.team)?'Global':'Vietnam'; mkData[mk].sp+=n(r.spend); mkData[mk].ms+=n(r.mess); }
      children.push(makeTable(['Thi Truong','Chi Phi','Mess','CPMess','% Chi Phi'],
        Object.entries(mkData).map(([mk, v]) => [mk, f(v.sp)+' VND', f(v.ms), v.ms>0?f(Math.round(v.sp/v.ms)):'-', ts>0?((v.sp/ts)*100).toFixed(1)+'%':'0%']),
        '6D28D9'));
      children.push(br());

      children.push(h2('1c. Chi tiet theo team'));
      children.push(makeTable(['Market','Platform','Team','Chi Phi','Mess','Hien Thi','CPMess'],
        d.adsTeam.map((r: any) => [this.isGlobal(r.team)?'Global':'VN', r.platform||'', r.team||'', f(r.spend)+' VND', f(r.mess), f(r.impr), n(r.mess)>0?f(Math.round(n(r.spend)/n(r.mess))):'-']),
        '5B21B6'));
      children.push(br());
    }

    // TRAFFIC
    if (d.trafficTeam.length > 0) {
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + n(r.views), 0);
      const vnV = d.trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.views), 0);
      const glV = d.trafficTeam.filter((r: any) => this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.views), 0);

      children.push(h1('2. TRAFFIC TU NHIEN'));
      children.push(p(`Tong views: ${f(tv)}  |  VN: ${f(vnV)}  |  Global: ${f(glV)}`));
      children.push(p(`Tong video: ${f(d.trafficTeam.reduce((a: number, r: any) => a + n(r.videos), 0))}  |  So kenh: ${f(d.trafficTeam.reduce((a: number, r: any) => a + n(r.channels), 0))}`));
      children.push(br());

      children.push(h2('2a. Chi tiet theo team & platform'));
      children.push(makeTable(['Market','Platform','Team','Views','Followers','Videos','Likes'],
        d.trafficTeam.map((r: any) => [this.isGlobal(r.team)?'Global':'VN', r.platform||'', r.team||'', f(r.views), f(r.followers), f(r.videos), f(r.likes)]),
        '0EA5E9'));
      children.push(br());

      if (d.contentTypes.length > 0) {
        children.push(h2('2b. Content A1–A5'));
        const ctSum: Record<string, {v:number;vw:number}> = {};
        for (const r of d.contentTypes) { if (!ctSum[r.ct]) ctSum[r.ct]={v:0,vw:0}; ctSum[r.ct].v+=n(r.videos); ctSum[r.ct].vw+=n(r.views); }
        children.push(p('Tong hop: ' + Object.entries(ctSum).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}: ${v.v} video / ${f(v.vw)} views`).join('  |  ')));
        children.push(makeTable(['Content','Platform','Team','Videos','Views'],
          d.contentTypes.map((r: any) => [r.ct, r.platform, r.team, String(n(r.videos)), f(r.views)]),
          '0284C7'));
        children.push(br());
      }

      if (d.topSkus.length > 0) {
        children.push(h2('2c. Top 10 SKU nhieu video nhat'));
        children.push(makeTable(['SKU','So Video','Tong Views','Teams'],
          d.topSkus.map((r: any) => [r.sku, String(n(r.videos)), f(r.views), Array.isArray(r.teams)?r.teams.filter(Boolean).slice(0,3).join(', '):'']),
          '0369A1'));
        children.push(br());
      }

      if (d.topViews.length > 0) {
        children.push(h2('2d. Top 10 video nhieu views nhat'));
        children.push(makeTable(['#','Title','Kenh','Team','Views','Likes','CMT'],
          d.topViews.map((r: any, i: number) => [String(i+1),(r.title||'').slice(0,40),(r.channel_name||'').slice(0,20),r.team||'',f(r.views),f(r.likes),f(r.comments)]),
          '075985'));
        children.push(br());
      }

      if (d.topCmts.length > 0) {
        children.push(h2('2e. Top 10 video nhieu comment nhat'));
        children.push(makeTable(['#','Title','Kenh','Team','CMT','Views'],
          d.topCmts.map((r: any, i: number) => [String(i+1),(r.title||'').slice(0,40),(r.channel_name||'').slice(0,20),r.team||'',f(r.comments),f(r.views)]),
          '1E3A5F'));
      }
    }

    const doc = new Document({
      sections: [{ children }],
      styles: {
        default: {
          heading1: { run: { size: 28, bold: true, color: '7C3AED' } },
          heading2: { run: { size: 22, bold: true, color: '1F2937' } },
        },
      },
    });

    const buf = await Packer.toBuffer(doc);
    await bot.sendDocument(chatId, buf, { caption: `📝 DOCX tháng ${month}/${year}` }, { filename: `bao-cao-${month}-${year}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
}

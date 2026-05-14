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

  async getConfig(userId: string, userEmail?: string) {
    // Tìm theo user_id trước, fallback theo email nếu user_id đổi
    let cfg = await this.prisma.telegramReportConfig.findUnique({ where: { user_id: userId } });
    if (!cfg && userEmail) {
      cfg = await this.prisma.telegramReportConfig.findFirst({ where: { user_email: userEmail } });
      // Nếu tìm được theo email nhưng user_id khác → update user_id mới
      if (cfg && cfg.user_id !== userId) {
        cfg = await this.prisma.telegramReportConfig.update({
          where: { id: cfg.id },
          data: { user_id: userId },
        });
      }
    }
    return cfg;
  }

  async saveConfig(userId: string, userEmail: string | undefined, dto: any) {
    const existing = await this.getConfig(userId, userEmail);
    if (existing) {
      return this.prisma.telegramReportConfig.update({
        where: { id: existing.id },
        data: { ...dto, user_id: userId, user_email: userEmail, updated_at: new Date() },
      });
    }
    return this.prisma.telegramReportConfig.create({
      data: { user_id: userId, user_email: userEmail, ...dto },
    });
  }

  async sendTestReport(userId: string, userEmail?: string): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.getConfig(userId, userEmail);
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

  // ── Helpers shared ─────────────────────────────────────────────────────────

  private safe(v: any): string {
    if (v === null || v === undefined || v === 'null') return '';
    return String(v);
  }

  private csvEscape(v: any): string {
    const s = this.safe(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // ── PDF (dùng PdfReportGenerator) ────────────────────────────────────────────

  private async sendPdf(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    if ((d.adsTeam || []).length > 0) {
      const adsData: ReportData = { type: 'ads', year, month, adsTeam: d.adsTeam, adsCamps: d.adsCamps };
      const adsBuf = await new PdfReportGenerator().generate(adsData);
      await bot.sendDocument(chatId, adsBuf,
        { caption: `📊 PDF Quảng cáo tháng ${month}/${year}` },
        { filename: `ads-${month}-${year}.pdf`, contentType: 'application/pdf' });
    }
    if ((d.trafficTeam || []).length > 0) {
      const byPlatform = await this.prisma.$queryRawUnsafe(
        `SELECT platform, SUM(views) views, COUNT(*) cnt FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY platform ORDER BY views DESC`
      ) as any[];
      const topChannels = await this.prisma.$queryRawUnsafe(
        `SELECT channel_name, platform, team, SUM(views) views FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY channel_name,platform,team ORDER BY views DESC LIMIT 10`
      ) as any[];
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + this.n(r.views), 0);
      const vnV = d.trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
      const trafData: ReportData = {
        type: 'traffic', year, month,
        totalViews: tv, vnViews: vnV, globalViews: tv - vnV,
        totalVideos: d.trafficTeam.reduce((a: number, r: any) => a + this.n(r.videos), 0),
        byPlatform, byTeam: d.trafficTeam, topChannels,
        contentTypes: d.contentTypes, topSkus: d.topSkus,
        topViews: d.topViews, topCmts: d.topCmts,
      };
      const trafBuf = await new PdfReportGenerator().generate(trafData);
      await bot.sendDocument(chatId, trafBuf,
        { caption: `📱 PDF Traffic tháng ${month}/${year}` },
        { filename: `traffic-${month}-${year}.pdf`, contentType: 'application/pdf' });
    }
  }

  // ── CSV ─── đầy đủ tất cả sections ───────────────────────────────────────────

  private async sendCsv(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const e = this.csvEscape.bind(this);
    const f = this.f.bind(this);
    const n = this.n.bind(this);
    const lines: string[] = [];

    // Section 1: Ads by team
    if ((d.adsTeam || []).length > 0) {
      const ts = d.adsTeam.reduce((a: number, r: any) => a + n(r.spend), 0);
      const tm = d.adsTeam.reduce((a: number, r: any) => a + n(r.mess), 0);
      lines.push(`BAO CAO QUANG CAO - THANG ${month}/${year}`);
      lines.push(`Tong chi phi,${f(ts)} VND,Tong mess,${f(tm)},CPMess TB,${tm > 0 ? f(Math.round(ts / tm)) : '0'} VND`);
      lines.push('');
      lines.push('Market,Platform,Team,Chi phi (VND),Tin nhan,Hien thi,CPMess,Danh gia');
      for (const r of d.adsTeam) {
        const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
        const eval_ = cpm <= 18000 ? 'Xuat sac' : cpm <= 25000 ? 'Tot' : cpm <= 40000 ? 'Trung binh' : 'Can toi uu';
        lines.push([this.isGlobal(r.team) ? 'Global' : 'Viet Nam', e(r.platform), e(r.team || 'N/A'), n(r.spend), n(r.mess), n(r.impr), cpm, eval_].join(','));
      }
      lines.push('');
    }

    // Section 2: Ads by camp type
    if ((d.adsCamps || []).length > 0) {
      const campMap: Record<string, { sp: number; ms: number }> = {};
      for (const c of d.adsCamps) {
        const ct = this.campType(c);
        if (!campMap[ct]) campMap[ct] = { sp: 0, ms: 0 };
        campMap[ct].sp += n(c.spend);
        campMap[ct].ms += n(c.mess);
      }
      lines.push('Loai camp,Chi phi,Tin nhan,CPMess');
      for (const [ct, v] of Object.entries(campMap)) {
        lines.push([e(ct), v.sp, v.ms, v.ms > 0 ? Math.round(v.sp / v.ms) : 0].join(','));
      }
      lines.push('');
      lines.push('Chi tiet campaign (top 30),Loai,Team,Chi phi,Tin nhan');
      for (const r of (d.adsCamps || []).slice(0, 30)) {
        lines.push([e((r.campaign_name || '').slice(0, 50)), e(this.campType(r)), e(r.team || 'N/A'), n(r.spend), n(r.mess)].join(','));
      }
      lines.push('');
    }

    // Section 3: Traffic
    if ((d.trafficTeam || []).length > 0) {
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + n(r.views), 0);
      lines.push(`BAO CAO TRAFFIC - THANG ${month}/${year}`);
      lines.push(`Tong views,${f(tv)}`);
      lines.push('');
      lines.push('Market,Platform,Team,Views,Followers,Likes,Videos');
      for (const r of d.trafficTeam) {
        lines.push([this.isGlobal(r.team) ? 'Global' : 'Viet Nam', e(r.platform), e(r.team || 'N/A'), n(r.views), n(r.followers), n(r.likes), n(r.videos)].join(','));
      }
      lines.push('');
    }

    // Section 4: Content A1-A5
    if ((d.contentTypes || []).length > 0) {
      lines.push('Content type,Platform,Team,So video,Tong views');
      for (const r of d.contentTypes) {
        lines.push([e(r.ct), e(r.platform), e(r.team || 'N/A'), n(r.videos), n(r.views)].join(','));
      }
      lines.push('');
    }

    // Section 5: Top SKU
    if ((d.topSkus || []).length > 0) {
      lines.push('TOP SKU,So video,Tong views');
      for (const r of d.topSkus) {
        lines.push([e(r.sku), n(r.videos), n(r.views)].join(','));
      }
      lines.push('');
    }

    // Section 6: Top videos
    if ((d.topViews || []).length > 0) {
      lines.push('Top video views,Kenh,Team,Views,Likes,Comments');
      for (const r of d.topViews) {
        lines.push([e((r.title || '').slice(0, 50)), e(r.channel_name), e(r.team || ''), n(r.views), n(r.likes), n(r.comments)].join(','));
      }
    }

    const buf = Buffer.from('﻿' + lines.join('\n'), 'utf-8');
    await bot.sendDocument(chatId, buf,
      { caption: `📄 CSV đầy đủ tháng ${month}/${year}` },
      { filename: `bao-cao-${month}-${year}.csv`, contentType: 'text/csv' },
    );
  }

  // ── XLSX ─── đầy đủ tất cả sections ──────────────────────────────────────────

  private async sendXlsx(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VCB Studio AI';
    const n = this.n.bind(this);
    const f = this.f.bind(this);

    const mkSheet = (name: string, headers: string[], colWidths: number[], rows: any[][], hColor: string) => {
      const ws = wb.addWorksheet(name);
      ws.columns = headers.map((h, i) => ({ header: h, key: h, width: colWidths[i] || 14 }));
      // Style header row
      ws.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hColor.replace('#', '') } } as any;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.getRow(1).height = 20;
      rows.forEach((row, i) => {
        const r = ws.addRow(row);
        if (i % 2 === 0) {
          r.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } } as any;
          });
        }
      });
    };

    // Sheet 1: Ads tong quan
    if ((d.adsTeam || []).length > 0) {
      const ts = d.adsTeam.reduce((a: number, r: any) => a + n(r.spend), 0);
      const tm = d.adsTeam.reduce((a: number, r: any) => a + n(r.mess), 0);
      mkSheet('Ads - Tong quan',
        ['Market', 'Platform', 'Team', 'Chi phi (VND)', 'Tin nhan', 'Hien thi', 'CPMess', 'Danh gia'],
        [10, 10, 18, 16, 12, 14, 12, 14],
        d.adsTeam.map((r: any) => {
          const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [this.isGlobal(r.team) ? 'Global' : 'VN', r.platform || '', r.team || 'N/A',
            n(r.spend), n(r.mess), n(r.impr), cpm,
            cpm <= 18000 ? 'Xuat sac' : cpm <= 25000 ? 'Tot' : cpm <= 40000 ? 'Trung binh' : 'Can toi uu'];
        }), '7C3AED');
    }

    // Sheet 2: Ads by camp type
    if ((d.adsCamps || []).length > 0) {
      const campMap: Record<string, { sp: number; ms: number; cnt: number }> = {};
      for (const c of d.adsCamps) {
        const ct = this.campType(c);
        if (!campMap[ct]) campMap[ct] = { sp: 0, ms: 0, cnt: 0 };
        campMap[ct].sp += n(c.spend); campMap[ct].ms += n(c.mess); campMap[ct].cnt++;
      }
      mkSheet('Ads - Loai camp',
        ['Loai camp', 'So campaign', 'Chi phi', 'Tin nhan', 'CPMess', 'Danh gia'],
        [14, 12, 16, 12, 12, 14],
        Object.entries(campMap).map(([ct, v]) => {
          const cpm = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
          return [ct, v.cnt, v.sp, v.ms, cpm, cpm <= 18000 ? 'Xuat sac' : cpm <= 25000 ? 'Tot' : cpm <= 40000 ? 'Trung binh' : 'Can toi uu'];
        }), '6D28D9');
    }

    // Sheet 3: Campaign detail
    if ((d.adsCamps || []).length > 0) {
      mkSheet('Ads - Campaign chi tiet',
        ['Campaign', 'Loai', 'Content', 'Team', 'Chi phi', 'Tin nhan', 'CPMess'],
        [40, 12, 10, 16, 14, 12, 12],
        d.adsCamps.map((r: any) => {
          const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [(r.campaign_name || '').slice(0, 50), this.campType(r), r.content_type || '', r.team || 'N/A', n(r.spend), n(r.mess), cpm];
        }), '5B21B6');
    }

    // Sheet 4: Traffic by team
    if ((d.trafficTeam || []).length > 0) {
      mkSheet('Traffic - Theo team',
        ['Market', 'Platform', 'Team', 'Luot xem', 'Followers', 'Likes', 'Videos', 'So kenh'],
        [10, 10, 18, 14, 14, 12, 10, 10],
        d.trafficTeam.map((r: any) => [
          this.isGlobal(r.team) ? 'Global' : 'VN',
          r.platform || '', r.team || 'N/A',
          n(r.views), n(r.followers), n(r.likes), n(r.videos), n(r.channels),
        ]), '0EA5E9');
    }

    // Sheet 5: Content A1-A5
    if ((d.contentTypes || []).length > 0) {
      mkSheet('Traffic - Content A1-A5',
        ['Loai', 'Platform', 'Team', 'So video', 'Tong views', 'Views/Video'],
        [8, 12, 18, 10, 14, 12],
        d.contentTypes.map((r: any) => {
          const vids = n(r.videos);
          return [r.ct || '', r.platform || '', r.team || 'N/A', vids, n(r.views), vids > 0 ? Math.round(n(r.views) / vids) : 0];
        }), '0284C7');
    }

    // Sheet 6: Top SKU
    if ((d.topSkus || []).length > 0) {
      mkSheet('Traffic - Top SKU',
        ['SKU', 'So video', 'Tong views', 'Teams'],
        [12, 10, 14, 30],
        d.topSkus.map((r: any) => [
          r.sku || '',
          n(r.videos),
          n(r.views),
          Array.isArray(r.teams) ? r.teams.filter(Boolean).join(', ') : '',
        ]), '075985');
    }

    // Sheet 7+8: Top videos
    if ((d.topViews || []).length > 0) {
      mkSheet('Top Views',
        ['#', 'Title', 'Kenh', 'Team', 'Platform', 'Views', 'Likes', 'Comments'],
        [4, 40, 20, 16, 10, 10, 8, 8],
        d.topViews.map((r: any, i: number) => [
          i + 1, (r.title || '').slice(0, 50), r.channel_name || '', r.team || '', r.platform || '',
          n(r.views), n(r.likes), n(r.comments),
        ]), '1E3A5F');
    }
    if ((d.topCmts || []).length > 0) {
      mkSheet('Top Comments',
        ['#', 'Title', 'Kenh', 'Team', 'Comments', 'Views'],
        [4, 40, 20, 16, 10, 10],
        d.topCmts.map((r: any, i: number) => [
          i + 1, (r.title || '').slice(0, 50), r.channel_name || '', r.team || '',
          n(r.comments), n(r.views),
        ]), '1E3A5F');
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await bot.sendDocument(chatId, buf,
      { caption: `📊 XLSX đầy đủ tháng ${month}/${year} (${wb.worksheets.length} sheets)` },
      { filename: `bao-cao-${month}-${year}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
  }

  // ── DOCX ─── đầy đủ tất cả sections ──────────────────────────────────────────

  private async sendDocx(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    const n = this.n.bind(this);
    const f = this.f.bind(this);
    const s = this.safe.bind(this);

    // Cell helpers — dùng String() để tránh lỗi khi value là bigint/number
    const hCell = (text: string, bg = '7C3AED') => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: s(text), bold: true, color: 'FFFFFF', size: 16 })], alignment: AlignmentType.CENTER })],
      shading: { type: ShadingType.SOLID, color: bg },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

    const dCell = (val: any, bg = 'FFFFFF') => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: s(val), size: 16 })], alignment: AlignmentType.CENTER })],
      shading: bg !== 'FFFFFF' ? { type: ShadingType.SOLID, color: bg } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
    });

    const mkTable = (headers: string[], rows: any[][], hColor: string) => new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: headers.map(h => hCell(h, hColor)), tableHeader: true }),
        ...rows.map((row, i) => new TableRow({
          children: row.map(cell => dCell(cell, i % 2 === 0 ? 'F5F3FF' : 'FFFFFF')),
        })),
      ],
    });

    const h1 = (text: string, color = '7C3AED') => new Paragraph({
      children: [new TextRun({ text, bold: true, size: 26, color })],
      spacing: { before: 240, after: 120 },
    });
    const h2 = (text: string) => new Paragraph({
      children: [new TextRun({ text, bold: true, size: 22, color: '374151' })],
      spacing: { before: 160, after: 80 },
    });
    const para = (text: string) => new Paragraph({
      children: [new TextRun({ text: s(text), size: 18 })],
      spacing: { after: 80 },
    });
    const spacer = () => new Paragraph({ text: '', spacing: { after: 60 } });

    const children: any[] = [];

    // ─── Cover ───
    children.push(new Paragraph({
      children: [new TextRun({ text: `BAO CAO THANG ${month}/${year}`, bold: true, size: 36, color: '7C3AED' })],
      alignment: AlignmentType.CENTER, spacing: { after: 120 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `VCB Studio AI  |  ${new Date().toLocaleString('vi-VN')}`, size: 18, color: '888888' })],
      alignment: AlignmentType.CENTER, spacing: { after: 400 },
    }));

    // ─── Section 1: Ads ───
    if ((d.adsTeam || []).length > 0) {
      const ts = d.adsTeam.reduce((a: number, r: any) => a + n(r.spend), 0);
      const tm = d.adsTeam.reduce((a: number, r: any) => a + n(r.mess), 0);
      const tl = d.adsTeam.reduce((a: number, r: any) => a + n(r.likes), 0);
      const cpm = tm > 0 ? Math.round(ts / tm) : 0;
      const vnS = d.adsTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.spend), 0);
      const glS = ts - vnS;

      children.push(h1('1. QUANG CAO — TONG QUAN'));
      children.push(para(`Tong chi phi: ${f(ts)} VND`));
      children.push(para(`  Vietnam: ${f(vnS)} VND  |  Global: ${f(glS)} VND`));
      children.push(para(`Tin nhan (Mess): ${f(tm)}  |  CPMess: ${f(cpm)} VND`));
      children.push(para(`Danh gia: ${cpm <= 18000 ? 'Xuat sac (<18K)' : cpm <= 25000 ? 'Tot (18-25K)' : cpm <= 40000 ? 'Trung binh (25-40K)' : 'Can toi uu (>40K)'}`));
      children.push(para(`Like Page: ${f(tl)}`));
      children.push(para('Benchmark: CPMess <18K=Xuat sac | 18-25K=Tot | 25-40K=Trung binh | >40K=Can toi uu'));
      children.push(spacer());

      // Table: By market
      const mktData: Record<string, { sp: number; ms: number }> = { 'Viet Nam': { sp: 0, ms: 0 }, 'Global': { sp: 0, ms: 0 } };
      for (const r of d.adsTeam) { const mk = this.isGlobal(r.team) ? 'Global' : 'Viet Nam'; mktData[mk].sp += n(r.spend); mktData[mk].ms += n(r.mess); }
      children.push(h2('1a. Phan tich theo thi truong'));
      children.push(mkTable(
        ['Thi truong', 'Chi phi', 'Tin nhan', 'CPMess', '% Chi phi', 'Danh gia'],
        Object.entries(mktData).map(([mk, v]) => {
          const c = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
          return [mk, f(v.sp) + ' VND', f(v.ms), f(c), ts > 0 ? ((v.sp / ts) * 100).toFixed(1) + '%' : '0%',
            c <= 18000 ? 'Xuat sac' : c <= 25000 ? 'Tot' : c <= 40000 ? 'Trung binh' : 'Can toi uu'];
        }), '6D28D9'));
      children.push(spacer());

      // Table: By camp type
      if ((d.adsCamps || []).length > 0) {
        const cm: Record<string, { sp: number; ms: number; cnt: number }> = {};
        for (const c of d.adsCamps) { const ct = this.campType(c); if (!cm[ct]) cm[ct] = { sp: 0, ms: 0, cnt: 0 }; cm[ct].sp += n(c.spend); cm[ct].ms += n(c.mess); cm[ct].cnt++; }
        children.push(h2('1b. Phan tich theo loai camp'));
        children.push(mkTable(
          ['Loai camp', 'So campaign', 'Chi phi', 'Tin nhan', 'CPMess'],
          Object.entries(cm).map(([ct, v]) => [ct, String(v.cnt), f(v.sp) + ' VND', f(v.ms), f(v.ms > 0 ? Math.round(v.sp / v.ms) : 0)]),
          '5B21B6'));
        children.push(spacer());
      }

      // Table: By team
      children.push(h2('1c. Chi tiet theo team'));
      children.push(mkTable(
        ['Market', 'Platform', 'Team', 'Chi phi', 'Tin nhan', 'Hien thi', 'CPMess', 'Danh gia'],
        d.adsTeam.map((r: any) => {
          const c = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [this.isGlobal(r.team) ? 'Global' : 'VN', r.platform || '', r.team || 'N/A',
            f(r.spend) + ' VND', f(r.mess), f(r.impr), f(c),
            c <= 18000 ? 'Xuat sac' : c <= 25000 ? 'Tot' : c <= 40000 ? 'Trung binh' : 'Can toi uu'];
        }), '4C1D95'));
      children.push(spacer());
    }

    // ─── Section 2: Traffic ───
    if ((d.trafficTeam || []).length > 0) {
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + n(r.views), 0);
      const vnV = d.trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.views), 0);
      const totalVids = d.trafficTeam.reduce((a: number, r: any) => a + n(r.videos), 0);

      children.push(h1('2. TRAFFIC TU NHIEN', '0EA5E9'));
      children.push(para(`Tong luot xem: ${f(tv)}`));
      children.push(para(`  Vietnam: ${f(vnV)}  |  Global: ${f(tv - vnV)}`));
      children.push(para(`Tong video: ${f(totalVids)}`));
      children.push(spacer());

      children.push(h2('2a. Chi tiet theo team & platform'));
      children.push(mkTable(
        ['Market', 'Platform', 'Team', 'Luot xem', 'Followers', 'Videos', 'Likes'],
        d.trafficTeam.map((r: any) => [
          this.isGlobal(r.team) ? 'Global' : 'VN',
          r.platform || '', r.team || 'N/A',
          f(r.views), f(r.followers), f(r.videos), f(r.likes),
        ]), '0284C7'));
      children.push(spacer());

      // Content types
      if ((d.contentTypes || []).length > 0) {
        const ctMap: Record<string, { v: number; vw: number }> = {};
        for (const r of d.contentTypes) { if (!ctMap[r.ct]) ctMap[r.ct] = { v: 0, vw: 0 }; ctMap[r.ct].v += n(r.videos); ctMap[r.ct].vw += n(r.views); }
        children.push(h2('2b. Content A1-A5'));
        children.push(para(Object.entries(ctMap).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}: ${v.v} video | ${f(v.vw)} views`).join('   ')));
        children.push(mkTable(
          ['Content', 'Platform', 'Team', 'Videos', 'Views'],
          d.contentTypes.slice(0, 30).map((r: any) => [r.ct || '', r.platform || '', r.team || 'N/A', n(r.videos), f(r.views)]),
          '0369A1'));
        children.push(spacer());
      }

      // Top SKU
      if ((d.topSkus || []).length > 0) {
        children.push(h2('2c. Top 10 SKU nhieu video nhat'));
        children.push(mkTable(
          ['SKU', 'So video', 'Tong views', 'Teams'],
          d.topSkus.map((r: any) => [
            r.sku || '',
            String(n(r.videos)),
            f(r.views),
            Array.isArray(r.teams) ? r.teams.filter(Boolean).slice(0, 3).join(', ') : '',
          ]), '075985'));
        children.push(spacer());
      }

      // Top views
      if ((d.topViews || []).length > 0) {
        children.push(h2('2d. Top 10 video nhieu views nhat'));
        children.push(mkTable(
          ['#', 'Title', 'Kenh', 'Team', 'Views', 'Likes', 'CMT'],
          d.topViews.map((r: any, i: number) => [
            String(i + 1), (r.title || '').slice(0, 35),
            (r.channel_name || '').slice(0, 18), r.team || '',
            f(r.views), f(r.likes), f(r.comments),
          ]), '1E3A5F'));
        children.push(spacer());
      }

      // Top comments
      if ((d.topCmts || []).length > 0) {
        children.push(h2('2e. Top 10 video nhieu comment nhat'));
        children.push(mkTable(
          ['#', 'Title', 'Kenh', 'Team', 'CMT', 'Views'],
          d.topCmts.map((r: any, i: number) => [
            String(i + 1), (r.title || '').slice(0, 35),
            (r.channel_name || '').slice(0, 18), r.team || '',
            f(r.comments), f(r.views),
          ]), '1E3A5F'));
      }
    }

    const doc = new Document({
      sections: [{ children }],
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 18 } },
        },
      },
    });

    const buf = await Packer.toBuffer(doc);
    await bot.sendDocument(chatId, buf,
      { caption: `📝 DOCX đầy đủ tháng ${month}/${year}` },
      { filename: `bao-cao-${month}-${year}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    );
  }
}
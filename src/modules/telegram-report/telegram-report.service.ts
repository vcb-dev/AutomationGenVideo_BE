import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as TelegramBot from 'node-telegram-bot-api';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, ShadingType,
} from 'docx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { PdfReportGenerator, ReportData } from './pdf-report.generator';

// ─────────────────────────────────────────────────────────────────────────────

interface MonthKey { year: number; month: number; }

@Injectable()
export class TelegramReportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramReportService.name);

  private static readonly GLOBAL_KEYWORDS = ['global', 'thái lan', 'thai lan', 'indo', 'japan', 'jp'];
  private static readonly BM = { mess: { great: 18000, good: 25000, avg: 40000 } };

  // Chatbot state
  private chatbotInstances = new Map<string, TelegramBot>();
  private userTyping       = new Set<string>(); // chatId đang chờ AI trả lời

  // ID của system user dùng cho Telegram conversations
  private static TELEGRAM_SYSTEM_USER_ID: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiIntegrationService,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async onModuleInit() {
    // Khởi động chatbot cho tất cả config đang active
    const configs = await this.prisma.telegramReportConfig.findMany({
      where: { is_active: true, bot_token: { not: '' } },
    });
    for (const cfg of configs) {
      this.startChatbot(cfg.bot_token, cfg.chat_id);
    }
    this.logger.log(`[TelegramBot] Started ${configs.length} chatbot(s)`);
  }

  onModuleDestroy() {
    for (const bot of this.chatbotInstances.values()) {
      try { bot.stopPolling(); } catch {}
    }
  }

  // ── Start / Stop chatbot ──────────────────────────────────────────────────────

  startChatbot(token: string, authorizedChatId?: string) {
    if (!token || this.chatbotInstances.has(token)) return;
    try {
      const bot = new TelegramBot(token, { polling: { interval: 1000, autoStart: true } });

      bot.on('message', async (msg) => {
        const chatId = String(msg.chat.id);
        const text   = msg.text?.trim() || '';
        if (!text) return;

        // Lệnh /start
        if (text === '/start') {
          await bot.sendMessage(chatId,
            '👋 *Xin chào\\! Tôi là VCB Studio AI Analyst*\n\n' +
            'Tôi có thể giúp bạn phân tích dữ liệu:\n' +
            '• Báo cáo quảng cáo Meta \\+ TikTok\n' +
            '• Traffic organic Facebook \\+ Instagram\n' +
            '• So sánh hiệu suất theo team\n' +
            '• Phân tích kênh, video, SKU\n\n' +
            'Gõ bất kỳ câu hỏi để bắt đầu\\!\n\n' +
            '📋 Lệnh:\n' +
            '/clear \\- Xóa lịch sử hội thoại\n' +
            '/report \\- Gửi báo cáo tháng này\n\n' +
            '📊 Báo cáo kỳ \\(dữ liệu đã chốt\\):\n' +
            'Gõ tự nhiên, ví dụ:\n' +
            '• _"báo cáo quý 1"_ hoặc _"báo cáo Q2/2026"_\n' +
            '• _"báo cáo 6 tháng đầu năm"_\n' +
            '• _"báo cáo năm 2025"_',
            { parse_mode: 'MarkdownV2' });
          return;
        }

        // Lệnh /clear
        if (text === '/clear') {
          await this.clearTelegramHistory(chatId);
          await bot.sendMessage(chatId, '🗑️ Đã xóa lịch sử hội thoại. Bắt đầu cuộc trò chuyện mới!');
          return;
        }

        // Lệnh /report — gửi tất cả format đã config
        if (text === '/report') {
          const cfg = await this.prisma.telegramReportConfig.findFirst({ where: { bot_token: token, is_active: true } });
          if (cfg) {
            await bot.sendMessage(chatId, '📊 Đang tạo báo cáo tháng này, vui lòng chờ...');
            try { await this.sendReports(cfg); }
            catch (e) { await bot.sendMessage(chatId, `❌ Lỗi: ${e.message}`); }
          } else {
            await bot.sendMessage(chatId, '⚠️ Chưa có cấu hình báo cáo. Vào web để cài đặt.');
          }
          return;
        }

        // Nhận diện yêu cầu báo cáo kỳ (quý / 6 tháng / năm) — ưu tiên cao hơn fileRequest
        const periodRequest = this.detectPeriodRequest(text);
        if (periodRequest) {
          if (this.userTyping.has(chatId)) {
            await bot.sendMessage(chatId, '⏳ Đang xử lý, vui lòng chờ...');
            return;
          }
          this.userTyping.add(chatId);
          try {
            await bot.sendMessage(chatId, `📊 Đang tạo ${periodRequest.label}, vui lòng chờ...`);
            await this.sendPeriodReport(bot, chatId, periodRequest.months, periodRequest.label);
          } catch (e) {
            await bot.sendMessage(chatId, `❌ Lỗi tạo báo cáo kỳ: ${e.message}`);
          } finally {
            this.userTyping.delete(chatId);
          }
          return;
        }

        // Nhận diện yêu cầu gửi file báo cáo qua ngôn ngữ tự nhiên
        const fileRequest = this.detectFileRequest(text);
        if (fileRequest) {
          if (this.userTyping.has(chatId)) {
            await bot.sendMessage(chatId, '⏳ Đang xử lý, vui lòng chờ...');
            return;
          }
          this.userTyping.add(chatId);
          try {
            const cfg = await this.prisma.telegramReportConfig.findFirst({ where: { bot_token: token, is_active: true } });
            if (!cfg) {
              await bot.sendMessage(chatId, '⚠️ Chưa có cấu hình báo cáo. Vào web để cài đặt.');
              return;
            }
            const { formats, types, label } = fileRequest;
            await bot.sendMessage(chatId, `📊 Đang tạo ${label}, vui lòng chờ...`);

            const now = new Date();
            const data = await this.collectData(now.getFullYear(), now.getMonth() + 1, types);

            for (const fmt of formats) {
              try {
                if (fmt === 'pdf')  await this.sendPdf(bot, chatId, data, now.getFullYear(), now.getMonth() + 1);
                if (fmt === 'xlsx') await this.sendXlsx(bot, chatId, data, now.getFullYear(), now.getMonth() + 1);
                if (fmt === 'csv')  await this.sendCsv(bot, chatId, data, now.getFullYear(), now.getMonth() + 1);
                if (fmt === 'docx') await this.sendDocx(bot, chatId, data, now.getFullYear(), now.getMonth() + 1);
              } catch (e) {
                await bot.sendMessage(chatId, `⚠️ Không tạo được ${fmt.toUpperCase()}: ${e.message}`);
              }
            }
          } finally {
            this.userTyping.delete(chatId);
          }
          return;
        }

        // Ngăn spam — nếu đang xử lý câu hỏi trước
        if (this.userTyping.has(chatId)) {
          await bot.sendMessage(chatId, '⏳ Đang xử lý câu hỏi trước, vui lòng chờ...');
          return;
        }

        // ── AI Chat ───────────────────────────────────────────────────────────
        this.userTyping.add(chatId);
        try {
          await bot.sendChatAction(chatId, 'typing');

          // Load history từ DB
          const history = await this.loadTelegramHistory(chatId);

          // Lưu tin nhắn user
          await this.saveTelegramMessage(chatId, 'user', text, text);

          const aiResponse = await this.aiService.chat(text, history);
          const reply = aiResponse?.message || 'Xin lỗi, tôi không hiểu câu hỏi này.';

          // Lưu tin nhắn assistant
          await this.saveTelegramMessage(chatId, 'assistant', reply, text);

          // Gửi reply (giới hạn 4096 ký tự)
          const safeReply = reply.length > 4000 ? reply.slice(0, 3997) + '...' : reply;
          await bot.sendMessage(chatId, safeReply);

          // Nếu có data table, gửi preview
          if (aiResponse?.data && Array.isArray(aiResponse.data) && aiResponse.data.length > 0) {
            const preview = this.formatDataPreview(aiResponse.data);
            if (preview) {
              try { await bot.sendMessage(chatId, preview, { parse_mode: 'MarkdownV2' }); }
              catch { await bot.sendMessage(chatId, preview.replace(/[`]/g, "'")); }
            }
          }

        } catch (err) {
          this.logger.error(`[TelegramBot] AI error for ${chatId}: ${err.message}`);
          await bot.sendMessage(chatId, '❌ Xin lỗi, tôi gặp lỗi khi xử lý câu hỏi. Thử lại nhé!');
        } finally {
          this.userTyping.delete(chatId);
        }
      });

      bot.on('polling_error', (err) => {
        this.logger.warn(`[TelegramBot] Polling error: ${err.message}`);
      });

      this.chatbotInstances.set(token, bot);
    } catch (err) {
      this.logger.error(`[TelegramBot] Failed to start: ${err.message}`);
    }
  }

  // ── File request detector ─────────────────────────────────────────────────────

  private detectFileRequest(text: string): { formats: string[]; types: string[]; label: string } | null {
    const t = text.toLowerCase();

    // Kiểm tra có yêu cầu gửi file/báo cáo không
    const isReport = ['báo cáo','bao cao','report','file','gửi','gui','xuất','xuat','tải','tai','download'].some(kw => t.includes(kw));
    if (!isReport) return null;

    // Xác định format(s) cần gửi
    const formats: string[] = [];
    if (t.includes('pdf'))              formats.push('pdf');
    if (t.includes('xlsx') || t.includes('excel')) formats.push('xlsx');
    if (t.includes('csv'))              formats.push('csv');
    if (t.includes('docx') || t.includes('word')) formats.push('docx');
    if (t.includes('tất cả') || t.includes('tat ca') || t.includes('all') || t.includes('full')) {
      formats.push('pdf', 'xlsx', 'csv', 'docx');
    }
    // Nếu không chỉ rõ format → gửi PDF + XLSX (phổ biến nhất)
    if (formats.length === 0) formats.push('pdf', 'xlsx');

    // Xác định loại báo cáo
    const types: string[] = [];
    if (t.includes('ads') || t.includes('quảng cáo') || t.includes('quang cao') || t.includes('camp')) types.push('ads');
    if (t.includes('traffic') || t.includes('view') || t.includes('kênh') || t.includes('kenh') || t.includes('organic')) types.push('traffic');
    if (types.length === 0) types.push('ads', 'traffic'); // Mặc định: cả 2

    // Label hiển thị
    const fmtStr = [...new Set(formats)].map(f => f.toUpperCase()).join(' + ');
    const typeStr = types.includes('ads') && types.includes('traffic') ? 'báo cáo đầy đủ'
      : types.includes('ads') ? 'báo cáo quảng cáo'
      : 'báo cáo traffic';

    return { formats: [...new Set(formats)], types, label: `${typeStr} (${fmtStr})` };
  }

  /**
   * Nhận diện yêu cầu báo cáo kỳ (quý / 6 tháng / năm).
   * Trả về danh sách tháng cần báo cáo + nhãn hiển thị.
   */
  private detectPeriodRequest(text: string): { months: MonthKey[]; label: string } | null {
    const t = text.toLowerCase();

    // Bắt buộc phải có từ khoá "báo cáo / report / gửi / xuất"
    const isReport = ['báo cáo', 'bao cao', 'report', 'gửi', 'gui', 'xuất', 'xuat'].some(kw => t.includes(kw));
    if (!isReport) return null;

    const now = new Date();
    const cy  = now.getFullYear();

    // Lấy năm được nhắc đến (nếu có), ngược lại dùng năm hiện tại
    const yearMatch = t.match(/\b(202\d|203\d)\b/);
    const refYear   = yearMatch ? parseInt(yearMatch[1]) : cy;

    // ── Quý: "quý 1", "quý 2", "q1", "q2", "quarter 3" ──────────────────
    const qMatch = t.match(/qu[yý]\s*([1-4])/i)
                || t.match(/\bq([1-4])\b/i)
                || t.match(/quarter\s*([1-4])/i);
    if (qMatch) {
      const q      = parseInt(qMatch[1]);
      const start  = (q - 1) * 3 + 1;
      const months = this.getQuarterMonths(refYear, q);
      const endM   = start + 2;
      return { months, label: `Báo cáo Quý ${q}/${refYear} (T${start}–T${endM})` };
    }

    // ── Nửa năm: "6 tháng đầu", "6 tháng cuối", "nửa năm", "H1", "H2" ───
    const halfKeyword = t.includes('6 tháng') || t.includes('6thang')
                     || t.includes('nửa năm') || t.includes('nua nam')
                     || /\bh[12]\b/i.test(t);
    if (halfKeyword) {
      const isSecond = t.includes('cuối') || t.includes('sau') || /\bh2\b/i.test(t);
      const half     = isSecond ? 2 : 1;
      const months   = this.getHalfMonths(refYear, half);
      const label    = half === 1 ? '6 tháng đầu năm' : '6 tháng cuối năm';
      return { months, label: `Báo cáo ${label} ${refYear} (T${months[0].month}–T${months[5].month})` };
    }

    // ── Cả năm: "báo cáo năm", "cả năm", "toàn năm" ─────────────────────
    const isFullYear = t.includes('cả năm') || t.includes('ca nam')
                    || t.includes('toàn năm') || t.includes('toan nam')
                    || (t.includes('năm') && !t.includes('tháng') && yearMatch);
    if (isFullYear) {
      // Nếu không nêu năm cụ thể → mặc định năm trước (đã kết thúc)
      const targetYear = yearMatch ? refYear : cy - 1;
      const months     = this.getYearMonths(targetYear);
      return { months, label: `Báo cáo Năm ${targetYear} (T1–T12)` };
    }

    return null;
  }

  private formatDataPreview(data: any[]): string {
    if (!data || data.length === 0) return '';
    try {
      const keys = Object.keys(data[0]).slice(0, 4); // Tối đa 4 cột
      const s = (_: string, v: any) => typeof v === 'bigint' ? v.toString() : v;
      const header = keys.join(' | ');
      const rows = data.slice(0, 8).map(row =>
        keys.map(k => {
          const v = row[k];
          const num = typeof v === 'bigint' ? Number(v) : Number(v);
          if (!isNaN(num) && num >= 1000) {
            if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
          }
          return String(v ?? '');
        }).join(' | ')
      );
      return `\`\`\`\n${header}\n${'-'.repeat(40)}\n${rows.join('\n')}\n\`\`\``;
    } catch { return ''; }
  }

  // ── DB helpers cho Telegram chat ─────────────────────────────────────────────

  /** Lấy hoặc tạo system user dùng cho Telegram bot (không gắn với Google account) */
  private async getTelegramSystemUserId(): Promise<string | null> {
    if (TelegramReportService.TELEGRAM_SYSTEM_USER_ID) {
      return TelegramReportService.TELEGRAM_SYSTEM_USER_ID;
    }
    // Tìm user đầu tiên trong hệ thống làm owner cho Telegram conversations
    const user = await this.prisma.user.findFirst({ orderBy: { created_at: 'asc' } });
    if (!user) return null;
    TelegramReportService.TELEGRAM_SYSTEM_USER_ID = user.id;
    return user.id;
  }

  /** Lấy conversation hiện tại của Telegram user, tạo mới nếu chưa có */
  private async getTelegramConversation(telegramChatId: string, title: string): Promise<string> {
    const existing = await this.prisma.chatConversation.findFirst({
      where: { telegram_chat_id: telegramChatId },
      orderBy: { updated_at: 'desc' },
    });
    if (existing) return existing.id;

    const userId = await this.getTelegramSystemUserId();
    if (!userId) throw new Error('No users in system');

    const conv = await this.prisma.chatConversation.create({
      data: {
        user_id: userId,
        telegram_chat_id: telegramChatId,
        title: title.slice(0, 60),
      },
    });
    return conv.id;
  }

  /** Load lịch sử tin nhắn gần đây từ DB */
  private async loadTelegramHistory(telegramChatId: string): Promise<{ role: string; content: string }[]> {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { telegram_chat_id: telegramChatId },
      orderBy: { updated_at: 'desc' },
    });
    if (!conv) return [];

    const msgs = await this.prisma.chatMessage.findMany({
      where: { conversation_id: conv.id },
      orderBy: { created_at: 'asc' },
      take: 20, // 10 lượt gần nhất
      select: { role: true, content: true },
    });
    return msgs.map(m => ({ role: m.role, content: m.content }));
  }

  /** Lưu tin nhắn vào DB */
  private async saveTelegramMessage(telegramChatId: string, role: 'user' | 'assistant', content: string, firstMsg: string) {
    try {
      const convId = await this.getTelegramConversation(telegramChatId, firstMsg);
      await this.prisma.$transaction([
        this.prisma.chatMessage.create({ data: { conversation_id: convId, role, content } }),
        this.prisma.chatConversation.update({ where: { id: convId }, data: { updated_at: new Date() } }),
      ]);
    } catch (e) {
      this.logger.warn(`[TelegramBot] Failed to save message: ${e.message}`);
    }
  }

  /** Xóa lịch sử hội thoại Telegram của user */
  private async clearTelegramHistory(telegramChatId: string) {
    const convs = await this.prisma.chatConversation.findMany({
      where: { telegram_chat_id: telegramChatId },
    });
    for (const conv of convs) {
      await this.prisma.chatConversation.delete({ where: { id: conv.id } });
    }
  }

  // Reload chatbot khi config thay đổi
  async reloadChatbot(token: string, chatId?: string) {
    const existing = this.chatbotInstances.get(token);
    if (existing) { try { existing.stopPolling(); } catch {} this.chatbotInstances.delete(token); }
    if (token) this.startChatbot(token, chatId);
  }

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
    let result: any;
    if (existing) {
      result = await this.prisma.telegramReportConfig.update({
        where: { id: existing.id },
        data: { ...dto, user_id: userId, user_email: userEmail, updated_at: new Date() },
      });
    } else {
      result = await this.prisma.telegramReportConfig.create({
        data: { user_id: userId, user_email: userEmail, ...dto },
      });
    }
    // Reload chatbot với token mới
    if (dto.bot_token && dto.is_active) {
      await this.reloadChatbot(dto.bot_token, dto.chat_id);
    }
    return result;
  }

  async sendTestReport(userId: string, userEmail?: string): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.getConfig(userId, userEmail);
    if (!cfg?.bot_token || !cfg?.chat_id) return { ok: false, message: 'Chưa có cấu hình Telegram' };
    try { await this.sendReports(cfg); return { ok: true, message: 'Đã gửi báo cáo test thành công!' }; }
    catch (e) { return { ok: false, message: `Lỗi: ${e.message}` }; }
  }

  // ── Cron check ────────────────────────────────────────────────────────────

  private _reportRunning = false;

  @Cron('0 * * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleScheduledReports() {
    if (this._reportRunning) return;
    this._reportRunning = true;
    try {
      const now     = new Date();
      const day     = now.getDate();
      const month   = now.getMonth() + 1;
      const year    = now.getFullYear();
      const configs = await this.prisma.telegramReportConfig.findMany({ where: { is_active: true } });

      for (const cfg of configs) {
        try {
          const [m, h] = (cfg.schedule || '0 8 * * *').split(' ').map(Number);
          if (now.getHours() !== h || now.getMinutes() !== m) continue;

          this.logger.log(`[Telegram] Gửi cho user ${cfg.user_id}`);

          // Báo cáo tháng (hàng ngày, DOCX/PDF tự guard bởi isSnapshotLocked)
          await this.sendReports(cfg);

          // Báo cáo kỳ — chỉ gửi vào ngày 8 nếu dữ liệu đã chốt (ngày 7)
          if (day === 8) {
            const periods: string[] = (cfg as any).period_reports ?? ['monthly'];
            const bot = new TelegramBot(cfg.bot_token, { polling: false });
            await this.sendScheduledPeriodReports(bot, cfg.chat_id, year, month, periods);
          }
        } catch (e) { this.logger.error(`[Telegram] Lỗi ${cfg.user_id}: ${e.message}`); }
      }
    } finally {
      this._reportRunning = false;
    }
  }

  /**
   * Gửi báo cáo kỳ (quý/6 tháng/năm) tự động vào ngày 8 mỗi kỳ.
   * Lịch trigger:
   *   Quý  : ngày 8 tháng 4 (Q1), 7 (Q2), 10 (Q3), 1 (Q4)
   *   6 tháng: ngày 8 tháng 7 (H1), 1 (H2)
   *   Năm  : ngày 8 tháng 1
   */
  private async sendScheduledPeriodReports(
    bot: TelegramBot,
    chatId: string,
    year: number,
    month: number,
    periods: string[],
  ) {
    const tasks: { months: MonthKey[]; label: string }[] = [];

    // Quarterly: gửi báo cáo quý vừa kết thúc
    if (periods.includes('quarterly')) {
      // tháng 4→Q1, 7→Q2, 10→Q3, 1→Q4 (năm trước)
      const qMap: Record<number, [number, number]> = {
        4: [1, year], 7: [2, year], 10: [3, year], 1: [4, year - 1],
      };
      const q = qMap[month];
      if (q) {
        tasks.push({
          months: this.getQuarterMonths(q[1], q[0]),
          label:  `Báo cáo Quý ${q[0]}/${q[1]}`,
        });
      }
    }

    // Semi-annual: tháng 7→H1, tháng 1→H2 (năm trước)
    if (periods.includes('semi_annual')) {
      if (month === 7) {
        tasks.push({ months: this.getHalfMonths(year, 1),     label: `Báo cáo 6 tháng đầu năm ${year}` });
      } else if (month === 1) {
        tasks.push({ months: this.getHalfMonths(year - 1, 2), label: `Báo cáo 6 tháng cuối năm ${year - 1}` });
      }
    }

    // Annual: tháng 1 → báo cáo năm trước
    if (periods.includes('annual') && month === 1) {
      tasks.push({ months: this.getYearMonths(year - 1), label: `Báo cáo Năm ${year - 1}` });
    }

    for (const task of tasks) {
      try {
        this.logger.log(`[Period Auto] ${task.label}`);
        await this.sendPeriodReport(bot, chatId, task.months, task.label);
      } catch (e) {
        this.logger.error(`[Period Auto] Lỗi ${task.label}: ${e.message}`);
      }
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

    // Tháng trước (để so sánh)
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;

    const [adsCamps, adsTeam, trafficTeam, contentTypes, topSkus, topViews, topCmts,
           prevAdsTeam, prevTrafficTeam] =
      await Promise.all([
        doAds ? this.qAdsCamps(year, month)    : Promise.resolve([]),
        doAds ? this.qAdsTeam(year, month)     : Promise.resolve([]),
        doTrf ? this.qTrafficTeam(year, month) : Promise.resolve([]),
        doTrf ? this.qContentTypes(year, month): Promise.resolve([]),
        doTrf ? this.qTopSkus(year, month)     : Promise.resolve([]),
        doTrf ? this.qTopViews(year, month)    : Promise.resolve([]),
        doTrf ? this.qTopComments(year, month) : Promise.resolve([]),
        // Tháng trước: dùng snapshot (đã chốt, chính xác) → fallback live nếu chưa có
        doAds ? this.qAdsTeam(prevYear, prevMonth).catch(() => [])     : Promise.resolve([]),
        doTrf ? this.qPrevTrafficTeam(prevYear, prevMonth).catch(() => []): Promise.resolve([]),
      ]);

    return { adsCamps, adsTeam, trafficTeam, contentTypes, topSkus, topViews, topCmts,
             prevAdsTeam, prevTrafficTeam, prevMonth, prevYear };
  }

  /**
   * Traffic tháng trước: ưu tiên snapshot (đã chốt), fallback live nếu chưa có.
   * Không ném lỗi — trả về [] nếu không có dữ liệu.
   */
  private async qPrevTrafficTeam(y: number, m: number): Promise<any[]> {
    // Thử snapshot trước
    try {
      const snap = await this.q(`
        SELECT platform, team,
               SUM(views_locked)    AS views,
               SUM(followers_locked)AS followers,
               SUM(likes_locked)    AS likes,
               SUM(comments_locked) AS comments,
               COUNT(*)             AS videos
        FROM social_video_snapshot
        WHERE report_year=${y} AND report_month=${m}
        GROUP BY platform, team ORDER BY views DESC`);
      if (snap.length > 0) return snap;
    } catch { /* bảng chưa tồn tại */ }

    // Fallback: live data
    return this.q(`
      SELECT platform, team,
             SUM(views) views, MAX(followers) followers,
             SUM(likes) likes, SUM(comments) comments,
             COUNT(*) videos
      FROM social_video_report
      WHERE year=${y} AND month=${m}
      GROUP BY platform, team ORDER BY views DESC`).catch(() => []);
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

  // ── Period (multi-month) queries ──────────────────────────────────────────

  /** Tháng nằm trong một quý (1–4) */
  private getQuarterMonths(year: number, quarter: number): MonthKey[] {
    const start = (quarter - 1) * 3 + 1;
    return [0, 1, 2].map(i => ({ year, month: start + i }));
  }

  /** Tháng nằm trong một nửa năm (1 = H1, 2 = H2) */
  private getHalfMonths(year: number, half: number): MonthKey[] {
    const start = (half - 1) * 6 + 1;
    return Array.from({ length: 6 }, (_, i) => ({ year, month: start + i }));
  }

  /** 12 tháng trong một năm */
  private getYearMonths(year: number): MonthKey[] {
    return Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));
  }

  /** Lọc ra những tháng đã có snapshot (đã chốt) */
  private async getLockedMonths(months: MonthKey[]): Promise<MonthKey[]> {
    const checks = await Promise.all(
      months.map(m => this.isSnapshotLocked(m.year, m.month).then(ok => ({ m, ok }))),
    );
    return checks.filter(c => c.ok).map(c => c.m);
  }

  /** Traffic đa tháng từ social_video_snapshot */
  private qPeriodTraffic(months: MonthKey[]): Promise<any[]> {
    if (!months.length) return Promise.resolve([]);
    const cond = months
      .map(m => `(report_year=${m.year} AND report_month=${m.month})`)
      .join(' OR ');
    return this.q(`
      SELECT report_year AS year, report_month AS month, platform, team,
             SUM(views_locked)    AS views,
             SUM(likes_locked)    AS likes,
             SUM(comments_locked) AS comments,
             COUNT(*)             AS videos
      FROM social_video_snapshot
      WHERE ${cond}
      GROUP BY report_year, report_month, platform, team
      ORDER BY report_year, report_month, views DESC`);
  }

  /** Chi phí quảng cáo đa tháng */
  private qPeriodAds(months: MonthKey[]): Promise<any[]> {
    if (!months.length) return Promise.resolve([]);
    const cond = months
      .map(m => `(year=${m.year} AND month=${m.month})`)
      .join(' OR ');
    return this.q(`
      SELECT year, month, team, platform,
             SUM(spend)          AS spend,
             SUM(mess_count)     AS mess,
             SUM(impressions)    AS impr,
             SUM(like_count)     AS likes
      FROM ads_campaign_stats
      WHERE ${cond}
      GROUP BY year, month, team, platform
      ORDER BY year, month, spend DESC`);
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
    const { adsTeam, adsCamps, prevAdsTeam = [], prevMonth, prevYear } = d;
    const ts = adsTeam.reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const tm = adsTeam.reduce((a: number, r: any) => a + this.n(r.mess), 0);
    const tl = adsTeam.reduce((a: number, r: any) => a + this.n(r.likes), 0);
    const vnS = adsTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const glS = adsTeam.filter((r: any) => this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const cpm = tm > 0 ? Math.round(ts / tm) : 0;

    // Tháng trước
    const pts  = prevAdsTeam.reduce((a: number, r: any) => a + this.n(r.spend), 0);
    const ptm  = prevAdsTeam.reduce((a: number, r: any) => a + this.n(r.mess), 0);
    const pcpm = ptm > 0 ? Math.round(pts / ptm) : 0;
    const mom  = (cur: number, prev: number) => {
      if (!prev || !cur) return '';
      const p = ((cur - prev) / prev * 100);
      return ` <i>(${p >= 0 ? '+' : ''}${p.toFixed(1)}% vs T${prevMonth})</i>`;
    };

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
    msg += `• Tổng chi phí: <b>${this.f(ts)} VNĐ</b>${mom(ts, pts)}\n`;
    msg += `• 🇻🇳 Vietnam: ${this.f(vnS)} VNĐ\n`;
    msg += `• 🌏 Global: ${this.f(glS)} VNĐ\n`;
    msg += `• Tin nhắn: <b>${this.f(tm)}</b>${mom(tm, ptm)}  |  CPMess: <b>${this.f(cpm)} VNĐ</b>${pcpm ? mom(cpm, pcpm) : ''}\n`;
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
    const { trafficTeam, contentTypes, topSkus, topViews, prevTrafficTeam = [], prevMonth } = d;
    const tv   = trafficTeam.reduce((a: number, r: any) => a + this.n(r.views), 0);
    const vnV  = trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const glV  = trafficTeam.filter((r: any) =>  this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const totalVideos = trafficTeam.reduce((a: number, r: any) => a + this.n(r.videos), 0);

    // Tháng trước
    const ptv  = prevTrafficTeam.reduce((a: number, r: any) => a + this.n(r.views), 0);
    const pvnV = prevTrafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const pglV = prevTrafficTeam.filter((r: any) =>  this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
    const pVids = prevTrafficTeam.reduce((a: number, r: any) => a + this.n(r.videos), 0);
    const mom  = (cur: number, prev: number) => {
      if (!prev || !cur) return '';
      const p = ((cur - prev) / prev * 100);
      return ` <i>(${p >= 0 ? '+' : ''}${p.toFixed(1)}% vs T${prevMonth})</i>`;
    };

    let msg = `📱 <b>BÁO CÁO TRAFFIC — THÁNG ${month}/${year}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('vi-VN')}\n`;
    msg += `${'─'.repeat(32)}\n\n`;

    msg += `<b>📌 TỔNG QUAN</b>\n`;
    msg += `• Tổng lượt xem: <b>${this.f(tv)}</b>${mom(tv, ptv)}\n`;
    msg += `• 🇻🇳 Vietnam: ${this.f(vnV)}${mom(vnV, pvnV)}\n`;
    msg += `• 🌏 Global: ${this.f(glV)}${mom(glV, pglV)}\n`;
    msg += `• Tổng video: ${this.f(totalVideos)}${mom(totalVideos, pVids)}\n\n`;

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

  // ── Snapshot lock check ───────────────────────────────────────────────────

  /**
   * Kiểm tra dữ liệu tháng (year/month) đã được chốt vào social_video_snapshot chưa.
   * lock_monthly_report.py chạy vào ngày 7 hàng tháng mới chốt tháng trước.
   */
  private async isSnapshotLocked(year: number, month: number): Promise<boolean> {
    try {
      const rows = await this.q(
        `SELECT COUNT(*) AS cnt FROM social_video_snapshot WHERE report_year=${year} AND report_month=${month}`
      );
      return this.n((rows as any[])?.[0]?.cnt) > 0;
    } catch {
      return false; // bảng chưa tồn tại hoặc lỗi kết nối
    }
  }

  /** Tính ngày chốt dự kiến: ngày 7 của tháng tiếp theo */
  private lockDateLabel(year: number, month: number): string {
    const nextMonth = month === 12 ? 1  : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    return `07/${String(nextMonth).padStart(2, '0')}/${nextYear}`;
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
    // Báo cáo đầy đủ chỉ gửi khi dữ liệu tháng đã được chốt
    const locked = await this.isSnapshotLocked(year, month);
    if (!locked) {
      await bot.sendMessage(chatId,
        `📊 <b>PDF Báo cáo tháng ${month}/${year}</b>\n\n` +
        `⏳ Dữ liệu tháng ${month}/${year} chưa được chốt.\n` +
        `Báo cáo đầy đủ sẽ được gửi sau khi dữ liệu được khóa vào ngày <b>${this.lockDateLabel(year, month)}</b>.\n\n` +
        `💡 Hỏi chatbot AI để xem dữ liệu live tháng này.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    if ((d.adsTeam || []).length > 0) {
      const adsData: ReportData = { type: 'ads', year, month, adsTeam: d.adsTeam, adsCamps: d.adsCamps };
      const adsBuf = await new PdfReportGenerator().generate(adsData);
      await bot.sendDocument(chatId, adsBuf,
        { caption: `📊 PDF Quảng cáo tháng ${month}/${year}` },
        { filename: `ads-${month}-${year}.pdf`, contentType: 'application/pdf' });
    }
    if ((d.trafficTeam || []).length > 0) {
      const [byPlatform, topChannels] = await Promise.all([
        this.prisma.$queryRawUnsafe(
          `SELECT platform, SUM(views) views, COUNT(*) cnt FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY platform ORDER BY views DESC`
        ) as Promise<any[]>,
        this.prisma.$queryRawUnsafe(
          `SELECT channel_name, platform, team, SUM(views) views FROM social_video_report WHERE year=${year} AND month=${month} GROUP BY channel_name,platform,team ORDER BY views DESC LIMIT 10`
        ) as Promise<any[]>,
      ]);

      const tv   = d.trafficTeam.reduce((a: number, r: any) => a + this.n(r.views), 0);
      const vnV  = d.trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
      const tvids = d.trafficTeam.reduce((a: number, r: any) => a + this.n(r.videos), 0);

      // Số liệu tháng trước cho delta KPI
      const prev  = d.prevTrafficTeam ?? [];
      const ptv   = prev.reduce((a: number, r: any) => a + this.n(r.views), 0);
      const pvnV  = prev.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + this.n(r.views), 0);
      const pVids = prev.reduce((a: number, r: any) => a + this.n(r.videos), 0);

      const trafData: ReportData = {
        type: 'traffic', year, month,
        totalViews: tv,   vnViews: vnV,   globalViews: tv - vnV,   totalVideos: tvids,
        // Prev month — undefined khi không có dữ liệu → _delta() tự bỏ qua
        prevTotalViews:  ptv   || undefined,
        prevVnViews:     pvnV  || undefined,
        prevGlobalViews: ptv > 0 ? ptv - pvnV : undefined,
        prevTotalVideos: pVids || undefined,
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
      lines.push(`BÁO CÁO QUẢNG CÁO - THÁNG ${month}/${year}`);
      lines.push(`Tổng chi phí,${f(ts)} VNĐ,Tổng tin nhắn,${f(tm)},CPMess TB,${tm > 0 ? f(Math.round(ts / tm)) : '0'} VNĐ`);
      lines.push('');
      lines.push('Thị trường,Nền tảng,Team,Chi phí (VNĐ),Tin nhắn,Hiển thị,CPMess,Đánh giá');
      for (const r of d.adsTeam) {
        const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
        const eval_ = cpm <= 18000 ? 'Xuất sắc' : cpm <= 25000 ? 'Tốt' : cpm <= 40000 ? 'Trung bình' : 'Cần tối ưu';
        lines.push([this.isGlobal(r.team) ? 'Global' : 'Việt Nam', e(r.platform), e(r.team || 'N/A'), n(r.spend), n(r.mess), n(r.impr), cpm, eval_].join(','));
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
      lines.push('Loại camp,Chi phí,Tin nhắn,CPMess');
      for (const [ct, v] of Object.entries(campMap)) {
        lines.push([e(ct), v.sp, v.ms, v.ms > 0 ? Math.round(v.sp / v.ms) : 0].join(','));
      }
      lines.push('');
      lines.push('Chi tiết campaign (top 30),Loại,Team,Chi phí,Tin nhắn');
      for (const r of (d.adsCamps || []).slice(0, 30)) {
        lines.push([e((r.campaign_name || '').slice(0, 50)), e(this.campType(r)), e(r.team || 'N/A'), n(r.spend), n(r.mess)].join(','));
      }
      lines.push('');
    }

    // Section 3: Traffic
    if ((d.trafficTeam || []).length > 0) {
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + n(r.views), 0);
      lines.push(`BÁO CÁO TRAFFIC TỰ NHIÊN - THÁNG ${month}/${year}`);
      lines.push(`Tổng lượt xem,${f(tv)}`);
      lines.push('');
      lines.push('Thị trường,Nền tảng,Team,Lượt xem,Followers,Likes,Số video');
      for (const r of d.trafficTeam) {
        lines.push([this.isGlobal(r.team) ? 'Global' : 'Việt Nam', e(r.platform), e(r.team || 'N/A'), n(r.views), n(r.followers), n(r.likes), n(r.videos)].join(','));
      }
      lines.push('');
    }

    // Section 4: Content A1-A5
    if ((d.contentTypes || []).length > 0) {
      lines.push('Loại content,Nền tảng,Team,Số video,Tổng views');
      for (const r of d.contentTypes) {
        lines.push([e(r.ct), e(r.platform), e(r.team || 'N/A'), n(r.videos), n(r.views)].join(','));
      }
      lines.push('');
    }

    // Section 5: Top SKU
    if ((d.topSkus || []).length > 0) {
      lines.push('TOP SKU,Số video,Tổng views');
      for (const r of d.topSkus) {
        lines.push([e(r.sku), n(r.videos), n(r.views)].join(','));
      }
      lines.push('');
    }

    // Section 6: Top videos
    if ((d.topViews || []).length > 0) {
      lines.push('Top video nhiều views,Kênh,Team,Views,Likes,Bình luận');
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
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F6' } } as any;
          });
        }
      });
    };

    // Sheet 1: Ads tổng quan
    if ((d.adsTeam || []).length > 0) {
      const ts = d.adsTeam.reduce((a: number, r: any) => a + n(r.spend), 0);
      const tm = d.adsTeam.reduce((a: number, r: any) => a + n(r.mess), 0);
      mkSheet('Ads - Tổng quan',
        ['Thị trường', 'Nền tảng', 'Team', 'Chi phí (VNĐ)', 'Tin nhắn', 'Hiển thị', 'CPMess', 'Đánh giá'],
        [12, 12, 18, 16, 12, 14, 12, 14],
        d.adsTeam.map((r: any) => {
          const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [this.isGlobal(r.team) ? 'Global' : 'Việt Nam', r.platform || '', r.team || 'N/A',
            n(r.spend), n(r.mess), n(r.impr), cpm,
            cpm <= 18000 ? 'Xuất sắc' : cpm <= 25000 ? 'Tốt' : cpm <= 40000 ? 'Trung bình' : 'Cần tối ưu'];
        }), '1E3A5F');
    }

    // Sheet 2: Ads by camp type
    if ((d.adsCamps || []).length > 0) {
      const campMap: Record<string, { sp: number; ms: number; cnt: number }> = {};
      for (const c of d.adsCamps) {
        const ct = this.campType(c);
        if (!campMap[ct]) campMap[ct] = { sp: 0, ms: 0, cnt: 0 };
        campMap[ct].sp += n(c.spend); campMap[ct].ms += n(c.mess); campMap[ct].cnt++;
      }
      mkSheet('Ads - Loại camp',
        ['Loại camp', 'Số campaign', 'Chi phí', 'Tin nhắn', 'CPMess', 'Đánh giá'],
        [14, 14, 16, 12, 12, 14],
        Object.entries(campMap).map(([ct, v]) => {
          const cpm = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
          return [ct, v.cnt, v.sp, v.ms, cpm, cpm <= 18000 ? 'Xuất sắc' : cpm <= 25000 ? 'Tốt' : cpm <= 40000 ? 'Trung bình' : 'Cần tối ưu'];
        }), '1E3A5F');
    }

    // Sheet 3: Campaign chi tiết
    if ((d.adsCamps || []).length > 0) {
      mkSheet('Ads - Campaign chi tiết',
        ['Campaign', 'Loại', 'Content', 'Team', 'Chi phí', 'Tin nhắn', 'CPMess'],
        [40, 12, 10, 16, 14, 12, 12],
        d.adsCamps.map((r: any) => {
          const cpm = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [(r.campaign_name || '').slice(0, 50), this.campType(r), r.content_type || '', r.team || 'N/A', n(r.spend), n(r.mess), cpm];
        }), '2D6A9F');
    }

    // Sheet 4: Traffic by team
    if ((d.trafficTeam || []).length > 0) {
      mkSheet('Traffic - Theo team',
        ['Thị trường', 'Nền tảng', 'Team', 'Lượt xem', 'Followers', 'Likes', 'Số video', 'Số kênh'],
        [12, 12, 18, 14, 14, 12, 10, 10],
        d.trafficTeam.map((r: any) => [
          this.isGlobal(r.team) ? 'Global' : 'Việt Nam',
          r.platform || '', r.team || 'N/A',
          n(r.views), n(r.followers), n(r.likes), n(r.videos), n(r.channels),
        ]), '357A7A');
    }

    // Sheet 5: Content A1-A5
    if ((d.contentTypes || []).length > 0) {
      mkSheet('Traffic - Content A1-A5',
        ['Loại', 'Nền tảng', 'Team', 'Số video', 'Tổng views', 'Views/Video'],
        [8, 12, 18, 10, 14, 12],
        d.contentTypes.map((r: any) => {
          const vids = n(r.videos);
          return [r.ct || '', r.platform || '', r.team || 'N/A', vids, n(r.views), vids > 0 ? Math.round(n(r.views) / vids) : 0];
        }), '2D6A9F');
    }

    // Sheet 6: Top SKU
    if ((d.topSkus || []).length > 0) {
      mkSheet('Traffic - Top SKU',
        ['SKU', 'Số video', 'Tổng views', 'Các team'],
        [12, 10, 14, 30],
        d.topSkus.map((r: any) => [
          r.sku || '',
          n(r.videos),
          n(r.views),
          Array.isArray(r.teams) ? r.teams.filter(Boolean).join(', ') : '',
        ]), '9B7D4B');
    }

    // Sheet 7+8: Top videos
    if ((d.topViews || []).length > 0) {
      mkSheet('Top Lượt xem',
        ['#', 'Tiêu đề', 'Kênh', 'Team', 'Nền tảng', 'Lượt xem', 'Likes', 'Bình luận'],
        [4, 40, 20, 16, 10, 12, 8, 10],
        d.topViews.map((r: any, i: number) => [
          i + 1, (r.title || '').slice(0, 50), r.channel_name || '', r.team || '', r.platform || '',
          n(r.views), n(r.likes), n(r.comments),
        ]), '1E3A5F');
    }
    if ((d.topCmts || []).length > 0) {
      mkSheet('Top Bình luận',
        ['#', 'Tiêu đề', 'Kênh', 'Team', 'Bình luận', 'Lượt xem'],
        [4, 40, 20, 16, 10, 12],
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

  // ══════════════════════════════════════════════════════════════════════════
  // PERIOD REPORT — Quý / 6 tháng / Năm
  // ══════════════════════════════════════════════════════════════════════════

  private async sendPeriodReport(
    bot: TelegramBot,
    chatId: string,
    allMonths: MonthKey[],
    periodLabel: string,
  ) {
    const lockedMonths = await this.getLockedMonths(allMonths);

    if (lockedMonths.length === 0) {
      const first = allMonths[0];
      await bot.sendMessage(chatId,
        `📊 <b>${periodLabel}</b>\n\n` +
        `⏳ Chưa có tháng nào trong kỳ này được chốt dữ liệu.\n` +
        `Dữ liệu sẽ sẵn sàng từ ngày <b>${this.lockDateLabel(first.year, first.month)}</b> trở đi.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const missing = allMonths.filter(
      m => !lockedMonths.some(l => l.year === m.year && l.month === m.month),
    );

    const [trafficRows, adsRows] = await Promise.all([
      this.qPeriodTraffic(lockedMonths),
      this.qPeriodAds(lockedMonths),
    ]);

    // Gửi text tóm tắt trước
    await bot.sendMessage(
      chatId,
      this.buildPeriodText(lockedMonths, missing, trafficRows, adsRows, periodLabel),
      { parse_mode: 'HTML' },
    );

    // Gửi DOCX đầy đủ
    try {
      const buf = await this.buildPeriodDocx(lockedMonths, missing, trafficRows, adsRows, periodLabel);
      const slug = periodLabel.toLowerCase()
        .replace(/\s+/g, '-').replace(/[\/\\]/g, '-').replace(/[^a-z0-9\-]/g, '');
      await bot.sendDocument(chatId, buf,
        { caption: `📝 ${periodLabel} — DOCX đầy đủ` },
        { filename: `bao-cao-${slug}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      );
    } catch (e) {
      this.logger.error(`[Period DOCX] ${e.message}`);
      await bot.sendMessage(chatId, `⚠️ Không tạo được file DOCX: ${e.message}`);
    }
  }

  // ── Period: Text tóm tắt ──────────────────────────────────────────────────

  private buildPeriodText(
    lockedMonths: MonthKey[],
    missingMonths: MonthKey[],
    trafficRows: any[],
    adsRows: any[],
    periodLabel: string,
  ): string {
    const n = this.n.bind(this);
    const f = this.f.bind(this);

    // Tổng hợp per-month
    const mT: Record<string, { views: number; videos: number; likes: number }> = {};
    const mA: Record<string, { spend: number; mess: number }> = {};
    for (const m of lockedMonths) {
      const k = `${m.year}-${m.month}`;
      mT[k] = { views: 0, videos: 0, likes: 0 };
      mA[k] = { spend: 0, mess: 0 };
    }
    for (const r of trafficRows) {
      const k = `${r.year}-${r.month}`;
      if (mT[k]) { mT[k].views += n(r.views); mT[k].videos += n(r.videos); mT[k].likes += n(r.likes); }
    }
    for (const r of adsRows) {
      const k = `${r.year}-${r.month}`;
      if (mA[k]) { mA[k].spend += n(r.spend); mA[k].mess += n(r.mess); }
    }

    const totViews  = Object.values(mT).reduce((s, m) => s + m.views, 0);
    const totVideos = Object.values(mT).reduce((s, m) => s + m.videos, 0);
    const totSpend  = Object.values(mA).reduce((s, m) => s + m.spend, 0);
    const totMess   = Object.values(mA).reduce((s, m) => s + m.mess, 0);
    const avgCpm    = totMess > 0 ? Math.round(totSpend / totMess) : 0;

    // Diễn biến tháng + MoM %
    const trendLines = lockedMonths.map((m, i) => {
      const k    = `${m.year}-${m.month}`;
      const cur  = mT[k].views;
      const prev = i > 0 ? mT[`${lockedMonths[i - 1].year}-${lockedMonths[i - 1].month}`].views : 0;
      const pct  = prev > 0 ? ((cur - prev) / prev * 100) : 0;
      const arrow = i === 0 ? '' : pct >= 5 ? ' 📈' : pct <= -5 ? ' 📉' : ' ➡️';
      const sign  = pct >= 0 ? '+' : '';
      const mom   = i === 0 ? '' : ` (${sign}${pct.toFixed(0)}% MoM)`;
      return `  <b>T${m.month}/${m.year}</b>: ${f(cur)} views${mom}${arrow} | ${mT[k].videos} video`;
    });

    // Tháng tốt nhất
    const bestM = lockedMonths.reduce((b, m) =>
      mT[`${m.year}-${m.month}`].views > mT[`${b.year}-${b.month}`].views ? m : b,
      lockedMonths[0],
    );

    // Xu hướng tổng thể
    let trend = '';
    if (lockedMonths.length >= 2) {
      const first = mT[`${lockedMonths[0].year}-${lockedMonths[0].month}`].views;
      const last  = mT[`${lockedMonths[lockedMonths.length - 1].year}-${lockedMonths[lockedMonths.length - 1].month}`].views;
      const pct   = first > 0 ? ((last - first) / first * 100) : 0;
      trend = pct >= 0
        ? `📈 Tăng trưởng <b>+${pct.toFixed(1)}%</b> so với đầu kỳ`
        : `📉 Giảm <b>${pct.toFixed(1)}%</b> so với đầu kỳ`;
    }

    let txt = `📊 <b>${periodLabel}</b>\n`;
    txt += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (missingMonths.length) {
      txt += `⚠️ <i>Chưa chốt: ${missingMonths.map(m => `T${m.month}/${m.year}`).join(', ')}</i>\n`;
    }
    txt += `\n🎯 <b>TỔNG KỲ</b>\n`;
    txt += `  Lượt xem: <b>${f(totViews)}</b>  |  Video: <b>${f(totVideos)}</b>\n`;
    if (trend) txt += `  ${trend}\n`;
    txt += `\n📈 <b>DIỄN BIẾN THEO THÁNG</b>\n${trendLines.join('\n')}\n`;
    txt += `\n🏆 Tháng tốt nhất: <b>T${bestM.month}/${bestM.year}</b> — ${f(mT[`${bestM.year}-${bestM.month}`].views)} views\n`;
    if (totSpend > 0) {
      txt += `\n💰 <b>QUẢNG CÁO</b>\n`;
      txt += `  Chi phí: <b>${f(totSpend)} VNĐ</b>  |  Tin nhắn: <b>${f(totMess)}</b>\n`;
      txt += `  CPMess TB: <b>${f(avgCpm)} VNĐ</b> — ${this.rateLabel(avgCpm, true)}\n`;
    }
    return txt;
  }

  // ── Period: DOCX đầy đủ ───────────────────────────────────────────────────

  private async buildPeriodDocx(
    lockedMonths: MonthKey[],
    missingMonths: MonthKey[],
    trafficRows: any[],
    adsRows: any[],
    periodLabel: string,
  ): Promise<Buffer> {
    const n = this.n.bind(this);
    const f = this.f.bind(this);
    const s = this.safe.bind(this);

    // ── Palette (giống monthly) ──────────────────────────────────────────
    const DC = {
      navy:   '1E3A5F', blue:  '2D6A9F', teal:  '357A7A',
      gold:   '9B7D4B', green: '2D7D5A', red:   'B05252',
      rowAlt: 'EEF2F6',
    };

    const hCell = (text: string, bg = DC.navy) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: s(text), bold: true, color: 'FFFFFF', size: 16 })], alignment: AlignmentType.CENTER })],
      shading: { type: ShadingType.SOLID, color: bg },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });

    const dCell = (val: any, bg = 'FFFFFF', opts: { bold?: boolean; color?: string } = {}) => {
      const txt = s(val);
      // Auto-color MoM delta
      const color = opts.color
        ?? (txt.startsWith('+') ? DC.green : (txt.startsWith('-') && txt !== '—' && txt !== '-') ? DC.red : '1A2433');
      return new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: txt, size: 16, bold: opts.bold, color })], alignment: AlignmentType.CENTER })],
        shading: bg !== 'FFFFFF' ? { type: ShadingType.SOLID, color: bg } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
      });
    };

    const mkTable = (headers: string[], rows: any[][], hColor: string) => new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: headers.map(h => hCell(h, hColor)), tableHeader: true }),
        ...rows.map((row, i) => new TableRow({
          children: row.map(cell => dCell(cell, i % 2 === 0 ? DC.rowAlt : 'FFFFFF')),
        })),
      ],
    });

    const h1 = (text: string, color = DC.navy) => new Paragraph({
      children: [new TextRun({ text, bold: true, size: 28, color })],
      spacing: { before: 280, after: 120 },
    });
    const h2 = (text: string) => new Paragraph({
      children: [new TextRun({ text, bold: true, size: 22, color: '374151' })],
      spacing: { before: 180, after: 80 },
    });
    const para = (text: string) => new Paragraph({
      children: [new TextRun({ text: s(text), size: 18 })],
      spacing: { after: 80 },
    });
    const spacer = () => new Paragraph({ text: '', spacing: { after: 100 } });

    // ── Tổng hợp dữ liệu ────────────────────────────────────────────────
    const mT: Record<string, { views: number; videos: number; likes: number; comments: number }> = {};
    const mA: Record<string, { spend: number; mess: number }> = {};
    const platViews: Record<string, number> = {};
    const teamViews: Record<string, number> = {};
    const teamAds:   Record<string, { spend: number; mess: number }> = {};

    for (const m of lockedMonths) {
      const k = `${m.year}-${m.month}`;
      mT[k] = { views: 0, videos: 0, likes: 0, comments: 0 };
      mA[k] = { spend: 0, mess: 0 };
    }
    for (const r of trafficRows) {
      const k = `${r.year}-${r.month}`;
      if (mT[k]) {
        mT[k].views    += n(r.views);
        mT[k].videos   += n(r.videos);
        mT[k].likes    += n(r.likes);
        mT[k].comments += n(r.comments);
      }
      const plat = (r.platform || 'unknown').toLowerCase();
      platViews[plat] = (platViews[plat] || 0) + n(r.views);
      const team = r.team || 'N/A';
      teamViews[team] = (teamViews[team] || 0) + n(r.views);
    }
    for (const r of adsRows) {
      const k = `${r.year}-${r.month}`;
      if (mA[k]) { mA[k].spend += n(r.spend); mA[k].mess += n(r.mess); }
      const team = r.team || 'N/A';
      if (!teamAds[team]) teamAds[team] = { spend: 0, mess: 0 };
      teamAds[team].spend += n(r.spend);
      teamAds[team].mess  += n(r.mess);
    }

    const totViews  = Object.values(mT).reduce((s, m) => s + m.views, 0);
    const totVideos = Object.values(mT).reduce((s, m) => s + m.videos, 0);
    const totSpend  = Object.values(mA).reduce((s, m) => s + m.spend, 0);
    const totMess   = Object.values(mA).reduce((s, m) => s + m.mess, 0);
    const avgCpm    = totMess > 0 ? Math.round(totSpend / totMess) : 0;

    // Helper tính MoM delta string
    const momDelta = (cur: number, prev: number): string => {
      if (!prev || !cur) return '—';
      const pct = ((cur - prev) / prev * 100);
      return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    };

    // Xu hướng tổng thể
    const firstViews = mT[`${lockedMonths[0].year}-${lockedMonths[0].month}`].views;
    const lastViews  = mT[`${lockedMonths[lockedMonths.length - 1].year}-${lockedMonths[lockedMonths.length - 1].month}`].views;
    const overallPct = firstViews > 0 ? ((lastViews - firstViews) / firstViews * 100) : 0;

    const bestM = lockedMonths.reduce((b, m) =>
      mT[`${m.year}-${m.month}`].views > mT[`${b.year}-${b.month}`].views ? m : b,
      lockedMonths[0],
    );

    // ── Xây dựng nội dung document ───────────────────────────────────────
    const children: any[] = [];

    // Cover
    children.push(new Paragraph({
      children: [new TextRun({ text: periodLabel, bold: true, size: 44, color: DC.navy })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `VCB Studio  |  ${new Date().toLocaleString('vi-VN')}`, size: 18, color: '888888' })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: `Dữ liệu chốt: ${lockedMonths.map(m => `T${m.month}/${m.year}`).join(', ')}` +
              (missingMonths.length ? `  |  Chưa chốt: ${missingMonths.map(m => `T${m.month}/${m.year}`).join(', ')}` : ''),
        size: 16, color: missingMonths.length ? 'B05252' : '2D7D5A', italics: true,
      })],
      alignment: AlignmentType.CENTER, spacing: { after: 240 },
    }));

    // ─ Section 1: Tổng quan kỳ ─────────────────────────────────────────
    children.push(h1('1. TỔNG QUAN KỲ', DC.navy));
    children.push(mkTable(
      ['Chỉ số', 'Giá trị', 'Ghi chú'],
      [
        ['Tổng lượt xem', f(totViews),
          `${lockedMonths.length}/${lockedMonths.length + missingMonths.length} tháng có dữ liệu`],
        ['Tổng video', f(totVideos), ''],
        ['Xu hướng tổng thể',
          (overallPct >= 0 ? '+' : '') + overallPct.toFixed(1) + '%',
          `T${lockedMonths[0].month} → T${lockedMonths[lockedMonths.length - 1].month}`],
        ['Tháng tốt nhất',
          `T${bestM.month}/${bestM.year}`,
          f(mT[`${bestM.year}-${bestM.month}`].views) + ' views'],
        ...(totSpend > 0 ? [
          ['Tổng chi phí QC', f(totSpend) + ' VNĐ', ''],
          ['CPMess trung bình', f(avgCpm) + ' VNĐ', this.rateLabel(avgCpm)],
        ] : []),
      ],
      DC.navy,
    ));
    children.push(spacer());

    // ─ Section 2: Diễn biến từng tháng ────────────────────────────────
    children.push(h1('2. DIỄN BIẾN TỪNG THÁNG', DC.blue));

    // 2a. Traffic MoM
    children.push(h2('2a. Traffic (Lượt xem)'));
    children.push(mkTable(
      ['Tháng', 'Lượt xem', 'Thay đổi (MoM)', 'Video', 'Likes'],
      lockedMonths.map((m, i) => {
        const k    = `${m.year}-${m.month}`;
        const prev = i > 0 ? mT[`${lockedMonths[i - 1].year}-${lockedMonths[i - 1].month}`].views : 0;
        return [
          `Tháng ${m.month}/${m.year}`,
          f(mT[k].views),
          i > 0 ? momDelta(mT[k].views, prev) : '(đầu kỳ)',
          f(mT[k].videos),
          f(mT[k].likes),
        ];
      }),
      DC.teal,
    ));
    children.push(spacer());

    // 2b. Ads MoM (nếu có)
    if (totSpend > 0) {
      children.push(h2('2b. Quảng cáo (Chi phí & CPMess)'));
      children.push(mkTable(
        ['Tháng', 'Chi phí', 'Thay đổi', 'Tin nhắn', 'CPMess', 'Thay đổi CPM'],
        lockedMonths.map((m, i) => {
          const k      = `${m.year}-${m.month}`;
          const prevK  = i > 0 ? `${lockedMonths[i - 1].year}-${lockedMonths[i - 1].month}` : null;
          const curCpm = mA[k].mess > 0 ? Math.round(mA[k].spend / mA[k].mess) : 0;
          const prvCpm = prevK && mA[prevK].mess > 0 ? Math.round(mA[prevK].spend / mA[prevK].mess) : 0;
          return [
            `Tháng ${m.month}/${m.year}`,
            f(mA[k].spend) + ' VNĐ',
            prevK ? momDelta(mA[k].spend, mA[prevK].spend) : '(đầu kỳ)',
            f(mA[k].mess),
            f(curCpm) + ' VNĐ',
            prevK && prvCpm > 0 ? momDelta(curCpm, prvCpm) : '—',
          ];
        }),
        DC.blue,
      ));
      children.push(spacer());
    }

    // ─ Section 3: Phân tích nền tảng ───────────────────────────────────
    if (Object.keys(platViews).length > 0) {
      children.push(h1('3. PHÂN TÍCH THEO NỀN TẢNG', DC.teal));
      children.push(mkTable(
        ['Nền tảng', 'Tổng views', 'Tỷ trọng'],
        Object.entries(platViews)
          .sort(([, a], [, b]) => b - a)
          .map(([plat, views]) => [
            plat,
            f(views),
            totViews > 0 ? ((views / totViews) * 100).toFixed(1) + '%' : '0%',
          ]),
        DC.teal,
      ));
      children.push(spacer());
    }

    // ─ Section 4: Xếp hạng team ────────────────────────────────────────
    if (Object.keys(teamViews).length > 0) {
      children.push(h1('4. XẾP HẠNG TEAM (TRAFFIC)', DC.gold));
      children.push(mkTable(
        ['#', 'Team', 'Thị trường', 'Tổng views', '% Tổng kỳ'],
        Object.entries(teamViews)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([team, views], i) => [
            String(i + 1),
            team,
            this.isGlobal(team) ? 'Global' : 'Việt Nam',
            f(views),
            totViews > 0 ? ((views / totViews) * 100).toFixed(1) + '%' : '0%',
          ]),
        DC.gold,
      ));
      children.push(spacer());
    }

    // ─ Section 5: Quảng cáo theo team ──────────────────────────────────
    if (Object.keys(teamAds).length > 0) {
      children.push(h1('5. QUẢNG CÁO THEO TEAM', DC.blue));
      children.push(mkTable(
        ['Team', 'Thị trường', 'Tổng chi phí', 'Tin nhắn', 'CPMess TB', 'Đánh giá'],
        Object.entries(teamAds)
          .sort(([, a], [, b]) => b.spend - a.spend)
          .map(([team, v]) => {
            const cpm = v.mess > 0 ? Math.round(v.spend / v.mess) : 0;
            return [
              team,
              this.isGlobal(team) ? 'Global' : 'Việt Nam',
              f(v.spend) + ' VNĐ',
              f(v.mess),
              f(cpm) + ' VNĐ',
              this.rateLabel(cpm),
            ];
          }),
        DC.blue,
      ));
      children.push(spacer());
    }

    // ─ Section 6: Nhận xét & Đề xuất ───────────────────────────────────
    children.push(h1('6. NHẬN XÉT & ĐỀ XUẤT', DC.navy));
    para(''); // spacing

    if (lockedMonths.length >= 2) {
      children.push(para(
        `• Xu hướng tổng thể: ${overallPct >= 0 ? '📈 Tăng trưởng' : '📉 Giảm'} ` +
        `${Math.abs(overallPct).toFixed(1)}% từ T${lockedMonths[0].month} đến T${lockedMonths[lockedMonths.length - 1].month}/${lockedMonths[lockedMonths.length - 1].year}.`,
      ));
    }
    children.push(para(
      `• Tháng tốt nhất kỳ này: Tháng ${bestM.month}/${bestM.year} với ${f(mT[`${bestM.year}-${bestM.month}`].views)} views.`,
    ));
    const topPlat = Object.entries(platViews).sort(([, a], [, b]) => b - a)[0];
    if (topPlat) {
      children.push(para(
        `• Nền tảng dẫn đầu: ${topPlat[0]} (${f(topPlat[1])} views — ${totViews > 0 ? ((topPlat[1] / totViews) * 100).toFixed(1) : 0}% tổng kỳ).`,
      ));
    }
    if (avgCpm > 0) {
      children.push(para(`• CPMess trung bình kỳ: ${f(avgCpm)} VNĐ — ${this.rateLabel(avgCpm)}.`));
    }
    children.push(para('• Đề xuất: Duy trì nền tảng & content type dẫn đầu, review team có CPMess cao, lên kế hoạch nội dung cho kỳ tới.'));

    const doc = new Document({
      sections: [{ children }],
      styles: { default: { document: { run: { font: 'Calibri', size: 18 } } } },
    });
    return Packer.toBuffer(doc);
  }

  // ── DOCX ─── đầy đủ tất cả sections ──────────────────────────────────────────

  private async sendDocx(bot: TelegramBot, chatId: string, d: any, year: number, month: number) {
    // Báo cáo đầy đủ chỉ gửi khi dữ liệu tháng đã được chốt
    const locked = await this.isSnapshotLocked(year, month);
    if (!locked) {
      await bot.sendMessage(chatId,
        `📝 <b>DOCX Báo cáo tháng ${month}/${year}</b>\n\n` +
        `⏳ Dữ liệu tháng ${month}/${year} chưa được chốt.\n` +
        `Báo cáo đầy đủ sẽ được gửi sau khi dữ liệu được khóa vào ngày <b>${this.lockDateLabel(year, month)}</b>.\n\n` +
        `💡 Hỏi chatbot AI để xem dữ liệu live tháng này.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const n = this.n.bind(this);
    const f = this.f.bind(this);
    const s = this.safe.bind(this);

    // ── DOCX colors (muted, professional palette) ─────────────────────────
    // Primary header: deep navy  | Alt row: light blue-gray
    const DC = {
      navy:    '1E3A5F',  // primary dark
      blue:    '2D6A9F',  // calm blue (section 1)
      teal:    '357A7A',  // muted teal (section 2 traffic)
      gold:    '9B7D4B',  // warm bronze
      rowAlt:  'EEF2F6',  // light blue-gray row
    };

    // Cell helpers — dùng String() để tránh lỗi khi value là bigint/number
    const hCell = (text: string, bg = DC.navy) => new TableCell({
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
          children: row.map(cell => dCell(cell, i % 2 === 0 ? DC.rowAlt : 'FFFFFF')),
        })),
      ],
    });

    const h1 = (text: string, color = DC.navy) => new Paragraph({
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
      children: [new TextRun({ text: `BÁO CÁO THÁNG ${month}/${year}`, bold: true, size: 36, color: DC.navy })],
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

      children.push(h1('1. QUẢNG CÁO — TỔNG QUAN'));
      children.push(para(`Tổng chi phí: ${f(ts)} VNĐ`));
      children.push(para(`  Việt Nam: ${f(vnS)} VNĐ  |  Global: ${f(glS)} VNĐ`));
      children.push(para(`Tin nhắn (Mess): ${f(tm)}  |  CPMess: ${f(cpm)} VNĐ`));
      children.push(para(`Đánh giá: ${cpm <= 18000 ? 'Xuất sắc (<18K)' : cpm <= 25000 ? 'Tốt (18-25K)' : cpm <= 40000 ? 'Trung bình (25-40K)' : 'Cần tối ưu (>40K)'}`));
      children.push(para(`Like Page: ${f(tl)}`));
      children.push(para('Benchmark: CPMess <18K = Xuất sắc | 18-25K = Tốt | 25-40K = Trung bình | >40K = Cần tối ưu'));
      children.push(spacer());

      // Table: By market
      const mktData: Record<string, { sp: number; ms: number }> = { 'Việt Nam': { sp: 0, ms: 0 }, 'Global': { sp: 0, ms: 0 } };
      for (const r of d.adsTeam) { const mk = this.isGlobal(r.team) ? 'Global' : 'Việt Nam'; mktData[mk].sp += n(r.spend); mktData[mk].ms += n(r.mess); }
      children.push(h2('1a. Phân tích theo thị trường'));
      children.push(mkTable(
        ['Thị trường', 'Chi phí', 'Tin nhắn', 'CPMess', '% Chi phí', 'Đánh giá'],
        Object.entries(mktData).map(([mk, v]) => {
          const c = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
          return [mk, f(v.sp) + ' VNĐ', f(v.ms), f(c), ts > 0 ? ((v.sp / ts) * 100).toFixed(1) + '%' : '0%',
            c <= 18000 ? 'Xuất sắc' : c <= 25000 ? 'Tốt' : c <= 40000 ? 'Trung bình' : 'Cần tối ưu'];
        }), DC.blue));
      children.push(spacer());

      // Table: By camp type
      if ((d.adsCamps || []).length > 0) {
        const cm: Record<string, { sp: number; ms: number; cnt: number }> = {};
        for (const c of d.adsCamps) { const ct = this.campType(c); if (!cm[ct]) cm[ct] = { sp: 0, ms: 0, cnt: 0 }; cm[ct].sp += n(c.spend); cm[ct].ms += n(c.mess); cm[ct].cnt++; }
        children.push(h2('1b. Phân tích theo loại camp'));
        children.push(mkTable(
          ['Loại camp', 'Số campaign', 'Chi phí', 'Tin nhắn', 'CPMess'],
          Object.entries(cm).map(([ct, v]) => [ct, String(v.cnt), f(v.sp) + ' VNĐ', f(v.ms), f(v.ms > 0 ? Math.round(v.sp / v.ms) : 0)]),
          DC.navy));
        children.push(spacer());
      }

      // Table: By team
      children.push(h2('1c. Chi tiết theo team'));
      children.push(mkTable(
        ['Thị trường', 'Nền tảng', 'Team', 'Chi phí', 'Tin nhắn', 'Hiển thị', 'CPMess', 'Đánh giá'],
        d.adsTeam.map((r: any) => {
          const c = n(r.mess) > 0 ? Math.round(n(r.spend) / n(r.mess)) : 0;
          return [this.isGlobal(r.team) ? 'Global' : 'Việt Nam', r.platform || '', r.team || 'N/A',
            f(r.spend) + ' VNĐ', f(r.mess), f(r.impr), f(c),
            c <= 18000 ? 'Xuất sắc' : c <= 25000 ? 'Tốt' : c <= 40000 ? 'Trung bình' : 'Cần tối ưu'];
        }), DC.navy));
      children.push(spacer());
    }

    // ─── Section 2: Traffic ───
    if ((d.trafficTeam || []).length > 0) {
      const tv = d.trafficTeam.reduce((a: number, r: any) => a + n(r.views), 0);
      const vnV = d.trafficTeam.filter((r: any) => !this.isGlobal(r.team)).reduce((a: number, r: any) => a + n(r.views), 0);
      const totalVids = d.trafficTeam.reduce((a: number, r: any) => a + n(r.videos), 0);

      children.push(h1('2. TRAFFIC TỰ NHIÊN', DC.teal));
      children.push(para(`Tổng lượt xem: ${f(tv)}`));
      children.push(para(`  Việt Nam: ${f(vnV)}  |  Global: ${f(tv - vnV)}`));
      children.push(para(`Tổng video: ${f(totalVids)}`));
      children.push(spacer());

      children.push(h2('2a. Chi tiết theo team & nền tảng'));
      children.push(mkTable(
        ['Thị trường', 'Nền tảng', 'Team', 'Lượt xem', 'Followers', 'Số video', 'Likes'],
        d.trafficTeam.map((r: any) => [
          this.isGlobal(r.team) ? 'Global' : 'Việt Nam',
          r.platform || '', r.team || 'N/A',
          f(r.views), f(r.followers), f(r.videos), f(r.likes),
        ]), DC.teal));
      children.push(spacer());

      // Content types
      if ((d.contentTypes || []).length > 0) {
        const ctMap: Record<string, { v: number; vw: number }> = {};
        for (const r of d.contentTypes) { if (!ctMap[r.ct]) ctMap[r.ct] = { v: 0, vw: 0 }; ctMap[r.ct].v += n(r.videos); ctMap[r.ct].vw += n(r.views); }
        children.push(h2('2b. Content A1-A5'));
        children.push(para(Object.entries(ctMap).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}: ${v.v} video | ${f(v.vw)} views`).join('   ')));
        children.push(mkTable(
          ['Loại content', 'Nền tảng', 'Team', 'Số video', 'Tổng views'],
          d.contentTypes.slice(0, 30).map((r: any) => [r.ct || '', r.platform || '', r.team || 'N/A', n(r.videos), f(r.views)]),
          DC.blue));
        children.push(spacer());
      }

      // Top SKU
      if ((d.topSkus || []).length > 0) {
        children.push(h2('2c. Top 10 SKU nhiều video nhất'));
        children.push(mkTable(
          ['SKU', 'Số video', 'Tổng views', 'Các team'],
          d.topSkus.map((r: any) => [
            r.sku || '',
            String(n(r.videos)),
            f(r.views),
            Array.isArray(r.teams) ? r.teams.filter(Boolean).slice(0, 3).join(', ') : '',
          ]), DC.gold));
        children.push(spacer());
      }

      // Top views
      if ((d.topViews || []).length > 0) {
        children.push(h2('2d. Top 10 video nhiều lượt xem nhất'));
        children.push(mkTable(
          ['#', 'Tiêu đề', 'Kênh', 'Team', 'Lượt xem', 'Likes', 'Bình luận'],
          d.topViews.map((r: any, i: number) => [
            String(i + 1), (r.title || '').slice(0, 35),
            (r.channel_name || '').slice(0, 18), r.team || '',
            f(r.views), f(r.likes), f(r.comments),
          ]), DC.navy));
        children.push(spacer());
      }

      // Top comments
      if ((d.topCmts || []).length > 0) {
        children.push(h2('2e. Top 10 video nhiều bình luận nhất'));
        children.push(mkTable(
          ['#', 'Tiêu đề', 'Kênh', 'Team', 'Bình luận', 'Lượt xem'],
          d.topCmts.map((r: any, i: number) => [
            String(i + 1), (r.title || '').slice(0, 35),
            (r.channel_name || '').slice(0, 18), r.team || '',
            f(r.comments), f(r.views),
          ]), DC.navy));
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
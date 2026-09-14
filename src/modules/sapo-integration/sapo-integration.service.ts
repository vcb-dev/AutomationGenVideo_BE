import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  SapoOrder,
  SapoOrdersResponse,
  SapoRevenueEntry,
  SapoRevenuePreviewResponse,
} from './sapo-integration.types';

@Injectable()
export class SapoIntegrationService {
  private readonly logger = new Logger(SapoIntegrationService.name);
  private readonly storeAlias: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly accessToken: string;
  private readonly apiUrlOverride: string;
  private readonly defaultLocationId?: number;
  private readonly financialStatus?: string;
  private readonly orderStatus?: string;
  private readonly previewCache = new Map<string, { data: SapoRevenuePreviewResponse; expiry: number }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.storeAlias = (
      this.configService.get<string>('SAPO_STORE') ||
      this.configService.get<string>('SAPO_STORE_ALIAS') ||
      ''
    ).trim();
    this.apiKey = (this.configService.get<string>('SAPO_API_KEY') || '').trim();
    this.apiSecret = (this.configService.get<string>('SAPO_API_SECRET') || '').trim();
    this.accessToken = (this.configService.get<string>('SAPO_ACCESS_TOKEN') || '').trim();
    this.apiUrlOverride = (this.configService.get<string>('SAPO_API_URL') || '').trim();
    const locId = this.configService.get<string>('SAPO_LOCATION_ID');
    this.defaultLocationId = locId ? parseInt(locId, 10) : undefined;
    this.financialStatus = this.configService.get<string>('SAPO_FINANCIAL_STATUS') || undefined;
    this.orderStatus = this.configService.get<string>('SAPO_ORDER_STATUS') || undefined;
  }

  /**
   * Kiểm tra xem hệ thống đã được cấu hình thông tin Sapo API chưa.
   */
  isConfigured(): boolean {
    const hasAuth = Boolean(this.accessToken || (this.apiKey && this.apiSecret));
    const hasEndpoint = Boolean(this.storeAlias || this.apiUrlOverride);
    return Boolean(hasAuth && hasEndpoint);
  }

  private getBaseUrl(): string {
    if (this.apiUrlOverride) {
      return this.apiUrlOverride.replace(/\/+$/, '');
    }
    return `https://${this.storeAlias}.mysapo.net/admin`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.apiKey && this.apiSecret) {
      const basic = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    } else if (this.accessToken) {
      headers['X-Sapo-Access-Token'] = this.accessToken;
    }

    return headers;
  }

  /**
   * Gọi Sapo API để lấy danh sách đơn hàng trong một ngày (theo giờ Việt Nam).
   * Hỗ trợ phân trang để lấy toàn bộ đơn hàng trong ngày.
   */
  async fetchOrders(dateStr: string): Promise<SapoOrder[]> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `[Sapo] Chưa cấu hình SAPO_STORE_ALIAS hoặc SAPO_ACCESS_TOKEN. Vui lòng cấu hình trong file .env`,
      );
      return [];
    }

    const minTime = `${dateStr}T00:00:00+07:00`;
    const maxTime = `${dateStr}T23:59:59+07:00`;
    const baseUrl = this.getBaseUrl();
    const allOrders: SapoOrder[] = [];
    const limit = 250;
    let page = 1;
    const maxPages = 20; // Giới hạn tối đa 5000 đơn/ngày

    while (page <= maxPages) {
      try {
        const url = `${baseUrl}/orders.json`;
        const params: Record<string, any> = {
          created_on_min: minTime,
          created_on_max: maxTime,
          limit,
          page,
        };

        if (this.financialStatus) {
          params.financial_status = this.financialStatus;
        }
        if (this.orderStatus) {
          params.status = this.orderStatus;
        }
        if (this.defaultLocationId) {
          params.location_id = this.defaultLocationId;
        }

        const res = await firstValueFrom(
          this.httpService.get<SapoOrdersResponse>(url, {
            headers: this.getHeaders(),
            params,
            timeout: 15000,
          }),
        );

        const orders = res.data?.orders || [];
        if (!orders || orders.length === 0) {
          break;
        }

        allOrders.push(...orders);

        if (orders.length < limit) {
          break;
        }

        page++;
      } catch (err: any) {
        this.logger.error(
          `[Sapo] Lỗi khi gọi Sapo orders API (trang ${page}): ${err?.response?.data?.message || err?.message}`,
        );
        break;
      }
    }

    this.logger.log(`[Sapo] Đã tải ${allOrders.length} đơn hàng ngày ${dateStr} từ Sapo.`);
    return allOrders;
  }

  /**
   * Phân loại đơn hàng Sapo vào nền tảng (Platform) và Kênh (Channel).
   */
  detectPlatformAndChannel(order: SapoOrder): {
    platform: 'fb' | 'ig' | 'tiktok' | 'yt' | 'thread' | 'zalo' | 'other';
    channelName: string;
    team?: string;
  } {
    const rawSource = (order.source_name || order.channel || '').toLowerCase();
    const rawTags = (order.tags || '').toLowerCase();
    const rawNote = (order.note || '').toLowerCase();
    const tagsList = (order.tags || '').split(',').map((t: string) => t.trim());
    const channelDef = (order as any)?.channel_definition || {};
    const mainName = (channelDef.main_name || '').toLowerCase();
    const subName = (channelDef.sub_name || '').toLowerCase();
    const alias = (channelDef.alias || '').toLowerCase();

    // 1. Trích xuất Team từ tags / note
    let team: string | undefined;
    let channelName = '';

    const allTagTexts = `${order.tags || ''} ${order.note || ''}`;
    const bracketMatches = allTagTexts.match(/\[([^\]]+)\]/g) || [];

    for (const rawBracket of bracketMatches) {
      const inner = rawBracket.slice(1, -1).trim();
      if (/^(team\s+|đồ da|đá quý)/i.test(inner) || /team/i.test(inner)) {
        team = inner;
      }
      const chMatch = inner.match(/^(?:kênh|page|fanpage|acc|tk|account):?\s*(.*)$/i);
      if (chMatch && chMatch[1]) {
        channelName = chMatch[1].trim();
      }
    }

    const isOmni = mainName === 'chat omniai' || rawTags.includes('chatomniai');
    const isDirectSale = rawSource === 'pos' || rawTags.includes('bán trực tiếp');

    // Đơn bán trực tiếp / POS tại quầy (không bán qua Chat OmniAI) -> xếp vào nhóm 'other' (bán trực tiếp)
    if (isDirectSale && !isOmni) {
      return {
        platform: 'other',
        channelName: 'Bán trực tiếp',
        team,
      };
    }

    // 2. Trích xuất tên Channel/Page từ Sapo channel_definition và tags
    const branchName = channelDef.branch_name || '';
    if (!channelName && branchName && !['facebook', 'instagram', 'tiktokshop', 'chat omniai', 'zalo', 'shopee'].includes(branchName.toLowerCase())) {
      channelName = branchName;
    }

    if (!channelName) {
      for (const t of tagsList) {
        if (t.startsWith('page_') && !t.startsWith('page_id_')) {
          channelName = t.replace(/^page_/, '').trim();
          break;
        }
        if (t.toLowerCase().startsWith('tiktok_business_') && !t.toLowerCase().startsWith('tiktok_business_id_')) {
          channelName = t.replace(/^tiktok_business_/i, '').trim();
          break;
        }
        if (t.toLowerCase().startsWith('tiktok_') && !t.toLowerCase().startsWith('tiktok_id_')) {
          channelName = t.replace(/^tiktok_/i, '').trim();
          break;
        }
        if (t.startsWith('Zalo - ') || t.startsWith('Nguồn: Zalo')) {
          channelName = t.replace(/^Nguồn:\s*/, '').trim();
          break;
        }
      }
    }

    // 2.1 Trích xuất username TikTok từ referring_site (nếu đơn hàng đến từ TikTok Business / Ads)
    if (!channelName && (order as any)?.referring_site) {
      const ref = String((order as any).referring_site);
      const ttMatch = ref.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
      if (ttMatch) {
        channelName = '@' + ttMatch[1];
      }
    }

    // 3. Phân loại theo Platform (ưu tiên phân loại rõ ràng)
    // Sàn TMĐT khác (Shopee, Lazada, Tiki) -> other
    if (rawSource.includes('shopee') || alias === 'shopee' || mainName.includes('shopee') || (branchName && branchName.toLowerCase().includes('shopee'))) {
      return {
        platform: 'other',
        channelName: channelName || branchName || 'Shopee',
        team,
      };
    }

    // TikTok Shop / TikTok Business
    if (
      rawSource.includes('tiktok') ||
      rawSource.includes('ttshop') ||
      rawSource.includes('tts') ||
      alias === 'tiktokshop' ||
      mainName.includes('tiktok') ||
      rawTags.includes('tiktok') ||
      (channelName && channelName.toLowerCase().includes('tiktok')) ||
      ((order as any)?.referring_site && String((order as any).referring_site).includes('tiktok'))
    ) {
      return {
        platform: 'tiktok',
        channelName: channelName || 'TikTok Shop',
        team,
      };
    }

    // Instagram
    if (
      rawSource.includes('instagram') ||
      rawSource.includes('ig') ||
      alias === 'instagram' ||
      subName === 'instagram' ||
      rawTags.includes('instagram')
    ) {
      return {
        platform: 'ig',
        channelName: channelName || 'Instagram',
        team,
      };
    }

    // YouTube
    if (rawSource.includes('youtube') || rawSource.includes('yt') || alias === 'youtube' || mainName.includes('youtube')) {
      return {
        platform: 'yt',
        channelName: channelName || 'YouTube',
        team,
      };
    }

    // Threads
    if (rawSource.includes('thread') || alias === 'threads' || rawTags.includes('threads')) {
      return {
        platform: 'thread',
        channelName: channelName || 'Threads',
        team,
      };
    }

    // Zalo
    if (
      rawSource.includes('zalo') ||
      rawSource.includes('zns') ||
      alias === 'zalo' ||
      mainName.includes('zalo') ||
      rawTags.includes('zalo') ||
      (channelName && channelName.toLowerCase().includes('zalo'))
    ) {
      return {
        platform: 'zalo',
        channelName: channelName || 'Zalo',
        team,
      };
    }

    // Facebook / Fanpage / Pancake / ChatOmniAI
    if (
      subName === 'facebook' ||
      rawTags.includes('chatomniai') ||
      rawTags.includes('page_') ||
      (rawSource.includes('facebook') && !isDirectSale) ||
      (rawSource.includes('fanpage') && !isDirectSale)
    ) {
      return {
        platform: 'fb',
        channelName: channelName || 'Facebook',
        team,
      };
    }

    // Mặc định các nguồn POS, Web, Bảo hành,... -> other
    return {
      platform: 'other',
      channelName: channelName || order.source_name || 'Khác',
      team,
    };
  }

  /**
   * Trích xuất ID số nguyên chất từ URL hoặc ID (ví dụ: https://facebook.com/148888379055195 -> 148888379055195)
   */
  private extractNumericId(input?: string | null): string {
    if (!input) return '';
    const trimmed = String(input).trim();
    if (/^\d{5,}$/.test(trimmed)) {
      return trimmed;
    }
    const idInUrlMatch = trimmed.match(/(?:id=|profile\.php\?id=|\/|page_id_)(\d{5,})/i);
    if (idInUrlMatch && idInUrlMatch[1]) {
      return idInUrlMatch[1];
    }
    return trimmed;
  }

  /**
   * Chuẩn hoá tên kênh để so khớp chính xác 1:1 (bỏ khoảng trắng thừa, lowercase, giữ nguyên vẹn các từ để không nhầm lẫn giữa các page tương tự)
   */
  private normalizeExact(name?: string | null): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Tính toán doanh thu Sapo theo ngày và trả về định dạng sẵn sàng để điền vào Form báo cáo Doanh thu.
   */
  async getDailyRevenuePreview(
    dateStr: string,
    teamFilter?: string,
    emailFilter?: string,
  ): Promise<SapoRevenuePreviewResponse> {
    const cacheKey = `${dateStr}:${teamFilter || 'ALL'}:${emailFilter || 'ALL'}`;
    const cached = this.previewCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const orders = await this.fetchOrders(dateStr);

    // Helper chuẩn hóa mã platform
    const normPlat = (plat?: string): string => {
      const p = (plat || '').toLowerCase().trim();
      if (p === 'facebook') return 'fb';
      if (p === 'instagram') return 'ig';
      if (p === 'youtube') return 'yt';
      if (p === 'threads') return 'thread';
      return p;
    };

    // 1. Tải danh sách tất cả các kênh đã kết nối trong hệ thống (SocialAccount OAuth, Channel, TrackedChannel)
    const channelLookupById = new Map<string, { name: string; channelId?: string; platform: string; team?: string }>();
    const channelLookupByName = new Map<string, { name: string; channelId?: string; platform: string; team?: string }>();

    const registerChannelLookup = (pKey: string, rawName: string, rawId?: string | null, team?: string) => {
      if (!pKey || !rawName) return;
      const cleanName = rawName.trim();
      const numId = this.extractNumericId(rawId);
      const effectiveId = numId || (rawId ? String(rawId).trim() : undefined);
      const entry = { name: cleanName, channelId: effectiveId, platform: pKey, team };

      if (numId) channelLookupById.set(`${pKey}:${numId}`, entry);
      if (rawId) channelLookupById.set(`${pKey}:${rawId.toLowerCase().trim()}`, entry);

      const normName = this.normalizeExact(cleanName);
      const existing = channelLookupByName.get(`${pKey}:${normName}`);
      const existingHasNum = existing && /^\d{5,}$/.test(existing.channelId || '');
      const newHasNum = /^\d{5,}$/.test(effectiveId || '');

      // Chỉ ghi đè nếu bản ghi mới có ID số chuẩn mà bản ghi cũ chỉ có username chữ
      if (!existing || (newHasNum && !existingHasNum)) {
        channelLookupByName.set(`${pKey}:${normName}`, entry);
      }
    };

    try {
      const [socials, teamChans, tracked] = await Promise.all([
        this.prisma.socialAccount.findMany({ select: { name: true, username: true, platform: true, extra_data: true } }).catch(() => []),
        this.prisma.channel.findMany({ select: { name: true, channel_id: true, link_channel: true, platform: true, team_traffic: true, channel_team: { select: { name: true } } } }).catch(() => []),
        this.prisma.trackedChannel.findMany({ select: { display_name: true, username: true, platform: true } }).catch(() => []),
      ]);

      // Nạp theo thứ tự ưu tiên: tracked (username) -> socials (OAuth chính thức) -> teamChans (kênh team)
      for (const tc of tracked) {
        const name = (tc.display_name || tc.username || '').trim();
        const pKey = normPlat(tc.platform);
        registerChannelLookup(pKey, name, tc.username);
        if (pKey === 'tiktok' && tc.username) {
          const cleanUser = tc.username.replace(/^@/, '');
          registerChannelLookup(pKey, name, `@${cleanUser}`);
          registerChannelLookup(pKey, name, cleanUser);
        }
      }

      for (const sa of socials) {
        const name = (sa.name || sa.username || '').trim();
        const pKey = normPlat(sa.platform);
        registerChannelLookup(pKey, name, sa.username);
        if (pKey === 'tiktok') {
          if (sa.username) {
            const cleanUser = sa.username.replace(/^@/, '');
            registerChannelLookup(pKey, name, `@${cleanUser}`);
            registerChannelLookup(pKey, name, cleanUser);
            const normUser = this.normalizeExact(cleanUser);
            if (normUser && !channelLookupByName.has(`tiktok:${normUser}`)) {
              channelLookupByName.set(`tiktok:${normUser}`, { name, channelId: sa.username, platform: 'tiktok' });
            }
          }
          const link = (sa as any)?.extra_data?.link_channel;
          if (link) {
            registerChannelLookup(pKey, name, link);
            const m = link.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
            if (m) {
              registerChannelLookup(pKey, name, `@${m[1]}`);
              registerChannelLookup(pKey, name, m[1]);
              const normM = this.normalizeExact(m[1]);
              if (normM && !channelLookupByName.has(`tiktok:${normM}`)) {
                channelLookupByName.set(`tiktok:${normM}`, { name, channelId: `@${m[1]}`, platform: 'tiktok' });
              }
            }
          }
        }
      }

      for (const c of teamChans) {
        const name = (c.name || '').trim();
        const pKey = normPlat(c.platform);
        const team = (c as any)?.channel_team?.name || c.team_traffic || undefined;
        registerChannelLookup(pKey, name, c.channel_id || c.link_channel, team);
        if (pKey === 'tiktok') {
          if (c.channel_id) {
            const cleanId = c.channel_id.replace(/^@/, '');
            registerChannelLookup(pKey, name, `@${cleanId}`, team);
            registerChannelLookup(pKey, name, cleanId, team);
            const normId = this.normalizeExact(cleanId);
            if (normId && !channelLookupByName.has(`tiktok:${normId}`)) {
              channelLookupByName.set(`tiktok:${normId}`, { name, channelId: c.channel_id, platform: 'tiktok', team });
            }
          }
          if (c.link_channel) {
            registerChannelLookup(pKey, name, c.link_channel, team);
            const m = c.link_channel.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
            if (m) {
              registerChannelLookup(pKey, name, `@${m[1]}`, team);
              registerChannelLookup(pKey, name, m[1], team);
              const normM = this.normalizeExact(m[1]);
              if (normM && !channelLookupByName.has(`tiktok:${normM}`)) {
                channelLookupByName.set(`tiktok:${normM}`, { name, channelId: `@${m[1]}`, platform: 'tiktok', team });
              }
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Không thể tải danh sách kênh kết nối để đối chiếu: ${err.message}`);
    }

    interface AggregatedChannelData {
      total: bigint;
      orderCount: number;
      channelName: string;
      channelId?: string;
    }

    const platformTotals: Record<string, Map<string, AggregatedChannelData>> = {
      fb: new Map(),
      ig: new Map(),
      tiktok: new Map(),
      yt: new Map(),
      thread: new Map(),
      zalo: new Map(),
      other: new Map(),
    };

    let grandTotal = BigInt(0);
    let validOrderCount = 0;
    let unassignedOrdersCount = 0;
    let unassignedRevenue = BigInt(0);

    const normalizedTeamFilter = (teamFilter || '').trim().toLowerCase();

    for (const order of orders) {
      // Bỏ qua các đơn huỷ
      if (order.status === 'cancelled') {
        continue;
      }

      // Xác định nền tảng gốc thực tế của đơn hàng từ Sapo
      const detected = this.detectPlatformAndChannel(order);
      const targetPlat = detected.platform;

      // Trích xuất thông tin định danh từ Sapo order
      const tags = (order.tags || '').split(',').map((t: string) => t.trim());
      let pageId = (order as any)?.channel_definition?.branch_external_id || '';
      let pageName = (order as any)?.channel_definition?.branch_name || '';

      if (!pageId) {
        for (const t of tags) {
          if (t.startsWith('page_id_')) {
            pageId = t.replace(/^page_id_/, '').trim();
            break;
          }
          if (t.toLowerCase().startsWith('tiktok_business_id_')) {
            pageId = t.replace(/^tiktok_business_id_/i, '').trim();
            break;
          }
          if (t.toLowerCase().startsWith('tiktok_id_')) {
            pageId = t.replace(/^tiktok_id_/i, '').trim();
            break;
          }
        }
      }

      if (!pageName) {
        for (const t of tags) {
          if (t.startsWith('page_') && !t.startsWith('page_id_')) {
            pageName = t.replace(/^page_/, '').trim();
            break;
          }
          if (t.toLowerCase().startsWith('tiktok_business_') && !t.toLowerCase().startsWith('tiktok_business_id_')) {
            pageName = t.replace(/^tiktok_business_/i, '').trim();
            break;
          }
          if (t.toLowerCase().startsWith('tiktok_') && !t.toLowerCase().startsWith('tiktok_id_')) {
            pageName = t.replace(/^tiktok_/i, '').trim();
            break;
          }
          if (t.startsWith('Zalo - ') || t.startsWith('Nguồn: Zalo')) {
            pageName = t.replace(/^Nguồn:\s*/, '').trim();
            break;
          }
        }
      }

      if (!pageName) {
        pageName = detected.channelName;
      }

      const cleanPageId = this.extractNumericId(pageId);
      const normPageName = this.normalizeExact(pageName);

      // Khớp tự động với danh mục kênh đã kết nối (RÀNG BUỘC CHẶT CHẼ THEO ĐÚNG NỀN TẢNG targetPlat)
      let matchedChannel: { name: string; channelId?: string; platform: string; team?: string } | undefined;

      // Ưu tiên 1: Khớp chính xác ID kênh / ID page dạng số (Page ID Facebook, Shop ID TikTok, ...)
      if (cleanPageId && channelLookupById.has(`${targetPlat}:${cleanPageId}`)) {
        matchedChannel = channelLookupById.get(`${targetPlat}:${cleanPageId}`);
      }
      // Ưu tiên 2: Khớp theo ID chuỗi / Username / Handle
      if (!matchedChannel && pageId && channelLookupById.has(`${targetPlat}:${pageId.toLowerCase().trim()}`)) {
        matchedChannel = channelLookupById.get(`${targetPlat}:${pageId.toLowerCase().trim()}`);
      }
      // Ưu tiên 3: Đối với TikTok: Khớp qua link chuyển đổi đơn hàng (referring_site) hoặc handle trích xuất
      if (!matchedChannel && targetPlat === 'tiktok') {
        const refSite = String((order as any)?.referring_site || '').trim();
        if (refSite) {
          if (channelLookupById.has(`tiktok:${refSite.toLowerCase()}`)) {
            matchedChannel = channelLookupById.get(`tiktok:${refSite.toLowerCase()}`);
          } else {
            const m = refSite.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
            if (m) {
              const handle = m[1].toLowerCase();
              if (channelLookupById.has(`tiktok:@${handle}`)) {
                matchedChannel = channelLookupById.get(`tiktok:@${handle}`);
              } else if (channelLookupById.has(`tiktok:${handle}`)) {
                matchedChannel = channelLookupById.get(`tiktok:${handle}`);
              }
            }
          }
        }
        if (!matchedChannel && detected.channelName) {
          const rawHandle = detected.channelName.toLowerCase().trim();
          const cleanHandle = rawHandle.replace(/^@/, '');
          if (channelLookupById.has(`tiktok:${rawHandle}`)) {
            matchedChannel = channelLookupById.get(`tiktok:${rawHandle}`);
          } else if (channelLookupById.has(`tiktok:@${cleanHandle}`)) {
            matchedChannel = channelLookupById.get(`tiktok:@${cleanHandle}`);
          } else if (channelLookupById.has(`tiktok:${cleanHandle}`)) {
            matchedChannel = channelLookupById.get(`tiktok:${cleanHandle}`);
          }
        }
      }
      // Ưu tiên 4: Khớp chính xác 100% Tên kênh / Tên gian hàng (channelLookupByName)
      if (!matchedChannel && normPageName && channelLookupByName.has(`${targetPlat}:${normPageName}`)) {
        matchedChannel = channelLookupByName.get(`${targetPlat}:${normPageName}`);
      }
      if (!matchedChannel && detected.channelName) {
        const normDetectedName = this.normalizeExact(detected.channelName);
        if (normDetectedName && channelLookupByName.has(`${targetPlat}:${normDetectedName}`)) {
          matchedChannel = channelLookupByName.get(`${targetPlat}:${normDetectedName}`);
        }
      }

      let platform: string = targetPlat;
      let channelName: string;
      let channelId: string | undefined = cleanPageId || undefined;
      let orderTeam: string | undefined = detected.team;

      if (matchedChannel) {
        platform = matchedChannel.platform || targetPlat;
        channelName = matchedChannel.name;
        channelId = matchedChannel.channelId || cleanPageId || undefined;
        if (matchedChannel.team) orderTeam = matchedChannel.team;
      } else {
        channelName = pageName || detected.channelName;
      }

      // Đối với Facebook: Chỉ tính đơn bán được trên Page qua OmniAI hoặc có Page ID / Page Name xác định rõ
      // Các đơn Facebook chung chung không rõ Page hoặc bán tại shop -> xếp vào nhóm 'other'
      if (normPlat(platform) === 'fb' && !cleanPageId && (!channelName || channelName.toLowerCase() === 'facebook')) {
        platform = 'other';
        channelName = 'Đơn Facebook không rõ Page';
      }

      // Đối với TikTok: Chỉ tính đơn thuộc các kênh TikTok Business / Page do nhân sự/team phụ trách.
      // Các đơn TikTok Shop chung (phiên Live bán hàng của sàn không gắn với Page cụ thể) -> xếp vào nhóm 'other' (Live bán hàng)
      const rawSource = (order.source_name || order.channel || '').toLowerCase();
      const isGenericTts =
        (rawSource.includes('tiktokshop') || rawSource.includes('ttshop')) &&
        (!channelName || channelName.toLowerCase() === 'tiktok shop' || channelName.toLowerCase().includes('tiktokshop'));
      if (normPlat(platform) === 'tiktok' && !matchedChannel && isGenericTts) {
        platform = 'other';
        channelName = 'TikTok Shop (Live bán hàng)';
      }

      // Chuẩn hóa mã platform
      const normalizedPlatform = normPlat(platform);

      // Nếu có lọc team mà đơn có team khác -> bỏ qua
      if (normalizedTeamFilter && orderTeam) {
        const cleanOrderTeam = orderTeam.toLowerCase().trim();
        if (cleanOrderTeam !== normalizedTeamFilter && !cleanOrderTeam.includes(normalizedTeamFilter) && !normalizedTeamFilter.includes(cleanOrderTeam)) {
          continue;
        }
      }

      const priceRaw = Math.round(Number(order.total_price || 0));
      if (priceRaw <= 0) continue;

      const priceBig = BigInt(priceRaw);
      grandTotal += priceBig;
      validOrderCount++;

      if (normalizedPlatform === 'other' || !platformTotals[normalizedPlatform]) {
        unassignedOrdersCount++;
        unassignedRevenue += priceBig;
      } else {
        const pMap = platformTotals[normalizedPlatform];
        // Nhóm chuẩn xác theo tên kênh trên cùng nền tảng, đảm bảo không bị phân mảnh thành nhiều dòng cùng tên
        const groupKey = this.normalizeExact(channelName);
        const current = pMap.get(groupKey) || {
          total: BigInt(0),
          orderCount: 0,
          channelName,
          channelId,
        };
        const curHasNum = /^\d{5,}$/.test(current.channelId || '');
        const newHasNum = /^\d{5,}$/.test(channelId || '');
        const bestChannelId = newHasNum ? channelId : (curHasNum ? current.channelId : (channelId || current.channelId));

        pMap.set(groupKey, {
          total: current.total + priceBig,
          orderCount: current.orderCount + 1,
          channelName: current.channelName || channelName,
          channelId: bestChannelId,
        });
      }
    }

    const breakdown: Record<string, SapoRevenueEntry[]> = {};
    const revenue: Record<string, string> = {
      fb: '',
      ig: '',
      tiktok: '',
      yt: '',
      thread: '',
      zalo: '',
    };
    const channels: Record<string, string> = {
      fb: '',
      ig: '',
      tiktok: '',
      yt: '',
      thread: '',
      zalo: '',
    };

    const platformKeys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];

    for (const pKey of platformKeys) {
      const pMap = platformTotals[pKey];
      const entries: SapoRevenueEntry[] = [];
      let pSum = BigInt(0);
      const chNames: string[] = [];

      pMap.forEach((data) => {
        pSum += data.total;
        chNames.push(data.channelName);
        entries.push({
          id: Math.random().toString(36).slice(2, 9),
          value: data.total.toString(),
          channel: data.channelName,
          channelId: data.channelId,
          orderCount: data.orderCount,
        });
      });

      if (entries.length === 0) {
        // Nếu không có doanh thu cho nền tảng này, để 1 dòng trống
        entries.push({
          id: Math.random().toString(36).slice(2, 9),
          value: '',
          channel: '',
        });
        revenue[pKey] = '';
        channels[pKey] = '';
      } else {
        revenue[pKey] = pSum.toString();
        channels[pKey] = chNames.join(', ');
      }

      breakdown[pKey] = entries;
    }

    const isConfig = this.isConfigured();
    let message = `Đã tải thành công ${validOrderCount} đơn hàng từ Sapo ngày ${dateStr}.`;
    if (!isConfig) {
      message = `Chưa cấu hình SAPO_ACCESS_TOKEN hoặc SAPO_STORE_ALIAS trong .env. Hãy cấu hình để lấy dữ liệu thật từ Sapo.`;
    }

    const response: SapoRevenuePreviewResponse = {
      date: dateStr,
      totalRevenue: grandTotal.toString(),
      revenue: revenue as any,
      channels: channels as any,
      breakdown,
      orderCount: validOrderCount,
      unassignedOrdersCount,
      unassignedRevenue: unassignedRevenue.toString(),
      message,
    };

    this.previewCache.set(cacheKey, {
      data: response,
      expiry: Date.now() + 2 * 60 * 1000,
    });

    return response;
  }

  /**
   * Đồng bộ tự động doanh thu Sapo của ngày chỉ định vào cơ sở dữ liệu `revenue_reports`.
   */
  async syncDailyRevenueToDatabase(
    dateStr: string,
    team: string = 'Tổng hợp Sapo',
    submitterEmail: string = 'system@sapo.vn',
    submitterName: string = 'Sapo Sync',
  ): Promise<{ success: boolean; message: string; recordIds?: string[] }> {
    const preview = await this.getDailyRevenuePreview(dateStr, team, submitterEmail);

    if (preview.orderCount === 0 && BigInt(preview.totalRevenue) === BigInt(0)) {
      return {
        success: true,
        message: `Ngày ${dateStr} không có đơn hàng Sapo nào cần đồng bộ.`,
        recordIds: [],
      };
    }

    // Tạo các dòng lưu DB cho từng kênh / nền tảng
    const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
    const monthString = 'T' + parseInt(dateStr.split('-')[1], 10).toString();
    const platformKeys = ['fb', 'ig', 'tiktok', 'yt', 'thread', 'zalo'];
    const createdRecords: any[] = [];

    for (const pKey of platformKeys) {
      const entries = preview.breakdown[pKey] || [];
      for (const entry of entries) {
        const valDigits = (entry.value || '').replace(/\D/g, '');
        if (!valDigits) continue;

        const valBig = BigInt(valDigits);
        const recordData: any = {
          date: targetDate,
          email: submitterEmail,
          name: submitterName,
          team: team,
          channel: entry.channel || '',
          month: monthString,
          total_revenue: valBig,
        };

        if (pKey === 'fb') recordData.revenue_fb = valBig;
        else if (pKey === 'ig') recordData.revenue_ig = valBig;
        else if (pKey === 'tiktok') recordData.revenue_tiktok = valBig;
        else if (pKey === 'yt') recordData.revenue_yt = valBig;
        else if (pKey === 'thread') recordData.revenue_thread = valBig;
        else if (pKey === 'zalo') recordData.revenue_zalo = valBig;

        const created = await this.prisma.revenueReport.create({
          data: recordData,
        });
        createdRecords.push(created.id);
      }
    }

    this.logger.log(
      `[Sapo] Đã đồng bộ ${createdRecords.length} dòng doanh thu Sapo ngày ${dateStr} vào database.`,
    );

    return {
      success: true,
      message: `Đã đồng bộ ${createdRecords.length} dòng doanh thu Sapo (Tổng: ${Number(preview.totalRevenue).toLocaleString('vi-VN')} VNĐ) vào hệ thống.`,
      recordIds: createdRecords,
    };
  }
}

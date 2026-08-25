import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SapoRevenueResult {
  success: boolean;
  channel: string;
  platform?: string;
  revenue: number;
  orderCount: number;
  period: {
    from: string;
    to: string;
    label: string;
  };
  sampleOrders?: Array<{
    code: string;
    price: number;
    status: string;
    financial_status: string;
    created_on: string;
    campaign?: string;
    postId?: string;
    pageId?: string;
  }>;
  message?: string;
}

export interface PageRevenueSummary {
  pageName: string;
  pageId?: string;
  revenue: number;
  orderCount: number;
  cancelledCount: number;
  topCampaigns?: Array<{ name: string; count: number; revenue: number }>;
}

@Injectable()
export class SapoRevenueService {
  private readonly logger = new Logger(SapoRevenueService.name);

  // In-memory cache for orders by date range: key = "from_to", ttl = 60s
  private readonly orderCache = new Map<
    string,
    { timestamp: number; orders: any[] }
  >();
  private readonly CACHE_TTL_MS = 60 * 1000;

  constructor(private readonly configService: ConfigService) {}

  private getSapoConfig() {
    const apiKey =
      this.configService.get<string>('SAPO_API_KEY') ||
      '0878b4b33cde4994ab22c1aa1f772576';
    const apiSecret =
      this.configService.get<string>('SAPO_API_SECRET') ||
      '59e47b127f8c4233840efd348c5cc608';
    const store =
      this.configService.get<string>('SAPO_STORE') || 'vienchibao';
    return { apiKey, apiSecret, store };
  }

  /**
   * Tính toán khoảng thời gian theo múi giờ Việt Nam (UTC+7)
   */
  private calculateDateRange(
    dateStr?: string,
    mode: 'day' | 'month' = 'day',
  ): {
    fromUtc: string;
    toUtc: string;
    targetDateYMD: string;
    targetMonthStr: string;
    label: string;
  } {
    let year: number;
    let month: number; // 0-indexed
    let day: number;
    let targetDateYMD: string;

    const pad = (n: number) => String(n).padStart(2, '0');

    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.split('-').map(Number);
      year = parts[0];
      month = parts[1] - 1;
      day = parts[2];
      targetDateYMD = dateStr;
    } else {
      // Current Vietnam time (UTC+7)
      const now = new Date();
      const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      year = vnTime.getUTCFullYear();
      month = vnTime.getUTCMonth();
      day = vnTime.getUTCDate();
      targetDateYMD = `${year}-${pad(month + 1)}-${pad(day)}`;
    }

    const targetMonthStr = `${year}-${pad(month + 1)}`;

    if (mode === 'month') {
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const fromUtcDate = new Date(
        Date.UTC(year, month, 1, 0, 0, 0) - 7 * 3600 * 1000 - 3600 * 1000,
      );
      const toUtcDate = new Date(
        Date.UTC(year, month, lastDay, 23, 59, 59, 999) - 7 * 3600 * 1000 + 3600 * 1000,
      );
      const label = `01/${pad(month + 1)}/${year} → ${pad(lastDay)}/${pad(month + 1)}/${year}`;

      return {
        fromUtc: fromUtcDate.toISOString(),
        toUtc: toUtcDate.toISOString(),
        targetDateYMD,
        targetMonthStr,
        label,
      };
    } else {
      // Single day: start 00:00:00 VN -> end 23:59:59 VN
      const fromUtcDate = new Date(
        Date.UTC(year, month, day, 0, 0, 0) - 7 * 3600 * 1000 - 3600 * 1000,
      );
      const toUtcDate = new Date(
        Date.UTC(year, month, day, 23, 59, 59, 999) - 7 * 3600 * 1000 + 3600 * 1000,
      );
      const label = `${pad(day)}/${pad(month + 1)}/${year}`;

      return {
        fromUtc: fromUtcDate.toISOString(),
        toUtc: toUtcDate.toISOString(),
        targetDateYMD,
        targetMonthStr,
        label,
      };
    }
  }

  /**
   * Lấy toàn bộ đơn hàng trong khoảng thời gian từ Sapo API (có cache 60s)
   */
  async fetchOrdersFromSapo(fromUtc: string, toUtc: string): Promise<any[]> {
    const cacheKey = `${fromUtc}_${toUtc}`;
    const cached = this.orderCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.orders;
    }

    const { apiKey, apiSecret, store } = this.getSapoConfig();
    const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;

    const allOrders: any[] = [];
    let page = 1;
    const limit = 250;
    const maxPages = 10;

    this.logger.log(
      `[SapoRevenue] Fetching orders from Sapo (range: ${fromUtc} -> ${toUtc})...`,
    );

    try {
      while (page <= maxPages) {
        const url = `https://${store}.mysapo.net/admin/orders.json?created_at_min=${encodeURIComponent(
          fromUtc,
        )}&created_at_max=${encodeURIComponent(
          toUtc,
        )}&limit=${limit}&page=${page}`;

        const res = await axios.get(url, {
          headers: {
            Authorization: authHeader,
            Accept: 'application/json',
          },
          timeout: 15000,
        });

        const orders = res.data?.orders;
        if (!orders || !Array.isArray(orders) || orders.length === 0) {
          break;
        }

        allOrders.push(...orders);

        if (orders.length < limit) {
          break;
        }

        page++;
      }

      this.logger.log(
        `[SapoRevenue] Fetched total ${allOrders.length} orders from Sapo for range ${fromUtc} -> ${toUtc}`,
      );

      this.orderCache.set(cacheKey, { timestamp: now, orders: allOrders });
      return allOrders;
    } catch (err: any) {
      this.logger.error(
        `[SapoRevenue] Failed to fetch orders from Sapo: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }

  /**
   * Chuẩn hóa chuỗi để so khớp tên kênh / Fanpage
   */
  private cleanString(str: string): string {
    if (!str) return '';
    return str
      .replace(/^page_id_/i, '')
      .replace(/^page_/i, '')
      .replace(/\s*★\s*\(OAuth\)\s*$/i, '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove Vietnamese diacritics
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Trích xuất thông tin Page ID, Post ID, Campaign từ landing_site hoặc referring_site
   */
  private extractSiteDetails(order: any): {
    pageIdFromSite?: string;
    postIdFromSite?: string;
    campaignFromSite?: string;
  } {
    const site = order.landing_site || order.referring_site || '';
    if (!site) return {};

    let pageIdFromSite: string | undefined;
    let postIdFromSite: string | undefined;
    let campaignFromSite: string | undefined;

    // 1. Trích xuất Page ID (profile.php?id=... hoặc facebook.com/<id>)
    const matchProfile = site.match(/profile\.php\?id=(\d+)/i) || site.match(/facebook\.com\/(\d{10,})/i);
    if (matchProfile) {
      pageIdFromSite = matchProfile[1];
    }

    // 2. Trích xuất Post ID (fb_post_id=... hoặc post_id=...)
    const matchPost = site.match(/fb_post_id=(\d+)/i) || site.match(/post_id=([^&]+)/i);
    if (matchPost) {
      postIdFromSite = matchPost[1];
    }

    // 3. Trích xuất UTM Campaign
    const matchCampaign = site.match(/utm_campaign=([^&]+)/i);
    if (matchCampaign) {
      try {
        campaignFromSite = decodeURIComponent(matchCampaign[1].replace(/\+/g, ' '));
      } catch {
        campaignFromSite = matchCampaign[1];
      }
    }

    return { pageIdFromSite, postIdFromSite, campaignFromSite };
  }

  /**
   * Kiểm tra một đơn hàng Sapo có thuộc về kênh được chỉ định không (4 lớp: Page ID, source_name, tags, landing_site/referring_site)
   */
  private matchesChannel(
    order: any,
    channelName: string,
    platform?: string,
    pageId?: string,
  ): boolean {
    const cleanTarget = this.cleanString(channelName);
    let cleanPageId = pageId ? pageId.replace(/^page_id_|^page_/, '').trim() : undefined;
    if (cleanPageId) {
      const match = cleanPageId.match(/(\d{10,})/);
      if (match) cleanPageId = match[1];
    }
    if (!cleanTarget && !cleanPageId) return false;

    const sourceName = (order.source_name || '').toLowerCase().trim();
    const tags = (order.tags || '')
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);

    const isFb = !platform || platform === 'fb' || platform === 'facebook' || platform === 'FACEBOOK';

    // 1. KIỂM TRA ĐƠN FACEBOOK (Đa lớp: Page ID + source_name + tags + landing_site/referring_site)
    if (isFb) {
      // Phải có dấu hiệu từ Facebook / Social Channel
      const isFromFb =
        sourceName === 'facebook' ||
        sourceName.includes('social') ||
        tags.some(t => t.startsWith('page_') || t.startsWith('page_id_') || t.includes('facebook')) ||
        (order.landing_site && order.landing_site.includes('facebook.com')) ||
        (order.referring_site && order.referring_site.includes('facebook.com'));

      if (!isFromFb) {
        return false;
      }

      // Trích xuất Page ID và Tên Page thực tế trên đơn Sapo
      let orderPageId: string | undefined = undefined;
      let orderPageName: string | undefined = undefined;

      for (const t of tags) {
        if (t.startsWith('page_id_') || t.startsWith('fb_page_id_')) {
          orderPageId = t.replace(/^page_id_|^fb_page_id_/, '').trim();
        } else if (t.startsWith('page_')) {
          orderPageName = this.cleanString(t.replace('page_', ''));
        }
      }

      if (!orderPageId && order.landing_site) {
        const matchProfile = order.landing_site.match(/profile\.php\?id=(\d+)/i) || order.landing_site.match(/facebook\.com\/(\d{10,})/i);
        if (matchProfile) orderPageId = matchProfile[1];
      }

      // 1. Nếu có Page ID (từ tham số pageId hoặc từ channelName dạng số)
      const targetId = cleanPageId || (cleanTarget.match(/^\d{10,}$/) ? cleanTarget : undefined);

      if (targetId && orderPageId) {
        return orderPageId === targetId;
      }
      if (targetId && !orderPageId) {
        return Boolean(order.landing_site && order.landing_site.includes(targetId));
      }

      // 2. Khớp theo Tên Fanpage (khớp 100% tên)
      if (orderPageName && cleanTarget && orderPageName === cleanTarget) {
        return true;
      }

      // 3. Nếu order có Page ID khớp với chuỗi ID trong channelName
      if (orderPageId && cleanTarget && (cleanTarget === orderPageId || cleanTarget.includes(orderPageId))) {
        return true;
      }

      return false;
    }

    // 2. KIỂM TRA SHOPEE
    if (platform === 'shopee') {
      return sourceName === 'shopee' || (order.referring_site && order.referring_site.includes('shopee.vn'));
    }

    // 3. KIỂM TRA TIKTOK SHOP / TIKTOK ADS
    if (platform === 'tiktok') {
      return sourceName === 'tiktokshop' || sourceName === 'tiktok-for-business' || tags.some(t => t.toLowerCase().includes('tiktok'));
    }

    // 4. KIỂM TRA ZALO / ZALO OA
    if (platform === 'zalo') {
      return sourceName === 'zalo' || sourceName === 'zalo-oa';
    }

    // 5. KIỂM TRA WEBSITE
    if (platform === 'web') {
      return sourceName === 'web';
    }

    // 6. KIỂM TRA POS
    if (platform === 'pos') {
      return sourceName === 'pos';
    }

    return false;
  }

  /**
   * Lấy doanh thu của một kênh cụ thể THEO NGÀY (hoặc theo tháng)
   */
  async getChannelRevenue(params: {
    channelName: string;
    pageId?: string;
    platform?: string;
    date?: string;
    mode?: 'day' | 'month';
  }): Promise<SapoRevenueResult> {
    const { channelName, pageId, platform, date, mode = 'day' } = params;

    if (!channelName || !channelName.trim()) {
      return {
        success: false,
        channel: '',
        revenue: 0,
        orderCount: 0,
        period: { from: '', to: '', label: '' },
        message: 'Tên kênh không được để trống',
      };
    }

    const { fromUtc, toUtc, targetDateYMD, targetMonthStr, label } =
      this.calculateDateRange(date, mode);

    try {
      const orders = await this.fetchOrdersFromSapo(fromUtc, toUtc);

      let revenue = 0;
      let orderCount = 0;
      const sampleOrders: Array<{
        code: string;
        price: number;
        status: string;
        financial_status: string;
        created_on: string;
        campaign?: string;
        postId?: string;
        pageId?: string;
      }> = [];

      for (const o of orders) {
        // Loại bỏ đơn huỷ
        if (o.status === 'cancelled') continue;

        // Chỉ tính đơn đã đặt cọc / thanh toán thành công (khớp chuẩn với Sapo Social Dashboard)
        const isPaidOrDeposited =
          o.financial_status === 'partially_paid' ||
          o.financial_status === 'paid' ||
          o.financial_status === 'authorized';
        if (!isPaidOrDeposited) continue;

        const price = Number(o.total_price) || 0;
        // Bỏ qua đơn 0đ (quà tặng / đổi hàng)
        if (price <= 0) continue;

        // Kiểm tra chính xác ngày tạo đơn theo giờ Việt Nam (UTC+7)
        const orderDate = new Date(o.created_on);
        const vnDateStr = new Date(orderDate.getTime() + 7 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

        if (mode === 'day' && vnDateStr !== targetDateYMD) {
          continue;
        }
        if (mode === 'month' && !vnDateStr.startsWith(targetMonthStr)) {
          continue;
        }

        if (this.matchesChannel(o, channelName, platform, pageId)) {
          revenue += price;
          orderCount++;

          if (sampleOrders.length < 5) {
            const { pageIdFromSite, postIdFromSite, campaignFromSite } = this.extractSiteDetails(o);
            
            // Tìm postId trong tags nếu chưa có từ landing_site
            let finalPostId = postIdFromSite;
            let finalPageId = pageIdFromSite;
            const tags = (o.tags || '').split(',').map((t: string) => t.trim());
            for (const t of tags) {
              if (!finalPostId && t.startsWith('post_id_t_')) {
                finalPostId = t.replace('post_id_t_', '');
              } else if (!finalPageId && t.startsWith('page_id_')) {
                finalPageId = t.replace('page_id_', '');
              }
            }

            sampleOrders.push({
              code: o.name,
              price,
              status: o.status,
              financial_status: o.financial_status,
              created_on: o.created_on,
              campaign: campaignFromSite,
              postId: finalPostId,
              pageId: finalPageId,
            });
          }
        }
      }

      return {
        success: true,
        channel: channelName,
        platform,
        revenue,
        orderCount,
        period: {
          from: fromUtc,
          to: toUtc,
          label,
        },
        sampleOrders,
      };
    } catch (err: any) {
      return {
        success: false,
        channel: channelName,
        platform,
        revenue: 0,
        orderCount: 0,
        period: { from: fromUtc, to: toUtc, label },
        message: err.message || 'Lỗi khi kết nối hệ thống Sapo',
      };
    }
  }

  /**
   * Lấy tổng hợp danh sách tất cả các Facebook Page và doanh thu THEO NGÀY (hoặc tháng)
   */
  async getAllPagesRevenue(
    date?: string,
    mode: 'day' | 'month' = 'day',
  ): Promise<{
    period: { from: string; to: string; label: string };
    totalRevenue: number;
    totalOrders: number;
    pages: PageRevenueSummary[];
  }> {
    const { fromUtc, toUtc, targetDateYMD, targetMonthStr, label } =
      this.calculateDateRange(date, mode);
    const orders = await this.fetchOrdersFromSapo(fromUtc, toUtc);

    const pageMap = new Map<
      string,
      {
        pageName: string;
        pageId?: string;
        revenue: number;
        orderCount: number;
        cancelledCount: number;
        campaignMap: Map<string, { count: number; revenue: number }>;
      }
    >();

    let totalRevenue = 0;
    let totalOrders = 0;

    for (const o of orders) {
      const orderDate = new Date(o.created_on);
      const vnDateStr = new Date(orderDate.getTime() + 7 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);

      if (mode === 'day' && vnDateStr !== targetDateYMD) {
        continue;
      }
      if (mode === 'month' && !vnDateStr.startsWith(targetMonthStr)) {
        continue;
      }

      let pageName = 'Không xác định';
      let pageId: string | undefined = undefined;

      const tags = (o.tags || '')
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean);

      for (const t of tags) {
        if (t.startsWith('page_id_')) {
          pageId = t.replace('page_id_', '').trim();
        } else if (t.startsWith('page_')) {
          pageName = t.replace('page_', '').trim();
        }
      }

      // Nếu chưa có pageId/pageName từ tags, trích xuất từ landing_site / referring_site
      const { pageIdFromSite, campaignFromSite } = this.extractSiteDetails(o);
      if (!pageId && pageIdFromSite) {
        pageId = pageIdFromSite;
      }

      if (pageName === 'Không xác định') {
        if (pageId) {
          pageName = `Page ID: ${pageId}`;
        } else if (o.source_name) {
          pageName = `Kênh ${o.source_name.toUpperCase()}`;
        }
      }

      const key = pageName;
      if (!pageMap.has(key)) {
        pageMap.set(key, {
          pageName,
          pageId,
          revenue: 0,
          orderCount: 0,
          cancelledCount: 0,
          campaignMap: new Map(),
        });
      }

      const item = pageMap.get(key)!;
      if (pageId && !item.pageId) item.pageId = pageId;

      if (o.status === 'cancelled') {
        item.cancelledCount++;
      } else {
        const price = Number(o.total_price) || 0;
        const isPaidOrDeposited =
          o.financial_status === 'partially_paid' ||
          o.financial_status === 'paid' ||
          o.financial_status === 'authorized';

        if (!isPaidOrDeposited || price <= 0) {
          continue;
        }

        item.revenue += price;
        item.orderCount++;
        totalRevenue += price;
        totalOrders++;

        if (campaignFromSite) {
          const campKey = campaignFromSite;
          if (!item.campaignMap.has(campKey)) {
            item.campaignMap.set(campKey, { count: 0, revenue: 0 });
          }
          const c = item.campaignMap.get(campKey)!;
          c.count++;
          c.revenue += price;
        }
      }
    }

    const sortedPages: PageRevenueSummary[] = Array.from(pageMap.values())
      .map(item => ({
        pageName: item.pageName,
        pageId: item.pageId,
        revenue: item.revenue,
        orderCount: item.orderCount,
        cancelledCount: item.cancelledCount,
        topCampaigns: Array.from(item.campaignMap.entries())
          .map(([name, stat]) => ({ name, count: stat.count, revenue: stat.revenue }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      period: { from: fromUtc, to: toUtc, label },
      totalRevenue,
      totalOrders,
      pages: sortedPages,
    };
  }
}

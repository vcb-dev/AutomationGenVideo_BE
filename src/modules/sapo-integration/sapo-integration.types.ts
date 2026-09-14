export interface SapoOrder {
  id: number;
  name: string;
  source_name?: string;
  channel?: string;
  total_price: number | string;
  total_discounts?: number | string;
  financial_status?: string;
  status?: string;
  tags?: string;
  note?: string;
  created_on?: string;
  created_at?: string;
  location_id?: number;
  line_items?: Array<{
    id: number;
    price: number | string;
    quantity: number;
    title: string;
  }>;
}

export interface SapoOrdersResponse {
  orders: SapoOrder[];
  metadata?: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface SapoRevenueEntry {
  id: string;
  value: string;
  channel: string;
  channelId?: string;
  orderCount?: number;
}

export interface SapoRevenuePreviewResponse {
  date: string;
  totalRevenue: string;
  revenue: {
    fb: string;
    ig: string;
    tiktok: string;
    yt: string;
    thread: string;
    zalo: string;
  };
  channels: {
    fb: string;
    ig: string;
    tiktok: string;
    yt: string;
    thread: string;
    zalo: string;
  };
  breakdown: Record<string, SapoRevenueEntry[]>;
  orderCount: number;
  unassignedOrdersCount?: number;
  unassignedRevenue?: string;
  message?: string;
}

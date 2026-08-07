import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface FetchedManagedPage {
  page_id: string;
  name: string;
  username: string;
  category: string;
  avatar_url: string;
  followers_count: number;
  likes_count: number;
  page_access_token_encrypted: string;
  raw_data: any;
}

export interface FetchedVideo {
  post_id: string;
  caption: string;
  published_at: string;
  permalink_url: string;
  thumbnail_url: string;
  video_url: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  raw_data: any;
}

export interface FetchedPageMetadata {
  page_id: string;
  name: string;
  username: string;
  category: string;
  avatar_url: string;
  followers_count: number;
  likes_count: number;
  raw_data: any;
}

// Client gọi 4 endpoint fetch-only bên AI (video_management/views/facebook_fetch_views.py).
// AI không đụng DB — chỉ gọi Facebook Graph API + parse, trả JSON thô cho BE tự lưu.
// page_access_token luôn ở dạng CHUỖI ĐÃ MÃ HÓA (Fernet) — BE chỉ forward nguyên văn,
// không bao giờ tự mã hóa/giải mã (AI giữ FERNET_KEY, là nơi duy nhất biết mã hóa).
@Injectable()
export class FacebookAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchManagedPages(userAccessToken?: string): Promise<{ pages: FetchedManagedPage[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/managed-pages/`,
      { user_access_token: userAccessToken },
      { headers: this.authHeaders(), timeout: 60_000 },
    );
    return data;
  }

  // Gia hạn User Access Token. Token nằm bên AI (token store) nên BE không truyền gì
  // vào — chỉ kích hoạt và nhận lại kết quả để log.
  async refreshUserToken(): Promise<{ status: string; message: string; days_left?: number }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/token-refresh/`,
      {},
      { headers: this.authHeaders(), timeout: 60_000 },
    );
    return data;
  }

  async fetchPageSync(
    pageId: string,
    tokenEncrypted: string,
    maxPosts = 10,
  ): Promise<{ page_metadata: FetchedPageMetadata; videos: FetchedVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/sync/`,
      { page_id: pageId, page_access_token_encrypted: tokenEncrypted, max_posts: maxPosts },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchPageBackfill(
    pageId: string,
    tokenEncrypted: string,
    maxTotal = 300,
  ): Promise<{ videos: FetchedVideo[]; total_scanned: number }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/backfill/`,
      { page_id: pageId, page_access_token_encrypted: tokenEncrypted, max_total: maxTotal },
      { headers: this.authHeaders(), timeout: 900_000 },
    );
    return data;
  }

  async fetchMetricsRefresh(
    tokenEncrypted: string,
    postIds: string[],
  ): Promise<{ metrics: Record<string, { view_count: number; like_count: number; comment_count: number; share_count: number }> }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/metrics-refresh/`,
      { page_access_token_encrypted: tokenEncrypted, post_ids: postIds },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  // Refresh metrics cho ID Video/Reels NODE THUẦN (không phải Page Post ID) — khác
  // fetchMetricsRefresh() ở trên. Video node không hỗ trợ field shares/reactions/insights
  // như Post nên cần field set + edge riêng (video_insights) ở phía AI.
  async fetchVideoNodeMetrics(
    tokenEncrypted: string,
    videoIds: string[],
  ): Promise<{ metrics: Record<string, { view_count: number; like_count: number; comment_count: number; share_count: number }> }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/video-metrics-refresh/`,
      { page_access_token_encrypted: tokenEncrypted, video_ids: videoIds },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  // Tra chủ sở hữu (Page) thật của 1 object Graph API bất kỳ — dùng khi URL user dán
  // (link Reels /reel/{id}, ?v={id}...) không mang page handle nên không tra được page
  // bằng cách parse chuỗi. `tokenEncrypted` chỉ cần là token của MỘT page bất kỳ đã kết
  // nối (đủ quyền đọc field công khai 'from' của object khác), không cần đúng page sở hữu.
  async resolveOwner(
    objectId: string,
    tokenEncrypted?: string,
  ): Promise<{ from_id: string | null; from_name: string | null; permalink_url: string | null }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/facebook/fetch/resolve-owner/`,
      { object_id: objectId, page_access_token_encrypted: tokenEncrypted || '' },
      { headers: this.authHeaders(), timeout: 30_000 },
    );
    return data;
  }
}

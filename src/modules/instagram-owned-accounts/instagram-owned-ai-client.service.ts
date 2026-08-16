import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

export interface FetchedInstagramAccount {
  instagram_id: string;
  username: string;
  full_name: string;
  url: string;
  avatar_url: string;
  biography: string;
  external_url: string;
  followers_count: number;
  posts_count: number;
  page_id: string;
}

export interface FetchedInstagramMedia {
  post_id: string;
  shortcode: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  media_product_type: string;
  likes_count: number;
  comments_count: number;
  date_posted: string;
  /** null = KHÔNG lấy được (thiếu quyền insights, hoặc bài là ảnh). Khác hẳn 0. */
  view_count: number | null;
}

/**
 * Client gọi 2 endpoint fetch-only bên AI (video_management/views/instagram_owned_fetch_views.py).
 * AI không đụng DB — chỉ gọi Graph API + parse, trả JSON thô cho BE tự lưu.
 *
 * page_access_token luôn ở dạng CHUỖI ĐÃ MÃ HOÁ (Fernet) — BE chỉ forward nguyên văn, không bao
 * giờ tự mã hoá/giải mã (AI giữ FERNET_KEY). Cùng luật với facebook-ai-client.service.ts.
 */
@Injectable()
export class InstagramOwnedAiClientService {
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  /** Trả null nếu page không nối Instagram — 11/25 page rơi vào đây, là chuyện bình thường. */
  async fetchOwnedAccount(pageId: string, tokenEncrypted: string): Promise<FetchedInstagramAccount | null> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/instagram/fetch/owned-account/`,
      { page_id: pageId, page_access_token_encrypted: tokenEncrypted },
      { headers: this.authHeaders(), timeout: 60_000 },
    );
    return data?.account ?? null;
  }

  async fetchMedia(
    instagramId: string,
    tokenEncrypted: string,
    limit = 25,
  ): Promise<FetchedInstagramMedia[]> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/instagram/fetch/media/`,
      { instagram_id: instagramId, page_access_token_encrypted: tokenEncrypted, limit },
      // Mỗi video tốn thêm 1 lượt gọi insight bên Graph API nên lượt này chậm hơn hẳn
      // owned-account; 25 bài đo được ~20 giây.
      { headers: this.authHeaders(), timeout: 180_000 },
    );
    return data?.media ?? [];
  }
}

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

export interface ParsedInstagramFullProfile {
  url: string;
  instagram_id: string | null;
  full_name: string;
  avatar_url: string;
  hd_avatar_url: string;
  biography: string;
  bio_links: any[];
  external_url: string;
  is_verified: boolean;
  is_private: boolean;
  is_business: boolean;
  category: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
}

export interface ParsedInstagramFallbackUser {
  username: string;
  url: string;
  avatar_url: string;
  is_verified: boolean;
}

export interface ParsedInstagramReel {
  post_id: string;
  shortcode: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  duration_seconds: number | null;
  is_paid_partnership: boolean;
  play_count: number;
  likes_count: number;
  comments_count: number;
  date_posted: string;
}

// Client gọi endpoint fetch-only bên AI (video_management/views/instagram_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class InstagramAiClientService {
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchProfileReels(
    username: string,
    count = 600,
  ): Promise<{
    full_profile: ParsedInstagramFullProfile | null;
    fallback_user: ParsedInstagramFallbackUser | null;
    reels: ParsedInstagramReel[];
  }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/instagram/fetch/profile-reels/`,
      { username, count },
      { headers: this.authHeaders(), timeout: 300_000 },
    );
    return data;
  }
}

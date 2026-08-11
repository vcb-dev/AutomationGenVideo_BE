import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

export interface ParsedTikTokVideo {
  post_id: string;
  shortcode: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  video_duration: number;
  region: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar: string;
  author_url: string;
  author_followers: number;
  author_is_verified: boolean;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  music_title: string;
  music_author: string;
  search_keyword: string;
  date_posted: string;
}

export interface ParsedTikTokProfileVideo {
  video_id: string;
  shortcode: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  video_duration: number;
  region: string;
  post_type: string;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  favorites_count: number;
  music_title: string;
  music_author: string;
  date_posted: string;
}

export interface ParsedTikTokAuthor {
  profile_id: string;
  username: string;
  sec_uid: string;
  nickname: string;
  url: string;
  avatar_url: string;
  biography: string;
  is_verified: boolean;
  followers_count: number;
  following_count: number;
  videos_count: number;
}

// Client gọi 2 endpoint fetch-only bên AI (video_management/views/tiktok_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class TiktokAiClientService {
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchSearch(
    keyword: string,
    count = 30,
    region = 'VN',
    cursor = 0,
  ): Promise<{ videos: ParsedTikTokVideo[]; cursor: number; has_more: boolean }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/tiktok/fetch/search/`,
      { keyword, count, region, cursor },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchProfilePosts(params: {
    username: string;
    secUid?: string;
    count?: number;
    days?: number;
  }): Promise<{ author: ParsedTikTokAuthor | null; videos: ParsedTikTokProfileVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/tiktok/fetch/profile-posts/`,
      {
        username: params.username,
        sec_uid: params.secUid,
        count: params.count,
        days: params.days,
      },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

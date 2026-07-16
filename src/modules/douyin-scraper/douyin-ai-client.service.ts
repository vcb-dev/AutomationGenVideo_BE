import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedDouyinVideo {
  post_id: string;
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
  author_followers: number;
  author_is_verified: boolean;
  digg_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  music_title: string;
  music_author: string;
  search_keyword: string;
  date_posted: string;
}

export interface ParsedDouyinAuthor {
  uid: string;
  username: string;
  nickname: string;
  biography: string;
  is_verified: boolean;
  avatar_url: string;
  followers_count: number | null;
}

// Client gọi 2 endpoint fetch-only bên AI (video_management/views/douyin_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class DouyinAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchSearch(
    keyword: string,
    count = 30,
    cursor?: unknown,
  ): Promise<{ videos: ParsedDouyinVideo[]; cursor: unknown; has_more: boolean }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/douyin/fetch/search/`,
      { keyword, count, cursor },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchProfileVideos(
    secUserId: string,
    count = 20,
  ): Promise<{ author: ParsedDouyinAuthor | null; videos: ParsedDouyinVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/douyin/fetch/profile-videos/`,
      { sec_user_id: secUserId, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedBilibiliProfile {
  mid: string;
  username: string;
  nickname: string;
  url: string;
  avatar_url: string;
  biography: string;
  is_verified: boolean;
  verify_desc: string;
  followers_count: number;
  following_count: number;
  likes_count: number;
  videos_count: number;
}

export interface ParsedBilibiliVideo {
  post_id: string;
  url: string;
  description: string;
  thumbnail_url: string;
  video_duration: number;
  view_count: number;
  danmaku_count: number;
  date_posted: string;
}

export interface ParsedBilibiliSearchVideo {
  post_id: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  video_duration: number;
  author_id: string;
  author_username: string;
  author_avatar: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  collect_count: number;
  danmaku_count: number;
  search_keyword: string;
  date_posted: string;
}

// Client gọi endpoint fetch-only bên AI (video_management/views/bilibili_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class BilibiliAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchProfile(
    mid: string,
    count: number,
  ): Promise<{ profile_api_ok: boolean; profile: ParsedBilibiliProfile | null; videos: ParsedBilibiliVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/bilibili/fetch/profile/`,
      { mid, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchSearch(
    keyword: string,
    count: number,
    cursor?: number | null,
  ): Promise<{ videos: ParsedBilibiliSearchVideo[]; cursor: number; has_more: boolean }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/bilibili/fetch/search/`,
      { keyword, count, cursor },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

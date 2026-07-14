import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedKuaishouProfile {
  // numeric ID resolve được từ fetch_one_user_v2 — CHỈ dùng để gọi
  // fetch_user_hot_post, không dùng để gọi lại fetch_one_user_v2 (cần eid).
  user_id: string;
  // eid: định danh trong URL profile (kuaishou.com/profile/{eid}) — dùng để
  // gọi lại fetch_one_user_v2 ở các lần cào sau (delta/periodic).
  eid: string;
  username: string;
  nickname: string;
  url: string;
  avatar_url: string;
  biography: string;
  gender: string;
  followers_count: number;
  following_count: number;
  likes_count: number;
  videos_count: number;
}

export interface ParsedKuaishouVideo {
  post_id: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  video_duration: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  date_posted: string;
}

export interface ParsedKuaishouSearchVideo {
  post_id: string;
  url: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string;
  video_duration: number;
  author_id: string;
  author_eid: string;
  author_username: string;
  author_avatar: string;
  author_is_verified: boolean;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  search_keyword: string;
  date_posted: string;
}

// Client gọi endpoint fetch-only bên AI (video_management/views/kuaishou_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class KuaishouAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  // eid — không phải numeric user_id — vì fetch_one_user_v2 (bước đầu trong
  // chain fetch/profile/ bên AI) chỉ nhận eid.
  async fetchProfile(
    eid: string,
    count: number,
  ): Promise<{ profile_api_ok: boolean; profile: ParsedKuaishouProfile | null; videos: ParsedKuaishouVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/kuaishou/fetch/profile/`,
      { eid, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchSearch(keyword: string, count: number): Promise<{ videos: ParsedKuaishouSearchVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/kuaishou/fetch/search/`,
      { keyword, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

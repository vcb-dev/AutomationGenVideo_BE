import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedXhsVideo {
  note_id: string;
  url: string;
  title: string;
  description: string;
  thumbnail_url: string;
  author_id: string;
  author_name: string;
  author_avatar: string;
  duration_seconds: number;
  liked_count: number;
  collected_count: number;
  comments_count: number;
  shared_count: number;
  date_posted: string;
}

export interface ParsedXhsAuthor {
  nickname: string;
  avatar_url: string;
  is_verified: boolean;
}

// Client gọi 2 endpoint fetch-only bên AI (video_management/views/xiaohongshu_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class XiaohongshuAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchSearch(
    keyword: string,
    count = 20,
    cursor?: unknown,
  ): Promise<{ videos: ParsedXhsVideo[]; cursor: unknown; has_more: boolean }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/xiaohongshu/fetch/search/`,
      { keyword, count, cursor },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }

  async fetchProfileVideos(
    userId: string,
    count = 100,
  ): Promise<{ author: ParsedXhsAuthor | null; videos: ParsedXhsVideo[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/xiaohongshu/fetch/profile-videos/`,
      { user_id: userId, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

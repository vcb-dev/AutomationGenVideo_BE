import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedYoutubeChannel {
  channel_id: string;
  title: string;
  description: string;
  url: string;
  avatar_url: string;
  banner_url: string;
  is_verified: boolean;
  has_business_email: boolean;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  country: string;
  channel_created_at: string | null;
}

export interface ParsedYoutubeShort {
  video_id: string;
  title: string;
  hashtags: string[];
  url: string;
  thumbnail_url: string;
  view_count: number;
  view_count_text: string;
}

// Client gọi endpoint fetch-only bên AI (video_management/views/youtube_fetch_views.py).
// AI không đụng DB — chỉ gọi TikHub + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class YoutubeAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchChannel(
    channelId: string,
    count: number,
  ): Promise<{ channel_api_ok: boolean; profile: ParsedYoutubeChannel | null; shorts: ParsedYoutubeShort[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/youtube/fetch/channel/`,
      { channel_id: channelId, count },
      { headers: this.authHeaders(), timeout: 120_000 },
    );
    return data;
  }
}

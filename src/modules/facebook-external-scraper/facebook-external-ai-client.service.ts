import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

export interface ParsedFanpageProfile {
  profile_id: string;
  name: string;
  page_url: string;
  handle: string;
  avatar_url: string;
  is_verified: boolean | null;
  followers_count: number;
}

export interface ParsedFacebookReel {
  post_id: string;
  shortcode: string;
  url: string;
  content: string;
  hashtags: string[];
  video_url: string;
  thumbnail_url: string;
  duration_seconds: number | null;
  has_audio: boolean;
  date_posted: string;
  views_count: number;
  likes_count: number;
  comments_count: number;
  shares_count: number;
}

// Client gọi endpoint fetch-only bên AI (video_management/views/facebook_external_fetch_views.py).
// AI không đụng DB — chỉ gọi RapidAPI + parse, trả JSON thô cho BE tự lưu.
@Injectable()
export class FacebookExternalAiClientService {
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchPageReels(
    pageUrl: string,
    numOfPosts: number,
    excludePostIds: string[],
    startDate: string,
  ): Promise<{ profile_api_ok: boolean; profile: ParsedFanpageProfile | null; reels: ParsedFacebookReel[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/fanpages/fetch/reels/`,
      {
        page_url: pageUrl,
        num_of_posts: numOfPosts,
        exclude_post_ids: excludePostIds,
        start_date: startDate,
      },
      { headers: this.authHeaders(), timeout: 180_000 },
    );
    return data;
  }
}

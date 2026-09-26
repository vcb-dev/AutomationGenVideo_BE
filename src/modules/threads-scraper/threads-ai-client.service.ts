import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

export interface ParsedThreadsFullProfile {
  threads_user_id: string;
  username: string;
  name: string;
  url: string;
  avatar_url: string;
  biography: string;
  followers_count: number;
  is_verified: boolean;
}

export interface ParsedThreadsPost {
  post_id: string;
  shortcode: string;
  url: string;
  text: string;
  media_type: string;
  thumbnail_url: string;
  video_url: string;
  views_count: number;
  likes_count: number;
  replies_count: number;
  reposts_count: number;
  quotes_count: number;
  date_posted: string;
  author_username: string;
  author_name: string;
  author_avatar: string;
  is_vietnamese?: boolean;
}

@Injectable()
export class ThreadsAiClientService {
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async fetchProfilePosts(
    username: string,
    count = 50,
  ): Promise<{
    full_profile: ParsedThreadsFullProfile | null;
    posts: ParsedThreadsPost[];
  }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/threads/fetch/profile-posts/`,
      { username, count },
      { headers: this.authHeaders(), timeout: 300_000 },
    );
    return data;
  }

  async searchTop(
    query: string,
    count = 50,
  ): Promise<{
    query: string;
    posts: ParsedThreadsPost[];
  }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/threads/fetch/search-top/`,
      { query, count },
      { headers: this.authHeaders(), timeout: 300_000 },
    );
    return data;
  }
}

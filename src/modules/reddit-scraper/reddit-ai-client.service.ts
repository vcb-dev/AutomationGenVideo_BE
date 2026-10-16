import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

export interface ParsedRedditSubreddit {
  name: string;
  display_name: string;
  title: string;
  description: string;
  icon_url: string;
  subscribers_count: number;
  is_nsfw: boolean;
}

export interface ParsedRedditPost {
  post_id: string;
  title: string;
  text: string;
  url: string;
  link_url: string;
  subreddit_name: string;
  subreddit: ParsedRedditSubreddit | null;
  author: string;
  author_avatar: string;
  media_type: string;
  thumbnail_url: string;
  video_url: string;
  score: number;
  comments_count: number;
  upvote_ratio: number | null;
  is_nsfw: boolean;
  date_posted: string;
  search_keyword: string;
}

export interface RedditSearchOptions {
  sort: string;
  time_range: string;
  count: number;
}

// AI chỉ fetch + parse qua TikHub (video_management/views/reddit_fetch_views.py), BE lưu DB.
@Injectable()
export class RedditAiClientService {
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(private readonly jwtService: JwtService) {}

  private authHeaders() {
    const token = this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' });
    return { Authorization: `Bearer ${token}` };
  }

  async search(query: string, options: RedditSearchOptions): Promise<{ query: string; posts: ParsedRedditPost[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/reddit/fetch/search/`,
      { query, ...options },
      { headers: this.authHeaders(), timeout: 300_000 },
    );
    return data;
  }

  async subreddit(
    subreddit: string,
    options: RedditSearchOptions,
  ): Promise<{ subreddit: ParsedRedditSubreddit; posts: ParsedRedditPost[] }> {
    const { data } = await axios.post(
      `${this.aiServiceUrl}/api/scraper/reddit/fetch/subreddit/`,
      { subreddit, ...options },
      { headers: this.authHeaders(), timeout: 300_000 },
    );
    return data;
  }
}

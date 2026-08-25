import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';
import axios from 'axios';

@Injectable()
export class TrafficInsightsService {
  private readonly logger = new Logger(TrafficInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getTrafficInsights(
    channelId: string,
    date?: string,
  ): Promise<{ success: boolean; views: number; impressions?: number; period?: { from: string; to: string; label: string }; source?: string; message?: string }> {
    try {
      const channelIdClean = (channelId || '').trim();
      const cleanName = channelIdClean.replace(/\s*★\s*\(OAuth\)\s*$/i, '').trim();
      const pageIdClean = channelIdClean.replace(/^page_/, '');

      this.logger.log(`[TrafficInsights] Fetching insights for channel="${channelIdClean}", cleanName="${cleanName}", date="${date}"`);

      // Tính toán khoảng thời gian từ đầu tháng đến ngày được chọn (Month-To-Date)
      const targetDate = date ? new Date(date) : new Date();
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');

      const startOfMonthStr = `${year}-${month}-01`;
      const startOfMonth = new Date(`${year}-${month}-01T00:00:00.000Z`);

      const endOfDateStr = `${year}-${month}-${day}`;
      const endOfDate = new Date(`${year}-${month}-${day}T23:59:59.999Z`);
      const period = { from: startOfMonthStr, to: endOfDateStr, label: `01/${month}/${year} → ${day}/${month}/${year}` };

      // 1. Tìm trong SocialAccount (OAuth accounts)
      const socialAccount = await this.prisma.socialAccount.findFirst({
        where: {
          is_active: true,
          OR: [
            { id: channelIdClean },
            { platform_id: channelIdClean },
            { platform_id: `page_${channelIdClean}` },
            { platform_id: pageIdClean },
            { name: { equals: channelIdClean, mode: 'insensitive' } },
            { name: { equals: cleanName, mode: 'insensitive' } },
            { username: { equals: channelIdClean, mode: 'insensitive' } },
            { username: { equals: cleanName, mode: 'insensitive' } },
          ],
        },
      });

      // 2. Tìm trong video_management_managedfacebookpage
      const managedFbPage = await this.prisma.video_management_managedfacebookpage.findFirst({
        where: {
          OR: [
            { page_id: pageIdClean },
            { page_id: channelIdClean },
            { name: { equals: channelIdClean, mode: 'insensitive' } },
            { name: { equals: cleanName, mode: 'insensitive' } },
            { username: { equals: channelIdClean, mode: 'insensitive' } },
          ],
        },
      });

      // 3. Tìm trong TrackedChannel
      const tracked = await this.prisma.trackedChannel.findFirst({
        where: {
          is_active: true,
          OR: [
            { id: channelIdClean },
            { username: { equals: channelIdClean, mode: 'insensitive' } },
            { username: { equals: cleanName, mode: 'insensitive' } },
            { display_name: { equals: channelIdClean, mode: 'insensitive' } },
            { display_name: { equals: cleanName, mode: 'insensitive' } },
          ],
        },
      });

      // A) NẾU CÓ SOCIAL ACCOUNT: Thử gọi trực tiếp API nền tảng với token đã giải mã
      if (socialAccount) {
        const platform = String(socialAccount.platform || '').toUpperCase();
        const targetPlatformId = socialAccount.platform_id.replace(/^page_/, '');

        // --- FACEBOOK & INSTAGRAM ---
        if ((platform === 'FACEBOOK' || platform === 'INSTAGRAM') && socialAccount.access_token_enc) {
          try {
            const decryptedToken = this.crypto.decrypt(socialAccount.access_token_enc);

            if (platform === 'FACEBOOK') {
              // Tổng Lượt xem Facebook (Views) theo chuẩn Meta Professional Dashboard:
              //   Views = Lượt hiển thị Organic (bao gồm ảnh + chữ + video organic xuất hiện trên màn hình)
              //         + Lượt xem Video Paid (quảng cáo - không có trong organic impressions)
              // Không cộng page_video_views vì sẽ bị đếm kép (video ảo hưởng đã có trong organic impressions)
              try {
                const insightRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/insights`, {
                  params: {
                    metric: 'page_video_views,page_video_views_organic,page_posts_impressions_organic',
                    period: 'day',
                    since: startOfMonthStr,
                    until: endOfDateStr,
                    access_token: decryptedToken,
                  },
                  timeout: 5000,
                });
                const dataList = insightRes.data?.data || [];

                let videoViewsTotal = 0;   // Tổng video views (organic + paid)
                let videoViewsOrganic = 0; // Chỉ organic video views
                let postImpressionsOrganic = 0; // Organic impressions (bao gồm cả video organic + ảnh + chữ)

                for (const item of dataList) {
                  const values = item.values || [];
                  const sumVal = values.reduce((acc: number, cur: any) => acc + Number(cur.value || 0), 0);
                  if (item.name === 'page_video_views') {
                    videoViewsTotal = sumVal;
                  } else if (item.name === 'page_video_views_organic') {
                    videoViewsOrganic = sumVal;
                  } else if (item.name === 'page_posts_impressions_organic') {
                    postImpressionsOrganic = sumVal;
                  }
                }

                // Paid video views = Total video views - Organic video views (không có trong organic impressions)
                const paidVideoViews = Math.max(0, videoViewsTotal - videoViewsOrganic);

                // Tổng Views = Organic impressions (all content) + Paid video (chưa có trong organic)
                const totalViews = postImpressionsOrganic + paidVideoViews;
                if (totalViews > 0) {
                  return {
                    success: true,
                    views: totalViews,
                    period,
                    source: 'meta_graph_views_mtd',
                    impressions: postImpressionsOrganic,
                  };
                }
              } catch {
                // fallback to videos
              }

              // 2. Thử lấy danh sách videos từ đầu tháng đến ngày chọn
              try {
                const videoRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/videos`, {
                  params: {
                    fields: 'id,views,created_time',
                    access_token: decryptedToken,
                    limit: 50,
                  },
                  timeout: 5000,
                });
                const videos = videoRes.data?.data || [];
                let mtdViews = 0;
                let totalRecentViews = 0;
                for (const v of videos) {
                  const vViews = Number(v.views || 0);
                  totalRecentViews += vViews;
                  if (v.created_time) {
                    const vDate = v.created_time.slice(0, 10);
                    if (vDate >= startOfMonthStr && vDate <= endOfDateStr) {
                      mtdViews += vViews;
                    }
                  }
                }
                if (mtdViews > 0) {
                  return { success: true, views: mtdViews, source: 'meta_graph_videos_mtd' };
                }
                if (totalRecentViews > 0) {
                  return { success: true, views: totalRecentViews, source: 'meta_graph_videos_recent' };
                }
              } catch {
                // fallback
              }
            } else if (platform === 'INSTAGRAM') {
              try {
                // 1. Thử lấy danh sách media cơ bản từ đầu tháng đến ngày chọn
                const mediaRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/media`, {
                  params: {
                    fields: 'id,caption,media_type,timestamp,like_count,comments_count,permalink',
                    access_token: decryptedToken,
                    limit: 50,
                  },
                  timeout: 5000,
                });
                const mediaList = mediaRes.data?.data || [];
                let mtdViews = 0;
                let totalMediaViews = 0;

                for (const m of mediaList) {
                  const mDate = m.timestamp ? m.timestamp.slice(0, 10) : '';
                  const likes = Number(m.like_count || 0);
                  const comments = Number(m.comments_count || 0);
                  const estimatedViews = Math.max(likes * 25 + comments * 10, likes > 0 ? likes * 10 : 50);
                  totalMediaViews += estimatedViews;
                  if (mDate >= startOfMonthStr && mDate <= endOfDateStr) {
                    mtdViews += estimatedViews;
                  }
                }

                if (mtdViews > 0) {
                  return { success: true, views: mtdViews, source: 'instagram_graph_media_mtd' };
                }
                if (totalMediaViews > 0) {
                  return { success: true, views: totalMediaViews, source: 'instagram_graph_media_recent' };
                }
              } catch (igErr: any) {
                this.logger.warn(`[TrafficInsights] Instagram Graph API error for ${targetPlatformId}: ${igErr.message}`);
              }

              // 2. Thử tìm trong Scraper Instagram database
              if (socialAccount.username) {
                const scProfile = await this.prisma.scraperInstagramProfile.findFirst({
                  where: {
                    OR: [
                      { username: { equals: socialAccount.username, mode: 'insensitive' } },
                      { full_name: { equals: socialAccount.name, mode: 'insensitive' } },
                    ],
                  },
                  include: { reels: true },
                });
                if (scProfile?.reels?.length) {
                  let igMtdPlays = 0;
                  let igTotalPlays = 0;
                  for (const r of scProfile.reels) {
                    const plays = Number(r.play_count || 0);
                    igTotalPlays += plays;
                    if (r.date_posted) {
                      const rDate = r.date_posted.toISOString().slice(0, 10);
                      if (rDate >= startOfMonthStr && rDate <= endOfDateStr) {
                        igMtdPlays += plays;
                      }
                    }
                  }
                  if (igMtdPlays > 0) {
                    return { success: true, views: igMtdPlays, source: 'db_instagram_reels_mtd' };
                  }
                  if (igTotalPlays > 0) {
                    return { success: true, views: igTotalPlays, source: 'db_instagram_reels_total' };
                  }
                }
              }
            }
          } catch (decryptErr: any) {
            this.logger.warn(`[TrafficInsights] Token decrypt error for ${channelIdClean}: ${decryptErr.message}`);
          }
        }

        // --- YOUTUBE ---
        if (platform === 'YOUTUBE') {
          try {
            let ytAccessToken: string | null = null;

            if (socialAccount.access_token_enc) {
              ytAccessToken = this.crypto.decrypt(socialAccount.access_token_enc);
            }

            const isExpired = !socialAccount.token_expires_at || new Date(socialAccount.token_expires_at).getTime() <= Date.now();
            if (isExpired && socialAccount.refresh_token_enc) {
              const refreshToken = this.crypto.decrypt(socialAccount.refresh_token_enc);
              const clientId = process.env.YT_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
              const clientSecret = process.env.YT_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;

              if (clientId && clientSecret && refreshToken) {
                try {
                  const refreshRes = await axios.post('https://oauth2.googleapis.com/token', {
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                  });
                  if (refreshRes.data?.access_token) {
                    ytAccessToken = refreshRes.data.access_token;
                    const expiresIn = refreshRes.data.expires_in || 3600;
                    const newExpiry = new Date(Date.now() + expiresIn * 1000);
                    await this.prisma.socialAccount.update({
                      where: { id: socialAccount.id },
                      data: {
                        access_token_enc: this.crypto.encrypt(ytAccessToken),
                        token_expires_at: newExpiry,
                      },
                    }).catch(() => null);
                  }
                } catch (rErr: any) {
                  this.logger.warn(`[TrafficInsights] YouTube token refresh failed: ${rErr.message}`);
                }
              }
            }

            if (ytAccessToken) {
              const chRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                params: { part: 'snippet,statistics', mine: 'true' },
                headers: { Authorization: `Bearer ${ytAccessToken}` },
                timeout: 5000,
              });
              const stats = chRes.data?.items?.[0]?.statistics;
              if (stats?.viewCount) {
                const totalYtViews = Number(stats.viewCount);
                if (totalYtViews > 0) {
                  return { success: true, views: totalYtViews, source: 'youtube_api_channel_stats' };
                }
              }
            }
          } catch (ytErr: any) {
            this.logger.warn(`[TrafficInsights] YouTube API error: ${ytErr.message}`);
          }
        }
      }

      // B) NẾU CÓ MANAGED FB PAGE TRONG DB: Lấy từ owned video content (Lũy kế từ đầu tháng)
      if (managedFbPage) {
        const mtdAgg = await this.prisma.video_management_ownedvideocontent.aggregate({
          where: {
            managed_page_id: managedFbPage.id,
            published_at: { gte: startOfMonth, lte: endOfDate },
          },
          _sum: { view_count: true, reach_count: true },
        });
        const viewsMtd = Number(mtdAgg._sum.view_count || mtdAgg._sum.reach_count || 0);
        if (viewsMtd > 0) {
          return { success: true, views: viewsMtd, source: 'db_owned_videos_mtd' };
        }

        // Nếu trong tháng chưa có video, lấy tổng views từ các video gần nhất
        const recentVideos = await this.prisma.video_management_ownedvideocontent.findMany({
          where: { managed_page_id: managedFbPage.id },
          orderBy: { published_at: 'desc' },
          take: 10,
          select: { view_count: true },
        });
        const recentViews = recentVideos.reduce((sum, v) => sum + Number(v.view_count || 0), 0);
        if (recentViews > 0) {
          return { success: true, views: recentViews, source: 'db_owned_videos_recent' };
        }
      }

      // C) NẾU CÓ TRACKED CHANNEL: Lấy từ video posts (Lũy kế từ đầu tháng)
      if (tracked) {
        const postAgg = await this.prisma.videoPost.aggregate({
          where: {
            channel_id: tracked.id,
            posted_at: { gte: startOfMonth, lte: endOfDate },
          },
          _sum: { views: true },
        });
        const postViews = Number(postAgg._sum.views || 0);
        if (postViews > 0) {
          return { success: true, views: postViews, source: 'db_tracked_posts_mtd' };
        }
        if (tracked.total_views && Number(tracked.total_views) > 0) {
          return { success: true, views: Number(tracked.total_views), source: 'db_tracked_total' };
        }
      }

      // D) Không tìm thấy hoặc chưa có số liệu: trả về 0 một cách an toàn
      return { success: true, views: 0, source: 'none' };
    } catch (error: any) {
      this.logger.error(`[TrafficInsights] Error: ${error.message}`);
      return { success: false, views: 0, message: error.message };
    }
  }
}

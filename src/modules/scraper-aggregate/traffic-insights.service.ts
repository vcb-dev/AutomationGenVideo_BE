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
    scope: 'day' | 'mtd' = 'day',
    platform?: string,
  ): Promise<{
    success: boolean;
    views: number;
    impressions?: number;
    reach?: number;
    videoViewsTotal?: number;
    videoViewsOrganic?: number;
    engagements?: number;
    period?: { from: string; to: string; label: string };
    source?: string;
    message?: string;
  }> {
    try {
      const channelIdClean = (channelId || '').trim();
      const cleanName = channelIdClean.replace(/\s*★\s*\(OAuth\)\s*$/i, '').trim();
      const pageIdClean = channelIdClean.replace(/^page_/, '');

      const platMap: Record<string, string> = {
        FB: 'FACEBOOK',
        FACEBOOK: 'FACEBOOK',
        FANPAGE: 'FACEBOOK',
        IG: 'INSTAGRAM',
        INSTAGRAM: 'INSTAGRAM',
        INS: 'INSTAGRAM',
        YT: 'YOUTUBE',
        YOUTUBE: 'YOUTUBE',
        TT: 'TIKTOK',
        TIKTOK: 'TIKTOK',
        THREAD: 'THREADS',
        THREADS: 'THREADS',
        ZALO: 'ZALO',
      };
      const expectedPlatform = platform ? (platMap[platform.toUpperCase().trim()] || platform.toUpperCase().trim()) : null;

      this.logger.log(
        `[TrafficInsights] Fetching insights for channel="${channelIdClean}", cleanName="${cleanName}", platform="${expectedPlatform || 'any'}", date="${date}", scope="${scope}"`,
      );

      // 1. Phân tích ngày theo định dạng YYYY-MM-DD và múi giờ Việt Nam (GMT+7)
      let targetYear: number;
      let targetMonth: number;
      let targetDay: number;

      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
        const parts = date.trim().split('-').map(Number);
        targetYear = parts[0];
        targetMonth = parts[1];
        targetDay = parts[2];
      } else {
        const now = new Date();
        const vnNow = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
        vnNow.setDate(vnNow.getDate() - 1); // Mặc định là D-1
        targetYear = vnNow.getFullYear();
        targetMonth = vnNow.getMonth() + 1;
        targetDay = vnNow.getDate();
      }

      const targetMonthStr = String(targetMonth).padStart(2, '0');
      const targetDayStr = String(targetDay).padStart(2, '0');
      const targetDateStr = `${targetYear}-${targetMonthStr}-${targetDayStr}`;

      const isMtd = scope === 'mtd';
      let fromDateStr: string;
      let toDateStr: string;
      let periodLabel: string;
      let sinceDate: Date;
      let untilDate: Date;

      if (isMtd) {
        fromDateStr = `${targetYear}-${targetMonthStr}-01`;
        toDateStr = targetDateStr;
        periodLabel = `01/${targetMonthStr}/${targetYear} → ${targetDayStr}/${targetMonthStr}/${targetYear}`;
        sinceDate = new Date(`${fromDateStr}T00:00:00.000+07:00`);
        untilDate = new Date(`${toDateStr}T23:59:59.999+07:00`);
      } else {
        fromDateStr = targetDateStr;
        toDateStr = targetDateStr;
        periodLabel = `${targetDayStr}/${targetMonthStr}/${targetYear}`;
        sinceDate = new Date(`${targetDateStr}T00:00:00.000+07:00`);
        untilDate = new Date(`${targetDateStr}T23:59:59.999+07:00`);
      }

      const period = { from: fromDateStr, to: toDateStr, label: periodLabel };
      const sinceUnix = Math.floor(sinceDate.getTime() / 1000);
      const untilUnix = Math.floor(untilDate.getTime() / 1000);

      // 1. Tìm trong SocialAccount (OAuth accounts)
      let socialAccount = null;

      if (expectedPlatform) {
        // Ưu tiên cao nhất: tìm đúng tài khoản có platform trùng khớp
        socialAccount = await this.prisma.socialAccount.findFirst({
          where: {
            is_active: true,
            platform: expectedPlatform as any,
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
      }

      // Nếu chưa tìm thấy với expectedPlatform hoặc không truyền platform, tìm theo ID trước (tránh tìm nhầm theo tên giữa các platform)
      if (!socialAccount) {
        socialAccount = await this.prisma.socialAccount.findFirst({
          where: {
            is_active: true,
            OR: [
              { id: channelIdClean },
              { platform_id: channelIdClean },
              { platform_id: `page_${channelIdClean}` },
              { platform_id: pageIdClean },
              ...(!expectedPlatform ? [
                { name: { equals: channelIdClean, mode: 'insensitive' as const } },
                { name: { equals: cleanName, mode: 'insensitive' as const } },
                { username: { equals: channelIdClean, mode: 'insensitive' as const } },
                { username: { equals: cleanName, mode: 'insensitive' as const } },
              ] : []),
            ],
          },
        });
      }

      // Nếu chưa tìm thấy trực tiếp, thử đối chiếu qua Channel table để lấy channel_id / tên chuẩn
      if (!socialAccount) {
        const chan = await this.prisma.channel.findFirst({
          where: {
            ...(expectedPlatform ? { platform: { equals: expectedPlatform, mode: 'insensitive' } } : {}),
            OR: [
              { id: channelIdClean },
              { channel_id: channelIdClean },
              { name: { equals: channelIdClean, mode: 'insensitive' } },
              { name: { equals: cleanName, mode: 'insensitive' } },
            ],
          },
        });
        if (chan) {
          const chanPlat = chan.platform ? (platMap[chan.platform.toUpperCase().trim()] || chan.platform.toUpperCase().trim()) : expectedPlatform;
          const cId = (chan.channel_id || '').replace(/^page_/, '').trim();
          const cName = chan.name.trim();
          socialAccount = await this.prisma.socialAccount.findFirst({
            where: {
              is_active: true,
              ...(chanPlat ? { platform: chanPlat as any } : {}),
              OR: [
                ...(cId ? [{ platform_id: cId }, { platform_id: `page_${cId}` }, { id: cId }] : []),
                { name: { equals: cName, mode: 'insensitive' } },
                { username: { equals: cName, mode: 'insensitive' } },
              ],
            },
          });
        }
      }

      // 2. Tìm trong video_management_managedfacebookpage (Chỉ tìm khi nền tảng là FACEBOOK hoặc không truyền)
      const managedFbPage = (!expectedPlatform || expectedPlatform === 'FACEBOOK')
        ? await this.prisma.video_management_managedfacebookpage.findFirst({
            where: {
              OR: [
                { page_id: pageIdClean },
                { page_id: channelIdClean },
                { name: { equals: channelIdClean, mode: 'insensitive' } },
                { name: { equals: cleanName, mode: 'insensitive' } },
                { username: { equals: channelIdClean, mode: 'insensitive' } },
              ],
            },
          })
        : null;

      // 3. Tìm trong TrackedChannel
      const tracked = await this.prisma.trackedChannel.findFirst({
        where: {
          is_active: true,
          ...(expectedPlatform ? { platform: expectedPlatform as any } : {}),
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
              try {
                const insightRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/insights`, {
                  params: {
                    metric: 'page_video_views,page_video_views_organic,page_posts_impressions_organic,page_post_engagements',
                    period: 'day',
                    since: sinceUnix,
                    until: untilUnix,
                    access_token: decryptedToken,
                  },
                  timeout: 8000,
                });
                const dataList = insightRes.data?.data || [];

                let videoViewsTotal = 0;   // page_video_views: Đã bao gồm cả organic và paid!
                let videoViewsOrganic = 0; // page_video_views_organic: Chỉ organic
                let postImpressionsOrganic = 0; // Organic impressions
                let postEngagements = 0;

                for (const item of dataList) {
                  const values = item.values || [];
                  const sumVal = values.reduce((acc: number, cur: any) => acc + Number(cur.value || 0), 0);
                  if (item.name === 'page_video_views') {
                    videoViewsTotal = sumVal;
                  } else if (item.name === 'page_video_views_organic') {
                    videoViewsOrganic = sumVal;
                  } else if (item.name === 'page_posts_impressions_organic') {
                    postImpressionsOrganic = sumVal;
                  } else if (item.name === 'page_post_engagements') {
                    postEngagements = sumVal;
                  }
                }

                // Theo chuẩn yêu cầu: Lấy 1 (page_video_views) + 2 (page_video_views_organic)
                const totalViews = (videoViewsTotal > 0 || videoViewsOrganic > 0)
                  ? (videoViewsTotal + videoViewsOrganic)
                  : postImpressionsOrganic;

                // Đã gọi thành công Meta Graph API — trả về số liệu chính thức (kể cả views = 0)
                return {
                  success: true,
                  views: totalViews,
                  period,
                  source: 'meta_graph_page_insights',
                  videoViewsTotal,
                  videoViewsOrganic,
                  impressions: postImpressionsOrganic,
                  engagements: postEngagements,
                };
              } catch (fbErr: any) {
                this.logger.warn(`[TrafficInsights] Facebook Graph Insights error for ${targetPlatformId}: ${fbErr.message}`);
              }
            } else if (platform === 'INSTAGRAM') {
              try {
                // 1. Gọi Account-level Insights chính thức với views, reach, total_interactions
                const insightRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/insights`, {
                  params: {
                    metric: 'views,reach,total_interactions',
                    metric_type: 'total_value',
                    period: 'day',
                    since: sinceUnix,
                    until: untilUnix,
                    access_token: decryptedToken,
                  },
                  timeout: 8000,
                });
                const dataList = insightRes.data?.data || [];
                let igViews = 0;
                let igReach = 0;
                let igInteractions = 0;

                for (const item of dataList) {
                  const val = Number(item.total_value?.value || 0);
                  if (item.name === 'views') {
                    igViews = val;
                  } else if (item.name === 'reach') {
                    igReach = val;
                  } else if (item.name === 'total_interactions') {
                    igInteractions = val;
                  }
                }

                // Đã gọi thành công Instagram Account Insights — trả về số liệu chính thức (kể cả views = 0)
                return {
                  success: true,
                  views: igViews > 0 ? igViews : igReach,
                  period,
                  source: igViews > 0 ? 'instagram_graph_views' : 'instagram_graph_reach',
                  reach: igReach,
                  impressions: igViews,
                  videoViewsTotal: igViews,
                  engagements: igInteractions,
                };
              } catch (igErr: any) {
                this.logger.warn(`[TrafficInsights] Instagram Account Insights error for ${targetPlatformId}: ${igErr.message}`);
              }

              // 2. Fallback: Lấy danh sách media và media insights thực tế (KHÔNG ước lượng bằng like*25)
              try {
                const mediaRes = await axios.get(`https://graph.facebook.com/v21.0/${targetPlatformId}/media`, {
                  params: {
                    fields: 'id,caption,media_type,timestamp,like_count,comments_count',
                    access_token: decryptedToken,
                    limit: 50,
                  },
                  timeout: 8000,
                });
                const mediaList = mediaRes.data?.data || [];
                let mediaViewsTotal = 0;
                let mediaReachTotal = 0;

                for (const m of mediaList) {
                  const mDate = m.timestamp ? new Date(m.timestamp) : null;
                  if (mDate && mDate >= sinceDate && mDate <= untilDate) {
                    try {
                      const mInsightRes = await axios.get(`https://graph.facebook.com/v21.0/${m.id}/insights`, {
                        params: {
                          metric: 'views,reach,total_interactions',
                          access_token: decryptedToken,
                        },
                        timeout: 3000,
                      });
                      const mMetrics = mInsightRes.data?.data || [];
                      for (const mi of mMetrics) {
                        const val = Number(mi.values?.[0]?.value || mi.total_value?.value || 0);
                        if (mi.name === 'views' || mi.name === 'plays') mediaViewsTotal += val;
                        if (mi.name === 'reach') mediaReachTotal += val;
                      }
                    } catch {
                      // Bỏ qua nếu media không có insights
                    }
                  }
                }

                if (mediaViewsTotal > 0 || mediaReachTotal > 0) {
                  return {
                    success: true,
                    views: mediaViewsTotal > 0 ? mediaViewsTotal : mediaReachTotal,
                    period,
                    source: mediaViewsTotal > 0 ? 'instagram_media_insights_views' : 'instagram_media_insights_reach',
                    reach: mediaReachTotal,
                  };
                }
              } catch (mediaErr: any) {
                this.logger.warn(`[TrafficInsights] Instagram Media error for ${targetPlatformId}: ${mediaErr.message}`);
              }

              // 3. Fallback: Tìm trong Scraper Instagram database
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
                  let igPlays = 0;
                  for (const r of scProfile.reels) {
                    const plays = Number(r.play_count || 0);
                    if (r.date_posted) {
                      const rDate = new Date(r.date_posted);
                      if (rDate >= sinceDate && rDate <= untilDate) {
                        igPlays += plays;
                      }
                    }
                  }
                  if (igPlays > 0) {
                    return {
                      success: true,
                      views: igPlays,
                      period,
                      source: isMtd ? 'db_instagram_reels_mtd' : 'db_instagram_reels_day',
                    };
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
                  return { success: true, views: totalYtViews, period, source: 'youtube_api_channel_stats' };
                }
              }
            }
          } catch (ytErr: any) {
            this.logger.warn(`[TrafficInsights] YouTube API error: ${ytErr.message}`);
          }
        }
      }

      // B) NẾU CÓ MANAGED FB PAGE TRONG DB: Ưu tiên tìm token giải mã được từ SocialAccount để gọi Graph API
      if (managedFbPage) {
        const pageSocial = await this.prisma.socialAccount.findFirst({
          where: {
            is_active: true,
            platform: 'FACEBOOK',
            OR: [
              { platform_id: managedFbPage.page_id },
              { platform_id: `page_${managedFbPage.page_id}` },
              { name: { equals: managedFbPage.name, mode: 'insensitive' } },
            ],
          },
        });

        const tokenToUse = pageSocial?.access_token_enc
          ? this.crypto.decrypt(pageSocial.access_token_enc)
          : null;

        if (tokenToUse) {
          try {
            const insightRes = await axios.get(`https://graph.facebook.com/v21.0/${managedFbPage.page_id}/insights`, {
              params: {
                metric: 'page_video_views,page_video_views_organic,page_posts_impressions_organic,page_post_engagements',
                period: 'day',
                since: sinceUnix,
                until: untilUnix,
                access_token: tokenToUse,
              },
              timeout: 8000,
            });
            const dataList = insightRes.data?.data || [];
            let videoViewsTotal = 0;
            let videoViewsOrganic = 0;
            let postImpressionsOrganic = 0;
            let postEngagements = 0;

            for (const item of dataList) {
              const values = item.values || [];
              const sumVal = values.reduce((acc: number, cur: any) => acc + Number(cur.value || 0), 0);
              if (item.name === 'page_video_views') {
                videoViewsTotal = sumVal;
              } else if (item.name === 'page_video_views_organic') {
                videoViewsOrganic = sumVal;
              } else if (item.name === 'page_posts_impressions_organic') {
                postImpressionsOrganic = sumVal;
              } else if (item.name === 'page_post_engagements') {
                postEngagements = sumVal;
              }
            }

            // Theo chuẩn yêu cầu: Lấy 1 (page_video_views) + 2 (page_video_views_organic)
            const totalViews = (videoViewsTotal > 0 || videoViewsOrganic > 0)
              ? (videoViewsTotal + videoViewsOrganic)
              : postImpressionsOrganic;

            return {
              success: true,
              views: totalViews,
              period,
              source: 'meta_graph_page_insights',
              videoViewsTotal,
              videoViewsOrganic,
              impressions: postImpressionsOrganic,
              engagements: postEngagements,
            };
          } catch (fbErr: any) {
            this.logger.warn(`[TrafficInsights] Managed FB Page Insights error for ${managedFbPage.page_id}: ${fbErr.message}`);
          }
        }

        const periodAgg = await this.prisma.video_management_ownedvideocontent.aggregate({
          where: {
            managed_page_id: managedFbPage.id,
            published_at: { gte: sinceDate, lte: untilDate },
          },
          _sum: { view_count: true, reach_count: true },
        });
        const viewsPeriod = Number(periodAgg._sum.view_count || periodAgg._sum.reach_count || 0);
        if (viewsPeriod > 0) {
          return {
            success: true,
            views: viewsPeriod,
            period,
            source: isMtd ? 'db_owned_videos_mtd' : 'db_owned_videos_day',
          };
        }

        // Nếu trong kỳ chưa có video, lấy tổng views từ các video gần nhất
        const recentVideos = await this.prisma.video_management_ownedvideocontent.findMany({
          where: { managed_page_id: managedFbPage.id },
          orderBy: { published_at: 'desc' },
          take: 10,
          select: { view_count: true },
        });
        const recentViews = recentVideos.reduce((sum, v) => sum + Number(v.view_count || 0), 0);
        if (recentViews > 0) {
          return { success: true, views: recentViews, period, source: 'db_owned_videos_recent' };
        }
      }

      // C) NẾU CÓ TRACKED CHANNEL: Lấy từ video posts
      if (tracked) {
        const postAgg = await this.prisma.videoPost.aggregate({
          where: {
            channel_id: tracked.id,
            posted_at: { gte: sinceDate, lte: untilDate },
          },
          _sum: { views: true },
        });
        const postViews = Number(postAgg._sum.views || 0);
        if (postViews > 0) {
          return {
            success: true,
            views: postViews,
            period,
            source: isMtd ? 'db_tracked_posts_mtd' : 'db_tracked_posts_day',
          };
        }
        if (tracked.total_views && Number(tracked.total_views) > 0) {
          return { success: true, views: Number(tracked.total_views), period, source: 'db_tracked_total' };
        }
      }

      // D) Không tìm thấy hoặc chưa có số liệu: trả về 0 một cách an toàn
      return { success: true, views: 0, period, source: 'none' };
    } catch (error: any) {
      this.logger.error(`[TrafficInsights] Error: ${error.message}`);
      return { success: false, views: 0, message: error.message };
    }
  }
}

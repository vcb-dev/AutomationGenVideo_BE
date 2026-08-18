import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';
import { resolveAiServiceUrlFromEnv } from '../../common/config/ai-service-url';

/**
 * Script fetching and PAAST scoring service for internal owned videos.
 */

/** Minimum character count for PAAST evaluation. */
const MIN_PAAST_CHAR_COUNT = 100;

/** Maximum character count allowed for PAAST evaluation before truncating. */
const MAX_PAAST_CHAR_COUNT = 3000;

/** Marker recorded when a script lookup yielded no results to avoid repeated queries. */
const NO_SCRIPT_MARKER = 'khong_co';

export type PaastStatusCode =
  | 'da_cham'
  | 'co_kich_ban'
  | 'chua_co_kich_ban'
  | 'qua_ngan'
  | 'khong_ho_tro';

// Backward compatibility alias
export type TrangThaiKichBan = PaastStatusCode;

export interface PaastScoreResult {
  statusCode: PaastStatusCode;
  source?: string;
  language?: string;
  charCount?: number;
  script?: string;
  analysis?: unknown;
  note?: string;

  // Backward compatibility
  trang_thai?: PaastStatusCode;
  nguon?: string;
  ngon_ngu?: string;
  so_ky_tu?: number;
  kich_ban?: string;
  phan_tich?: unknown;
  ghi_chu?: string;
}

// Backward compatibility alias
export type KetQuaPaastVideo = PaastScoreResult;

@Injectable()
export class OwnedScriptService {
  private readonly logger = new Logger(OwnedScriptService.name);
  private readonly aiServiceUrl = resolveAiServiceUrlFromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  /**
   * Bulk retrieves script and PAAST status for multiple video keys.
   */
  async statusMany(keys: { platform: string; post_id: string }[]) {
    if (!keys.length) return {};

    const rows = await this.prisma.ownedVideoScript.findMany({
      where: {
        nguon: { not: NO_SCRIPT_MARKER },
        OR: keys.map((k) => ({ platform: k.platform, post_id: k.post_id })),
      },
      select: {
        platform: true,
        post_id: true,
        so_ky_tu: true,
        nguon: true,
        paast_analysis_id: true,
        paast_analysis: { select: { status: true, analysis_result: true } },
      },
    });

    const result: Record<
      string,
      {
        statusCode: PaastStatusCode;
        passed: boolean | null;
        charCount: number;
        trang_thai: PaastStatusCode;
        dat: boolean | null;
        so_ky_tu: number;
      }
    > = {};

    for (const r of rows) {
      const alreadyScored = r.paast_analysis?.status === 'SUCCESS';
      const kq = r.paast_analysis?.analysis_result as { verdict?: { passed?: boolean } } | null;
      const statusCode: PaastStatusCode = alreadyScored
        ? 'da_cham'
        : r.so_ky_tu < MIN_PAAST_CHAR_COUNT
          ? 'qua_ngan'
          : 'co_kich_ban';
      const passed = alreadyScored ? kq?.verdict?.passed ?? null : null;

      result[`${r.platform}:${r.post_id}`] = {
        statusCode,
        passed,
        charCount: r.so_ky_tu,
        // Backward compatibility
        trang_thai: statusCode,
        dat: passed,
        so_ky_tu: r.so_ky_tu,
      };
    }
    return result;
  }

  /**
   * Scores a single video with PAAST.
   */
  async scoreVideo(
    platform: string,
    postId: string,
    userId: string,
    subtitlesOnly = false,
  ): Promise<PaastScoreResult> {
    const script = await this.fetchScript(platform, postId, subtitlesOnly);
    if (!script) {
      const statusCode: PaastStatusCode = platform === 'facebook' ? 'chua_co_kich_ban' : 'khong_ho_tro';
      const note =
        platform === 'facebook'
          ? 'This video has no automatic subtitles generated on Facebook yet.'
          : `Transcript extraction is not currently supported for platform ${platform}.`;
      return {
        statusCode,
        note,
        trang_thai: statusCode,
        ghi_chu: note,
      };
    }

    const common = {
      source: script.nguon,
      language: script.ngon_ngu,
      charCount: script.so_ky_tu,
      script: script.noi_dung,
      nguon: script.nguon,
      ngon_ngu: script.ngon_ngu,
      so_ky_tu: script.so_ky_tu,
      kich_ban: script.noi_dung,
    };

    if (script.so_ky_tu < MIN_PAAST_CHAR_COUNT) {
      const note = `Script has only ${script.so_ky_tu} characters, PAAST requires at least ${MIN_PAAST_CHAR_COUNT}.`;
      return {
        ...common,
        statusCode: 'qua_ngan',
        note,
        trang_thai: 'qua_ngan',
        ghi_chu: note,
      };
    }

    const langCode = (script.ngon_ngu || '').toLowerCase();
    if (langCode && !langCode.startsWith('vi')) {
      const note = `Video transcript language is "${script.ngon_ngu}" — translation is required before PAAST scoring.`;
      return {
        ...common,
        statusCode: 'khong_ho_tro',
        note,
        trang_thai: 'khong_ho_tro',
        ghi_chu: note,
      };
    }

    let scoredContent = script.noi_dung;
    let truncateNote: string | undefined;
    if (scoredContent.length > MAX_PAAST_CHAR_COUNT) {
      const sliced = scoredContent.slice(0, MAX_PAAST_CHAR_COUNT);
      const sentenceBoundary = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '));
      scoredContent = sentenceBoundary > MAX_PAAST_CHAR_COUNT * 0.6 ? sliced.slice(0, sentenceBoundary + 1) : sliced;
      truncateNote = `Script length is ${script.so_ky_tu} characters. PAAST evaluated the first ${scoredContent.length} characters.`;
    }

    if (script.paast_analysis_id) {
      const existing = await this.prisma.paastAnalysisHistory.findUnique({
        where: { id: script.paast_analysis_id },
      });
      if (existing?.status === 'SUCCESS') {
        return {
          ...common,
          statusCode: 'da_cham',
          analysis: existing,
          trang_thai: 'da_cham',
          phan_tich: existing,
        };
      }
    }

    const freshResult: any = await this.aiIntegration.analyzeContentV2(userId, scoredContent);
    if (freshResult?.status === 'SUCCESS') {
      await this.prisma.ownedVideoScript.update({
        where: { id: script.id },
        data: { paast_analysis_id: freshResult.id },
      });
      return {
        ...common,
        statusCode: 'da_cham',
        analysis: freshResult,
        note: truncateNote,
        trang_thai: 'da_cham',
        phan_tich: freshResult,
        ghi_chu: truncateNote,
      };
    }

    const failureNote = freshResult?.error_message || 'PAAST evaluation failed';
    return {
      ...common,
      statusCode: 'co_kich_ban',
      note: failureNote,
      trang_thai: 'co_kich_ban',
      ghi_chu: failureNote,
    };
  }

  // Backward compatibility alias
  async chamDiemPaast(platform: string, postId: string, userId: string, chiPhuDe = false) {
    return this.scoreVideo(platform, postId, userId, chiPhuDe);
  }

  private async fetchScript(platform: string, postId: string, subtitlesOnly = false) {
    const existing = await this.prisma.ownedVideoScript.findUnique({
      where: { platform_post_id: { platform, post_id: postId } },
    });
    if (existing && existing.nguon !== NO_SCRIPT_MARKER) return existing;

    if (platform !== 'facebook') return null;

    let sourceResult: any = existing ? null : await this.getFacebookSubtitles(postId);
    if (!sourceResult && !subtitlesOnly) sourceResult = await this.getFacebookDialogue(postId);

    if (!sourceResult) {
      if (!existing) {
        await this.prisma.ownedVideoScript
          .create({
            data: { platform, post_id: postId, nguon: NO_SCRIPT_MARKER, noi_dung: '', so_ky_tu: 0, ngon_ngu: '' },
          })
          .catch(() => undefined);
      }
      return null;
    }

    const scriptData = {
      nguon: sourceResult.nguon === 'whisper' ? 'whisper' : 'phu_de',
      noi_dung: sourceResult.noi_dung,
      so_ky_tu: sourceResult.so_ky_tu,
      ngon_ngu: sourceResult.ngon_ngu || '',
    };
    return existing
      ? this.prisma.ownedVideoScript.update({ where: { id: existing.id }, data: scriptData })
      : this.prisma.ownedVideoScript.create({ data: { platform, post_id: postId, ...scriptData } });
  }

  private async getFacebookDialogue(postId: string) {
    const video = await this.prisma.$queryRaw<
      { page_id: string; permalink: string; tieng_viet: boolean }[]
    >`
      SELECT mp.page_id AS page_id,
             COALESCE(v.permalink_url, '') AS permalink,
             EXISTS (
               SELECT 1 FROM video_management_ownedvideocontent x
               WHERE x.managed_page_id = mp.id
                 AND x.caption ~* '[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]'
               LIMIT 1
             ) AS tieng_viet
      FROM video_management_ownedvideocontent v
      JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
      WHERE v.post_id = ${postId}
      LIMIT 1
    `;
    if (!video.length) return null;

    const videoId = /\/reel\/(\d+)/.exec(video[0].permalink)?.[1] || '';

    try {
      const { data } = await axios.post(
        `${this.aiServiceUrl}/api/facebook/fetch/video-transcript/`,
        {
          page_id: video[0].page_id,
          video_id: videoId,
          post_id: postId,
          permalink: video[0].permalink,
          tieng_viet: video[0].tieng_viet,
        },
        {
          headers: {
            Authorization: `Bearer ${this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' })}`,
          },
          timeout: 600_000,
        },
      );
      return data?.success ? data : null;
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        this.logger.warn(`Transcript extraction failed for ${postId}: ${e?.message}`);
      }
      return null;
    }
  }

  private async getFacebookSubtitles(postId: string) {
    const tokenRow = await this.prisma.$queryRaw<{ tok: string }[]>`
      SELECT mp.page_access_token AS tok
      FROM video_management_ownedvideocontent v
      JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
      WHERE v.post_id = ${postId} AND mp.page_access_token <> ''
      LIMIT 1
    `;
    if (!tokenRow.length) return null;

    try {
      const { data } = await axios.post(
        `${this.aiServiceUrl}/api/facebook/fetch/video-captions/`,
        { page_access_token_encrypted: tokenRow[0].tok, post_id: postId },
        {
          headers: {
            Authorization: `Bearer ${this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' })}`,
          },
          timeout: 60_000,
        },
      );
      return data?.success ? data : null;
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        this.logger.warn(`Subtitle fetch failed for ${postId}: ${e?.message}`);
      }
      return null;
    }
  }
}

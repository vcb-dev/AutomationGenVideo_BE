import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';

/**
 * Kịch bản + điểm PAAST cho video kênh nội bộ.
 *
 * ── Kịch bản lấy từ đâu ─────────────────────────────────────────────────────────
 * Theo thứ tự ưu tiên, dừng ở nguồn đầu tiên có:
 *   1. Đã lưu trong `owned_video_scripts` — dùng lại, không tốn gì.
 *   2. Phụ đề tự sinh của Facebook qua Graph API — ~2 giây, miễn phí, phủ ~34% video.
 *   3. Bóc lời thoại: RapidAPI lấy bản video CÓ TIẾNG rồi Whisper chạy tại máy — ~35 giây,
 *      không tốn tiền API, phủ phần còn lại.
 *   4. (chưa làm) kịch bản gốc từ task-auto khi nối được task ↔ bài đã đăng.
 *
 * Đã đo và LOẠI các đường khác: caption bài đăng chỉ 9,4% đạt mức tối thiểu 100 ký tự của
 * PAAST và vốn không phải kịch bản; video lấy từ Graph API luôn là bản CHỈ CÓ HÌNH (4/4 video
 * đo được `audio_stream=0`) nên Whisper không có gì để nghe — đó chính là lý do phải đi vòng
 * qua RapidAPI; yt-dlp trên link reel đòi đăng nhập, tải về 112 KB trang login rồi bỏ cuộc
 * sau hơn 4 phút.
 */

/** Mức tối thiểu của PAAST — xem AnalyzeContentDto. Chặn ở đây để khỏi tốn một lượt gọi LLM. */
const TOI_THIEU_KY_TU = 100;

/** Trần của PAAST — xem AnalyzeContentDto. Kịch bản dài hơn thì cắt chứ không bỏ chấm. */
const TOI_DA_KY_TU = 3000;

/** Dấu "đã thử lấy kịch bản mà không ra" — không phải kịch bản thật, xem layKichBan(). */
const KHONG_CO = 'khong_co';

export type TrangThaiKichBan = 'da_cham' | 'co_kich_ban' | 'chua_co_kich_ban' | 'qua_ngan' | 'khong_ho_tro';

export interface PaastVideoResult {
  trang_thai: TrangThaiKichBan;
  nguon?: string;
  ngon_ngu?: string;
  so_ky_tu?: number;
  kich_ban?: string;
  /** Bản ghi PaastAnalysisHistory — FE đưa thẳng vào PaastScoreModal qua prop `cachedResult`. */
  phan_tich?: unknown;
  ghi_chu?: string;
}

@Injectable()
export class OwnedScriptService {
  private readonly logger = new Logger(OwnedScriptService.name);
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly aiIntegration: AiIntegrationService,
  ) {}

  /**
   * Trạng thái kịch bản của nhiều video cùng lúc — để lưới 24 thẻ chỉ tốn MỘT lượt gọi.
   *
   * Chỉ ĐỌC bảng đã lưu, tuyệt đối không kích hoạt lấy phụ đề: mở trang mà tự động gọi
   * Graph API 24 lần thì vừa chậm vừa tốn hạn mức, trong khi người dùng có thể không bấm
   * chấm điểm cái nào.
   */
  async trangThaiNhieu(khoas: { platform: string; post_id: string }[]) {
    if (!khoas.length) return {};

    const rows = await this.prisma.ownedVideoScript.findMany({
      where: {
        nguon: { not: KHONG_CO },
        OR: khoas.map((k) => ({ platform: k.platform, post_id: k.post_id })),
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

    const ket: Record<
      string,
      { trang_thai: TrangThaiKichBan; dat: boolean | null; so_ky_tu: number }
    > = {};
    for (const r of rows) {
      const daCham = r.paast_analysis?.status === 'SUCCESS';
      // Bản 2 không có điểm số — ô trên thẻ video hiển thị ĐẠT / CHƯA ĐẠT theo verdict.
      const kq = r.paast_analysis?.analysis_result as { verdict?: { passed?: boolean } } | null;
      ket[`${r.platform}:${r.post_id}`] = {
        trang_thai: daCham ? 'da_cham' : r.so_ky_tu < TOI_THIEU_KY_TU ? 'qua_ngan' : 'co_kich_ban',
        dat: daCham ? kq?.verdict?.passed ?? null : null,
        so_ky_tu: r.so_ky_tu,
      };
    }
    return ket;
  }

  /**
   * Lấy kịch bản và điểm PAAST của một video; tự chấm nếu chưa có.
   *
   * Chỉ gọi khi người dùng CHỦ ĐỘNG bấm — bên trong có thể tốn một lượt LLM.
   */
  async chamDiem(
    platform: string,
    postId: string,
    userId: string,
    chiPhuDe = false,
  ): Promise<PaastVideoResult> {
    const kichBan = await this.layKichBan(platform, postId, chiPhuDe);
    if (!kichBan) {
      return {
        trang_thai: platform === 'facebook' ? 'chua_co_kich_ban' : 'khong_ho_tro',
        ghi_chu:
          platform === 'facebook'
            ? 'Video này chưa có phụ đề tự sinh trên Facebook nên chưa lấy được kịch bản.'
            : `Chưa hỗ trợ lấy kịch bản cho nền tảng ${platform}.`,
      };
    }

    const chung = {
      nguon: kichBan.nguon,
      ngon_ngu: kichBan.ngon_ngu,
      so_ky_tu: kichBan.so_ky_tu,
      kich_ban: kichBan.noi_dung,
    };

    if (kichBan.so_ky_tu < TOI_THIEU_KY_TU) {
      return {
        ...chung,
        trang_thai: 'qua_ngan',
        ghi_chu: `Kịch bản chỉ ${kichBan.so_ky_tu} ký tự, PAAST cần tối thiểu ${TOI_THIEU_KY_TU}.`,
      };
    }

    // Bộ tiêu chí và prompt của PAAST đều viết bằng tiếng Việt. Đưa kịch bản tiếng Thái vào
    // vẫn ra một bản chấm trông như thật nhưng vô nghĩa — thà nói thẳng là chưa hỗ trợ.
    // 'th' là mã Whisper trả về; phụ đề Facebook trả dạng 'vi_VN' nên phải chấp nhận cả hai.
    const maNgonNgu = (kichBan.ngon_ngu || '').toLowerCase();
    if (maNgonNgu && !maNgonNgu.startsWith('vi')) {
      return {
        ...chung,
        trang_thai: 'khong_ho_tro',
        ghi_chu:
          `Kịch bản của video này là tiếng "${kichBan.ngon_ngu}", ` +
          'trong khi bộ tiêu chí PAAST viết cho tiếng Việt — cần dịch trước khi chấm.',
      };
    }

    // PAAST chỉ nhận tối đa 3.000 ký tự. Video dài bóc ra tới 5.320 ký tự (đo được), trước
    // đây rơi thẳng vào nhánh lỗi và không chấm được gì. Cắt ở ranh giới câu gần nhất rồi
    // vẫn chấm — phần mở đầu là nơi PAAST soi kỹ nhất (hook, insight chủ đạo) nên giữ đầu
    // bỏ đuôi có ích hơn là không chấm.
    let noiDungCham = kichBan.noi_dung;
    let ghiChuCat: string | undefined;
    if (noiDungCham.length > TOI_DA_KY_TU) {
      const cat = noiDungCham.slice(0, TOI_DA_KY_TU);
      const ranhCau = Math.max(cat.lastIndexOf('. '), cat.lastIndexOf('! '), cat.lastIndexOf('? '));
      noiDungCham = ranhCau > TOI_DA_KY_TU * 0.6 ? cat.slice(0, ranhCau + 1) : cat;
      ghiChuCat =
        `Kịch bản dài ${kichBan.so_ky_tu} ký tự, PAAST chỉ nhận ${TOI_DA_KY_TU} — ` +
        `đã chấm trên ${noiDungCham.length} ký tự đầu.`;
    }

    // Đã chấm rồi thì trả lại bản cũ — kể cả người chấm là đồng nghiệp khác. Đây là lý do
    // phải đi qua paast_analysis_id thay vì findLatestByContent(): hàm đó lọc theo user_id
    // nên mỗi người mở cùng một video lại tốn thêm một lượt LLM và cho ra điểm khác nhau.
    if (kichBan.paast_analysis_id) {
      const cu = await this.prisma.paastAnalysisHistory.findUnique({
        where: { id: kichBan.paast_analysis_id },
      });
      if (cu?.status === 'SUCCESS') return { ...chung, trang_thai: 'da_cham', phan_tich: cu };
    }

    // Bản 2: không thang điểm 100, có 16 hook gợi ý — khớp với paast.vercel.app.
    const moi: any = await this.aiIntegration.analyzeContentV2(userId, noiDungCham);
    if (moi?.status === 'SUCCESS') {
      await this.prisma.ownedVideoScript.update({
        where: { id: kichBan.id },
        data: { paast_analysis_id: moi.id },
      });
      return { ...chung, trang_thai: 'da_cham', phan_tich: moi, ghi_chu: ghiChuCat };
    }

    return { ...chung, trang_thai: 'co_kich_ban', ghi_chu: moi?.error_message || 'Chấm điểm thất bại' };
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  /**
   * @param chiPhuDe Chỉ thử phụ đề Facebook, KHÔNG đụng tới Whisper.
   *
   * Cron dùng chế độ này: đường Whisper cần RapidAPI mà gói hiện tại chỉ có 200 lượt/tháng
   * — chạy nền hàng loạt là cháy hạn mức trong một đêm. Người dùng bấm tay thì vẫn đủ cả hai.
   */
  private async layKichBan(platform: string, postId: string, chiPhuDe = false) {
    const daCo = await this.prisma.ownedVideoScript.findUnique({
      where: { platform_post_id: { platform, post_id: postId } },
    });
    // `khong_co` là DẤU đã thử mà không ra, không phải kịch bản thật. Gặp dấu này thì vẫn
    // cho thử lại bằng Whisper (nếu được phép) — biết đâu lần này ra.
    if (daCo && daCo.nguon !== KHONG_CO) return daCo;

    if (platform !== 'facebook') return null;

    // Phụ đề trước (2 giây, miễn phí, ~34% video có), rồi mới tới bóc lời thoại
    // (~91 giây, tốn hạn mức RapidAPI).
    let nguonLay: any = daCo ? null : await this.layPhuDeFacebook(postId);
    if (!nguonLay && !chiPhuDe) nguonLay = await this.layLoiThoaiFacebook(postId);

    if (!nguonLay) {
      // Ghi dấu để lần quét nền sau không hỏi lại Graph API cho cùng một video.
      if (!daCo) {
        await this.prisma.ownedVideoScript
          .create({
            data: { platform, post_id: postId, nguon: KHONG_CO, noi_dung: '', so_ky_tu: 0, ngon_ngu: '' },
          })
          .catch(() => undefined);
      }
      return null;
    }

    const duLieu = {
      nguon: nguonLay.nguon === 'whisper' ? 'whisper' : 'phu_de',
      noi_dung: nguonLay.noi_dung,
      so_ky_tu: nguonLay.so_ky_tu,
      ngon_ngu: nguonLay.ngon_ngu || '',
    };
    return daCo
      ? this.prisma.ownedVideoScript.update({ where: { id: daCo.id }, data: duLieu })
      : this.prisma.ownedVideoScript.create({ data: { platform, post_id: postId, ...duLieu } });
  }

  /**
   * Bóc lời thoại khi video chưa có phụ đề tự sinh — khoảng 2/3 số video rơi vào đây.
   *
   * Chậm (~35 giây) nên chỉ chạy sau khi phụ đề đã thất bại, và chỉ khi người dùng chủ động
   * bấm chấm điểm. Kết quả lưu lại nên mỗi video chỉ tốn một lần.
   */
  private async layLoiThoaiFacebook(postId: string) {
    // `tieng_viet` quyết định Whisper có dùng bộ từ điển tiếng Việt hay không. Đoán theo
    // dấu tiếng Việt trong caption của CHÍNH TRANG đó (không phải riêng video này — caption
    // một video có thể rỗng), cùng lớp ký tự với bộ lọc thị trường sẵn có.
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

    // video_id nằm trong permalink dạng facebook.com/reel/<id>/ — RapidAPI đối chiếu theo id này.
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
          // Tải video + bóc audio + nhận dạng: đo thật 35 giây, để rộng cho video dài.
          timeout: 600_000,
        },
      );
      return data?.success ? data : null;
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        this.logger.warn(`Bóc lời thoại ${postId} lỗi: ${e?.message}`);
      }
      return null;
    }
  }

  /**
   * Hỏi AI service lấy phụ đề tự sinh. Token của trang đi qua dạng ĐÃ MÃ HOÁ — AI là nơi
   * duy nhất giữ FERNET_KEY, BE chỉ chuyển tiếp nguyên chuỗi.
   */
  private async layPhuDeFacebook(postId: string) {
    const trang = await this.prisma.$queryRaw<{ tok: string }[]>`
      SELECT mp.page_access_token AS tok
      FROM video_management_ownedvideocontent v
      JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
      WHERE v.post_id = ${postId} AND mp.page_access_token <> ''
      LIMIT 1
    `;
    if (!trang.length) return null;

    try {
      const { data } = await axios.post(
        `${this.aiServiceUrl}/api/facebook/fetch/video-captions/`,
        { page_access_token_encrypted: trang[0].tok, post_id: postId },
        {
          headers: {
            Authorization: `Bearer ${this.jwtService.sign({ sub: 'be-system', email: 'be-system@internal.local' })}`,
          },
          timeout: 60_000,
        },
      );
      return data?.success ? data : null;
    } catch (e: any) {
      // 404 = video chưa có phụ đề, chuyện bình thường với ~2/3 video nên KHÔNG log như lỗi.
      if (e?.response?.status !== 404) {
        this.logger.warn(`Lấy phụ đề ${postId} lỗi: ${e?.message}`);
      }
      return null;
    }
  }
}

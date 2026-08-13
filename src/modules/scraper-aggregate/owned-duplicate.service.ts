import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { chuanHoaKhoang, chuanHoaNenTang, daysBetween } from './owned-stats.service';

/**
 * Phát hiện MỘT video được đăng trên NHIỀU kênh nội bộ khác nhau.
 *
 * ── Vì sao tách khỏi OwnedStatsService ──────────────────────────────────────────
 * File đó đã 715 dòng và đang chạy 8 truy vấn trong một Promise.all. Khối trùng lặp có
 * vòng đời riêng (FE tự tải, tự hiện khung chờ) nên gộp vào chỉ làm cả trang chờ lâu hơn
 * mà không được gì.
 *
 * ── Luật nhận diện "cùng một video" ─────────────────────────────────────────────
 * Khoá = (nền tảng, caption chuẩn hoá, độ dài giây). Đo trên dữ liệu thật (05/08/2026,
 * 20.515 video / 94 fanpage) rồi loại dần:
 *
 *   thumbnail_url  → 0 nhóm trùng. Facebook sinh URL CDN mới mỗi lần upload.
 *   xpv_asset_id   → 16/20.506 trùng. Mỗi kênh upload lại file nên có asset riêng.
 *   bỏ hashtag rồi so phần chữ → gộp nhầm nặng: "bông tai moissanite" gom 11 kênh,
 *                    độ dài lệch từ 23s tới 69s, rõ ràng là các video khác nhau.
 *   caption y hệt  → 1.056/1.152 nhóm (91,7%) tự khớp luôn độ dài. Chính xác.
 *   + độ dài       → tách đúng 85 nhóm còn gộp nhầm.
 *
 * Đây là khớp caption + độ dài, KHÔNG phải khớp file video: video bị sửa caption sẽ lọt
 * lưới, hai video khác nhau trùng cả caption lẫn độ dài sẽ bị gộp. Giao diện phải nói rõ.
 */

/** Caption ngắn hơn ngần này thì bỏ qua — loại 247/20.515 bản ghi (1,2%), tránh gộp bừa. */
const CAPTION_TOI_THIEU = 20;

/** Số nhóm trả về cho khối trên trang tổng quan. */
const SO_NHOM_TRA_VE = 20;

/** Kênh phải có ít nhất ngần này video trong kỳ thì tỷ lệ trùng mới có nghĩa. */
const SAN_VIDEO_CANH_BAO = 20;

/** Tỷ lệ trùng từ ngần này trở lên thì kênh bị coi là không có nội dung riêng. */
const NGUONG_TY_LE_CANH_BAO = 90;

/** Cùng lý do đã ghi ở OwnedStatsService: nguồn số chỉ đổi mỗi ngày một lần lúc cron cào. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface DongNhomTrung {
  platform: string;
  cap: string;
  giay: number | null;
  so_kenh: bigint;
  so_video: bigint;
  views: bigint;
  kenh_id: string[];
  kenh_ten: string[];
  ngay_dau: Date;
  ngay_cuoi: Date;
  url_mau: string;
}

export interface DongVideoKenh {
  platform: string;
  kenh_id: string;
  kenh_ten: string;
  video_trung: bigint;
  tong_video: bigint;
}

interface DongTomTat {
  so_nhom: bigint;
  so_nhom_tu_3_kenh: bigint;
  so_video_trung: bigint;
  tong_video: bigint;
  so_kenh_dinh: bigint;
}

/** Cùng hình dạng với cảnh báo của OwnedStatsService để FE trộn thẳng hai danh sách. */
export interface CanhBaoKenh {
  platform: string;
  kenh: string;
  noi_dung: string;
  muc: 'w' | 'b';
  nhan: string;
}

export interface NhomTrung {
  noi_dung: string;
  platform: string;
  giay: number | null;
  so_kenh: number;
  so_video: number;
  views: number;
  kenh: { id: string; ten: string }[];
  ngay_dau: string;
  ngay_cuoi: string;
  url_mau: string;
}

export interface TrungTheoKenh {
  platform: string;
  id: string;
  ten: string;
  video_trung: number;
  tong_video: number;
  ty_le: number;
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/** Làm tròn 1 chữ số thập phân. 71/72 → 98,6 chứ không phải 98,61111. */
const mot = (v: number): number => Math.round(v * 10) / 10;

// ── Phần thuần logic — tách ra để test được, xem owned-duplicate.service.spec.ts ──

/**
 * Cắt caption cho vừa ô hiển thị, đếm theo KÝ TỰ HIỂN THỊ chứ không theo mã đơn vị.
 *
 * `slice()` cắt theo UTF-16: caption tiếng Việt ở dạng tổ hợp (e + U+0309) chiếm 2 mã đơn vị,
 * cắt trúng giữa thì để lại dấu thanh mồ côi hiện thành ô vuông. Chuẩn hoá NFC trước rồi
 * duyệt bằng spread để mỗi phần tử là một ký tự trọn vẹn.
 */
export function rutGonNoiDung(cap: string, toiDa: number): string {
  if (!cap) return '';
  const chuan = cap.normalize('NFC');
  const kyTu = [...chuan];
  return kyTu.length <= toiDa ? chuan : kyTu.slice(0, toiDa).join('') + '…';
}

/** Dựng danh sách nhóm trùng, nhiều kênh trước rồi tới lượt xem cao trước. */
export function mergeGroups(rows: DongNhomTrung[]): NhomTrung[] {
  return rows
    .map((r) => ({
      noi_dung: r.cap,
      platform: r.platform,
      giay: r.giay,
      so_kenh: n(r.so_kenh),
      so_video: n(r.so_video),
      views: n(r.views),
      // kenh_id và kenh_ten được gộp trong CÙNG một array_agg có cùng ORDER BY nên chỉ số
      // khớp cặp. Gộp bằng hai array_agg(DISTINCT ...) riêng là sai cặp ngay khi hai kênh
      // trùng tên hoặc một kênh chưa có tên.
      kenh: r.kenh_id.map((id, i) => ({ id, ten: r.kenh_ten[i] ?? id })),
      // Chuỗi ISO chứ không phải Date: qua Redis thì Date đã thành chuỗi, còn cache trong
      // bộ nhớ vẫn là Date — để nguyên là FE nhận hai kiểu tuỳ máy có Redis hay không.
      ngay_dau: r.ngay_dau.toISOString(),
      ngay_cuoi: r.ngay_cuoi.toISOString(),
      url_mau: r.url_mau ?? '',
    }))
    .sort((a, b) => b.so_kenh - a.so_kenh || b.views - a.views);
}

/** Tỷ lệ video trùng của từng kênh, cao trước. */
export function computeByChannel(rows: DongVideoKenh[]): TrungTheoKenh[] {
  return rows
    .map((r) => {
      const tong = n(r.tong_video);
      const trung = n(r.video_trung);
      return {
        platform: r.platform,
        id: r.kenh_id,
        ten: r.kenh_ten || r.kenh_id,
        video_trung: trung,
        tong_video: tong,
        // Kênh không có video nào trong kỳ vẫn lọt vào đây khi lọc theo nền tảng — chia
        // thẳng là ra NaN, và NaN qua JSON thành null làm vỡ biểu đồ bên FE.
        ty_le: tong > 0 ? mot((trung / tong) * 100) : 0,
      };
    })
    .sort((a, b) => b.ty_le - a.ty_le || b.video_trung - a.video_trung);
}

/**
 * Cảnh báo cho khối "Cần chú ý" — CHỈ cấp kênh, cố ý không có cảnh báo cấp nhóm nội dung.
 *
 * Thiết kế đầu định báo mỗi nhóm phủ ≥3 kênh, đo ra 75 cảnh báo ở kỳ 28 ngày và 333 ở kỳ
 * 90 ngày. Khối "Cần chú ý" cắt ở 12 mục nên chúng sẽ đẩy hết cảnh báo đồng bộ lỗi và kênh
 * im lặng ra ngoài. Thêm nữa CanhBaoKenh vẽ avatar + tên kênh, mà một nhóm nội dung phủ 4
 * kênh không có MỘT kênh nào để gắn — sẽ ra avatar rỗng. Số liệu cấp nhóm nằm ở khối trùng
 * lặp, nơi có chỗ trình bày tử tế.
 */
export function buildDuplicateAlerts(byChannel: TrungTheoKenh[]): CanhBaoKenh[] {
  return byChannel
    .filter((k) => k.tong_video >= SAN_VIDEO_CANH_BAO && k.ty_le >= NGUONG_TY_LE_CANH_BAO)
    .map((k) => ({
      platform: k.platform,
      kenh: k.ten,
      noi_dung:
        `${k.video_trung}/${k.tong_video} video trong kỳ trùng với kênh khác ` +
        `(${String(k.ty_le).replace('.', ',')}%) — gần như không có nội dung riêng`,
      muc: 'b' as const,
      nhan: 'Trùng',
    }));
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class OwnedDuplicateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async thongKe(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    const platform = chuanHoaNenTang(params.platform);
    const { tu, den } = chuanHoaKhoang(params.tu, params.den, params.days);

    return this.cache.get(`owned-dup:${platform || 'all'}:${tu}:${den}`, CACHE_TTL_MS, () =>
      this.tinh(platform, tu, den),
    );
  }

  private async tinh(platform: string, tu: string, den: string) {
    const mocTu = new Date(`${tu}T00:00:00.000+07:00`);
    const mocDen = new Date(`${den}T23:59:59.999+07:00`);
    const nguon = this.nguonVideoTrung(platform, mocTu, mocDen);

    // Nhóm trùng = cùng (nền tảng, caption, độ dài) mà xuất hiện ở từ 2 kênh trở lên.
    // GROUP BY coi các NULL bằng nhau nên nhánh YouTube (không có độ dài) vẫn gộp được.
    const nhomTrung = Prisma.sql`
      SELECT v.platform, v.cap, v.giay
      FROM (${nguon}) AS v
      GROUP BY 1, 2, 3
      HAVING COUNT(DISTINCT v.kenh_id) > 1
    `;

    // giay có thể NULL nên phải nối bằng IS NOT DISTINCT FROM; dùng `=` là mọi dòng
    // YouTube rơi khỏi phép nối và tỷ lệ trùng của nền tảng đó luôn ra 0.
    const joinGroups = Prisma.sql`
      LEFT JOIN (${nhomTrung}) AS g
        ON g.platform = v.platform AND g.cap = v.cap AND g.giay IS NOT DISTINCT FROM v.giay
    `;

    const [nhom, byChannelRaw, [tomTat]] = await Promise.all([
      // Gộp hai lớp: lớp trong gom theo KÊNH trước, lớp ngoài mới gom thành nhóm. Nhờ vậy
      // kenh_id và kenh_ten đi qua cùng một array_agg có cùng ORDER BY nên khớp cặp;
      // array_agg(DISTINCT ...) hai lần là sai cặp khi hai kênh trùng tên.
      this.prisma.$queryRaw<DongNhomTrung[]>`
        WITH v AS (${nguon}),
        k AS (
          SELECT v.platform, v.cap, v.giay, v.kenh_id,
                 MIN(v.kenh_ten) AS kenh_ten,
                 COUNT(*)::bigint AS so_video,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 MIN(v.ngay) AS ngay_dau, MAX(v.ngay) AS ngay_cuoi,
                 (array_agg(v.url ORDER BY v.views DESC))[1] AS url_mau
          FROM v GROUP BY 1, 2, 3, 4
        )
        SELECT k.platform, k.cap, k.giay,
               COUNT(*)::bigint AS so_kenh,
               SUM(k.so_video)::bigint AS so_video,
               SUM(k.views)::bigint AS views,
               array_agg(k.kenh_id ORDER BY k.views DESC) AS kenh_id,
               array_agg(k.kenh_ten ORDER BY k.views DESC) AS kenh_ten,
               MIN(k.ngay_dau) AS ngay_dau, MAX(k.ngay_cuoi) AS ngay_cuoi,
               (array_agg(k.url_mau ORDER BY k.views DESC))[1] AS url_mau
        FROM k GROUP BY 1, 2, 3
        HAVING COUNT(*) > 1
        ORDER BY so_kenh DESC, views DESC
        LIMIT ${SO_NHOM_TRA_VE}
      `,
      this.prisma.$queryRaw<DongVideoKenh[]>`
        SELECT v.platform, v.kenh_id, MIN(v.kenh_ten) AS kenh_ten,
               COUNT(*) FILTER (WHERE g.cap IS NOT NULL)::bigint AS video_trung,
               COUNT(*)::bigint AS tong_video
        FROM (${nguon}) AS v
        ${joinGroups}
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<DongTomTat[]>`
        SELECT (SELECT COUNT(*) FROM (${nhomTrung}) AS a)::bigint AS so_nhom,
               (SELECT COUNT(*) FROM (
                  SELECT 1 FROM (${nguon}) AS b
                  GROUP BY b.platform, b.cap, b.giay
                  HAVING COUNT(DISTINCT b.kenh_id) >= 3
                ) AS c)::bigint AS so_nhom_tu_3_kenh,
               COUNT(*) FILTER (WHERE g.cap IS NOT NULL)::bigint AS so_video_trung,
               COUNT(*)::bigint AS tong_video,
               COUNT(DISTINCT v.kenh_id) FILTER (WHERE g.cap IS NOT NULL)::bigint AS so_kenh_dinh
        FROM (${nguon}) AS v
        ${joinGroups}
      `,
    ]);

    const byChannel = computeByChannel(byChannelRaw);
    const tongVideo = n(tomTat?.tong_video);

    return {
      status: 'ok',
      ky: { tu, den, so_ngay: daysBetween(tu, den) },
      tom_tat: {
        so_nhom: n(tomTat?.so_nhom),
        so_nhom_tu_3_kenh: n(tomTat?.so_nhom_tu_3_kenh),
        so_video_trung: n(tomTat?.so_video_trung),
        tong_video: tongVideo,
        ty_le: tongVideo > 0 ? mot((n(tomTat?.so_video_trung) / tongVideo) * 100) : 0,
        so_kenh_dinh: n(tomTat?.so_kenh_dinh),
      },
      nhom: mergeGroups(nhom),
      theo_kenh: byChannel.filter((k) => k.video_trung > 0),
      canh_bao: buildDuplicateAlerts(byChannel),
    };
  }

  /**
   * Video kênh nội bộ trong kỳ, gộp 4 nền tảng về CÙNG bộ cột, kèm khoá nhận diện.
   *
   * Mọi nhánh đều phải ĐẶT TÊN CỘT và ÉP KIỂU tường minh: UNION ALL lấy tên lẫn kiểu cột
   * của nhánh ĐẦU TIÊN, mà nhánh đầu tiên đổi theo bộ lọc nền tảng. Bỏ alias ở các nhánh
   * sau thì để "tất cả" vẫn chạy (Facebook đứng đầu, có alias) nhưng lọc riêng TikTok là
   * hỏng ngay với lỗi `column v.cap does not exist` — cùng cái bẫy đã ghi ở nguonVideo().
   */
  private nguonVideoTrung(platform: string, tu: Date, den: Date): Prisma.Sql {
    const branches: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      branches.push(Prisma.sql`
        SELECT 'facebook'::text AS platform,
               COALESCE(mp.page_id, '')::text AS kenh_id,
               COALESCE(mp.name, '')::text AS kenh_ten,
               COALESCE(v.permalink_url, '')::text AS url,
               ${this.capChuan(Prisma.sql`v.caption`)} AS cap,
               ${DURATION_FACEBOOK} AS giay,
               v.view_count::bigint AS views,
               v.published_at AS ngay
        FROM video_management_ownedvideocontent v
        LEFT JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        ${EFG_FACEBOOK}
        WHERE v.published_at >= ${tu} AND v.published_at <= ${den}
          AND length(btrim(v.caption)) >= ${CAPTION_TOI_THIEU}
      `);
    }

    if (!platform || platform === 'tiktok') {
      branches.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               v.url::text AS url,
               ${this.capChuan(Prisma.sql`v.description`)} AS cap,
               NULLIF(v.video_duration, 0)::int AS giay,
               v.play_count::bigint AS views,
               v.date_posted AS ngay
        FROM scraper_tiktok_profile_videos v
        JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        WHERE p.is_owned = true AND v.date_posted >= ${tu} AND v.date_posted <= ${den}
          AND length(btrim(v.description)) >= ${CAPTION_TOI_THIEU}
      `);
    }

    if (!platform || platform === 'instagram') {
      branches.push(Prisma.sql`
        SELECT 'instagram'::text AS platform,
               p.username::text AS kenh_id,
               p.username::text AS kenh_ten,
               r.url::text AS url,
               ${this.capChuan(Prisma.sql`r.description`)} AS cap,
               NULLIF(round(r.duration_seconds)::int, 0) AS giay,
               r.play_count::bigint AS views,
               r.date_posted AS ngay
        FROM scraper_instagram_reels r
        JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        WHERE p.is_owned = true AND r.date_posted >= ${tu} AND r.date_posted <= ${den}
          AND length(btrim(r.description)) >= ${CAPTION_TOI_THIEU}
      `);
    }

    if (!platform || platform === 'youtube') {
      // Bảng Shorts không có trường độ dài NÀO — khoá chỉ còn tiêu đề, nên nhánh này dễ gộp
      // nhầm hơn ba nhánh kia. Chấp nhận: hiện chưa có kênh YouTube nội bộ nào để đo.
      // created_at là ngày CÀO VỀ chứ không phải ngày đăng, giống hệt cách nguonVideo() xử lý.
      branches.push(Prisma.sql`
        SELECT 'youtube'::text AS platform,
               p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS kenh_ten,
               s.url::text AS url,
               ${this.capChuan(Prisma.sql`s.title`)} AS cap,
               NULL::int AS giay,
               s.view_count::bigint AS views,
               s.created_at AS ngay
        FROM scraper_youtube_shorts s
        JOIN scraper_youtube_profiles p ON p.id = s.profile_id
        WHERE p.is_owned = true AND s.created_at >= ${tu} AND s.created_at <= ${den}
          AND length(btrim(s.title)) >= ${CAPTION_TOI_THIEU}
      `);
    }

    return Prisma.join(branches, ' UNION ALL ');
  }

  /** Chuẩn hoá caption: chỉ hạ hoa/thường và gộp khoảng trắng — xem ghi chú đầu file. */
  private capChuan(cot: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`lower(regexp_replace(btrim(${cot}), '\\s+', ' ', 'g'))::text`;
  }
}

/**
 * Bóc khối base64 `efg` ra khỏi link CDN. Đi kèm CROSS JOIN LATERAL nên mỗi dòng tính đúng
 * một lần, thay vì lặp lại cùng biểu thức ba chỗ trong CASE bên dưới.
 *
 * `%3D` là dấu `=` padding bị URL-encode — đo trên 20.506 bản ghi, đó là chuỗi %XX DUY NHẤT
 * từng xuất hiện, và không có ký tự base64url `-`/`_` nào.
 */
const EFG_FACEBOOK = Prisma.sql`
  CROSS JOIN LATERAL (
    SELECT replace(substring(v.video_url from '[?&]efg=([^&]+)'), '%3D', '=') AS chuoi
  ) AS e
`;

/**
 * Độ dài video Facebook, bóc từ khối `efg` ở trên.
 *
 * Bảng không có cột độ dài, nhưng link CDN mang sẵn một khối base64 chứa `duration_s`.
 * Đo trên 20.506 bản ghi có video_url: bóc được 100%, tốn ~1 giây cho toàn bảng và 185 ms
 * cho kỳ 28 ngày.
 *
 * Ba lớp chắn, vì `decode()` và `::jsonb` đều NÉM LỖI chứ không trả NULL — một link méo là
 * cả khối trùng lặp trả 500:
 *   1. CASE chặn trước: chỉ nhận đúng bảng chữ base64 và độ dài chia hết cho 4.
 *   2. convert_from dùng LATIN1 chứ không UTF8: mọi byte đều hợp lệ trong LATIN1 nên hàm
 *      không bao giờ ném lỗi, mà phần ASCII thì hai bảng mã trùng nhau.
 *   3. Bóc số bằng regexp thay vì `::jsonb` — khỏi phải tin thứ giải mã ra là JSON đúng.
 *
 * PHẢI là CASE chứ không phải `SELECT ... WHERE`: bản đầu viết dạng truy vấn con có WHERE,
 * chạy đúng trên 20.515 dòng thật nhưng vỡ ngay khi gặp hằng số — Postgres gấp hằng lúc lập
 * kế hoạch nên decode() chạy TRƯỚC cả WHERE và ném `invalid symbol "%"`. Với CASE thì nhánh
 * THEN chỉ được tính khi điều kiện đúng.
 */
const DURATION_FACEBOOK = Prisma.sql`
  CASE WHEN e.chuoi ~ '^[A-Za-z0-9+/]+={0,2}$' AND length(e.chuoi) % 4 = 0
       THEN NULLIF(substring(
              convert_from(decode(e.chuoi, 'base64'), 'LATIN1')
              from '"duration_s"[[:space:]]*:[[:space:]]*([0-9]+)'), '')::int
  END
`;

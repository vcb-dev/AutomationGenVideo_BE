import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Số liệu tổng quan cho trang "Tổng quan kênh nội bộ".
 *
 * ── Vì sao không tính lại từ /scraper/owned/videos ──────────────────────────────
 * Trang tổng quan cần TOÀN BỘ video trong kỳ (28 ngày ≈ 3.800 video Facebook) chứ không
 * phải một trang 24 video. Kéo hết về FE rồi cộng ở trình duyệt vừa chậm vừa sai khi số
 * video vượt giới hạn phân trang, nên mọi phép cộng đều làm bằng SQL ở đây.
 *
 * ── Chỉ 4 nền tảng ──────────────────────────────────────────────────────────────
 * Giống ownedChannels(): kênh nội bộ chỉ có khái niệm ở Facebook / TikTok / Instagram /
 * YouTube. Douyin và Xiaohongshu có mặt trong /owned/videos nhưng nhận diện "nội bộ" của
 * chúng dựa vào search_keyword chứ không có cờ is_owned thật, nên không đưa vào bảng số.
 *
 * Đo trên dữ liệu thật (04/08/2026): 20.515 video Facebook nội bộ / 95 fanpage; TikTok,
 * Instagram, YouTube đều CHƯA có kênh nội bộ nào. Vẫn viết đủ 4 nhánh để lúc bật kênh mới
 * lên là có số ngay, không phải sửa lại truy vấn.
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Việt Nam không có giờ mùa hè nên +07:00 là hằng số, ghép thẳng vào chuỗi ISO được. */
const VN_OFFSET = '+07:00';

export const NEN_TANG_NOI_BO = ['facebook', 'tiktok', 'instagram', 'youtube'] as const;
export type NenTangNoiBo = (typeof NEN_TANG_NOI_BO)[number];

/** Số ngày cho phép — khớp đúng 3 lựa chọn trên nút chọn kỳ ở FE. */
const SO_NGAY_HOP_LE = [7, 28, 90];
const SO_NGAY_MAC_DINH = 28;

/** Trần độ dài khoảng ngày — xem chuanHoaKhoang() về lý do phải chặn. */
const SO_NGAY_TOI_DA = 366;

/** Quá ngần này ngày không đăng bài thì kênh bị coi là im lặng. */
const NGUONG_IM_LANG = 7;

/** Lượt xem tụt quá ngần này so với kỳ trước thì cảnh báo. */
const NGUONG_TUT = -30;

/**
 * Bóc hashtag bằng regexp trên caption tốn ~3 giây với kỳ 90 ngày (12.173 video, 47.529 lần
 * khớp) — đo trên dữ liệu thật, và không rút ngắn được bằng chỉ mục vì đây là quét chữ.
 *
 * Cache được vì nguồn số chỉ đổi mỗi ngày một lần lúc cron cào chạy (00:0x giờ VN). Khoá
 * cache có kèm ngày VN nên tự hết hạn khi sang ngày mới, TTL chỉ để bắt các lần cào lại
 * trong ngày.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Nhận diện caption tiếng Việt để chia thị trường VN / Global.
 *
 * Cùng lớp ký tự với dieuKienThiTruong() trong content-filters.ts — hai chỗ phải khớp nhau,
 * lệch một ký tự là bộ lọc trên trang video và số liệu trên trang tổng quan đá nhau.
 * COALESCE vì `~*` gặp NULL trả NULL, video sẽ rơi khỏi CẢ HAI nhóm và tổng bị hụt.
 */
const DAU_TIENG_VIET = Prisma.sql`(COALESCE(v.mo_ta, '') ~* '[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]')`;

interface DongTong {
  platform: string;
  ky: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  so_kenh: bigint;
}

interface DongNgay {
  platform: string;
  ngay: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

interface DongKenh {
  platform: string;
  kenh_id: string;
  ky: string;
  posts: bigint;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

interface DongDanhSachKenh {
  platform: string;
  kenh_id: string;
  ten: string;
  avatar: string;
  followers: bigint;
  dong_bo: Date | null;
  loi: string | null;
  hoat_dong: boolean;
  ngay_cuoi: Date | null;
}

interface DongVideo {
  platform: string;
  post_id: string;
  url: string;
  mo_ta: string;
  thumbnail: string;
  views: bigint;
  likes: bigint;
  comments: bigint;
  ngay: Date;
  kenh_ten: string;
}

interface DongThiTruong {
  platform: string;
  vn: boolean;
  posts: bigint;
  views: bigint;
}

interface DongTuyen {
  ma: string;
  vn: boolean;
  posts: bigint;
  views: bigint;
}

interface DongHashtag {
  the: string;
  posts: bigint;
  views: bigint;
}

const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/** 'YYYY-MM-DD' theo giờ Việt Nam. 'sv-SE' cho ra đúng định dạng ISO, không phải d/m/y. */
function ngayVN(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: VN_TZ });
}

function dauNgay(ngay: string): Date {
  return new Date(`${ngay}T00:00:00.000${VN_OFFSET}`);
}

function cuoiNgay(ngay: string): Date {
  return new Date(`${ngay}T23:59:59.999${VN_OFFSET}`);
}

export function congNgay(ngay: string, delta: number): string {
  const d = new Date(`${ngay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class OwnedStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async thongKe(params: { platform?: string; days?: string; tu?: string; den?: string }) {
    const platform = chuanHoaNenTang(params.platform);
    const { tu, den } = chuanHoaKhoang(params.tu, params.den, params.days);

    return this.cache.get(
      `owned-stats:${platform || 'all'}:${tu}:${den}`,
      CACHE_TTL_MS,
      () => this.tinh(platform, tu, den),
    );
  }

  private async tinh(platform: string, tu: string, den: string) {
    // Kỳ trước là đúng ngần ấy ngày liền ngay trước kỳ đang xem, để hai kỳ so được với nhau.
    const soNgay = soNgayGiua(tu, den);
    const truocTu = congNgay(tu, -soNgay);
    const mocTu = dauNgay(tu);
    const mocDen = cuoiNgay(den);
    const mocTruocTu = dauNgay(truocTu);

    const nguon = this.nguonVideo(platform, mocTruocTu, mocDen);
    // Video của kỳ hiện tại — dùng lại cho top video / thị trường / tuyến / hashtag.
    const trongKy = Prisma.sql`SELECT * FROM ${nguon} AS v WHERE v.ngay >= ${mocTu}`;
    const nhanKy = Prisma.sql`CASE WHEN v.ngay >= ${mocTu} THEN 'nay' ELSE 'truoc' END`;

    const [tong, theoNgay, theoKenh, danhSachKenh, topVideo, thiTruong, tuyen, hashtag] =
      await Promise.all([
        this.prisma.$queryRaw<DongTong[]>`
          SELECT v.platform, ${nhanKy} AS ky,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares,
                 COUNT(DISTINCT v.kenh_id)::bigint AS so_kenh
          FROM ${nguon} AS v
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<DongNgay[]>`
          SELECT v.platform,
                 to_char((v.ngay AT TIME ZONE ${VN_TZ})::date, 'YYYY-MM-DD') AS ngay,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares
          FROM (${trongKy}) AS v
          GROUP BY 1, 2
        `,
        this.prisma.$queryRaw<DongKenh[]>`
          SELECT v.platform, v.kenh_id, ${nhanKy} AS ky,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views,
                 COALESCE(SUM(v.likes), 0)::bigint AS likes,
                 COALESCE(SUM(v.comments), 0)::bigint AS comments,
                 COALESCE(SUM(v.shares), 0)::bigint AS shares
          FROM ${nguon} AS v
          GROUP BY 1, 2, 3
        `,
        this.prisma.$queryRaw<DongDanhSachKenh[]>(this.nguonKenh(platform)),
        this.prisma.$queryRaw<DongVideo[]>`
          SELECT v.platform, v.post_id, v.url, v.mo_ta, v.thumbnail,
                 v.views, v.likes, v.comments, v.ngay, v.kenh_ten
          FROM (${trongKy}) AS v
          ORDER BY v.views DESC, v.post_id DESC
          LIMIT 12
        `,
        this.prisma.$queryRaw<DongThiTruong[]>`
          SELECT v.platform, ${DAU_TIENG_VIET} AS vn,
                 COUNT(*)::bigint AS posts,
                 COALESCE(SUM(v.views), 0)::bigint AS views
          FROM (${trongKy}) AS v
          GROUP BY 1, 2
        `,
        // regexp_matches(...,'g') trả MỘT DÒNG mỗi lần khớp, nên caption gắn #A1 hai lần sẽ
        // được cộng lượt xem hai lần. DISTINCT ở lớp trong gộp các lần khớp trùng lại trước
        // khi cộng — cùng lý do đã ghi ở ownedHashtags().
        this.prisma.$queryRaw<DongTuyen[]>`
          SELECT t.ma, t.vn, COUNT(*)::bigint AS posts, COALESCE(SUM(t.views), 0)::bigint AS views
          FROM (
            SELECT DISTINCT v.platform, v.post_id, v.views, ${DAU_TIENG_VIET} AS vn,
                   upper(m[1]) AS ma
            FROM (${trongKy}) AS v,
                 regexp_matches(v.mo_ta, '#(A[1-5])([^[:alnum:]]|$)', 'gi') AS m
          ) AS t
          GROUP BY 1, 2
        `,
        // Bỏ #A1..#A5 vì đã có khối "Tuyến nội dung" riêng, và bỏ thẻ 1 ký tự — dữ liệu thật
        // có thẻ "#c" xuất hiện ở 2.160/3.795 video, để lại thì nó chiếm luôn đầu bảng mà
        // không nói lên điều gì.
        this.prisma.$queryRaw<DongHashtag[]>`
          SELECT t.the, COUNT(*)::bigint AS posts, COALESCE(SUM(t.views), 0)::bigint AS views
          FROM (
            SELECT DISTINCT v.platform, v.post_id, v.views, lower(m[1]) AS the
            FROM (${trongKy}) AS v,
                 regexp_matches(v.mo_ta, '#([[:alnum:]_]{2,64})', 'g') AS m
          ) AS t
          WHERE t.the !~ '^a[1-5]$'
          GROUP BY 1
          ORDER BY views DESC, posts DESC
          LIMIT 10
        `,
      ]);

    const cacNgay = danhSachNgay(tu, den);
    const tenKenh = new Map(danhSachKenh.map((k) => [`${k.platform}|${k.kenh_id}`, k]));

    return {
      status: 'ok',
      ky: { tu, den, so_ngay: soNgay },
      nen_tang: this.gopNenTang(tong, theoNgay, danhSachKenh, cacNgay, platform),
      kenh: this.gopKenh(theoKenh, tenKenh),
      top_video: topVideo.map((v) => ({
        platform: v.platform,
        post_id: v.post_id,
        url: v.url,
        mo_ta: v.mo_ta,
        thumbnail: v.thumbnail,
        kenh_ten: v.kenh_ten,
        views: n(v.views),
        likes: n(v.likes),
        comments: n(v.comments),
        // Chuỗi ISO chứ không phải Date: qua Redis thì Date đã thành chuỗi, còn cache trong
        // bộ nhớ thì vẫn là Date — để nguyên là FE nhận hai kiểu khác nhau tuỳ máy có Redis
        // hay không, một lỗi chỉ lộ ra trên máy chủ thật.
        ngay: v.ngay.toISOString(),
      })),
      thi_truong: this.gopThiTruong(thiTruong),
      tuyen_noi_dung: this.gopTuyen(tuyen),
      hashtag: hashtag.map((h) => ({ the: h.the, posts: n(h.posts), views: n(h.views) })),
      canh_bao: this.dungCanhBao(danhSachKenh, theoKenh, soNgay),
      tong_kenh: danhSachKenh.length,
    };
  }

  // ── Nguồn dữ liệu ────────────────────────────────────────────────────────────

  /**
   * Video của kênh nội bộ trong khoảng [tu, den], gộp 4 nền tảng về CÙNG một bộ cột.
   *
   * Mọi nhánh đều phải ĐẶT TÊN CỘT và ÉP KIỂU tường minh: UNION ALL lấy tên lẫn kiểu cột
   * của nhánh ĐẦU TIÊN, mà nhánh đầu tiên đổi theo bộ lọc nền tảng. Bỏ alias ở các nhánh
   * sau thì để "tất cả" vẫn chạy (nhánh Facebook đứng đầu, có alias) nhưng lọc riêng
   * TikTok là hỏng ngay với lỗi `column v.ngay does not exist` — sai chỗ nào không lộ ra.
   *
   * Nền tảng nào không có chỉ số nào thì trả 0 chứ không bịa: Instagram không công khai
   * lượt chia sẻ, YouTube Shorts không lưu lượt thích/bình luận.
   */
  private nguonVideo(platform: string, tu: Date, den: Date): Prisma.Sql {
    const nhanh: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      nhanh.push(Prisma.sql`
        SELECT 'facebook'::text AS platform,
               COALESCE(mp.page_id, '')::text AS kenh_id,
               COALESCE(mp.name, '')::text AS kenh_ten,
               v.post_id::text AS post_id,
               COALESCE(v.permalink_url, '')::text AS url,
               COALESCE(v.caption, '')::text AS mo_ta,
               COALESCE(NULLIF(v.thumbnail_drive_url, ''), v.thumbnail_url, '')::text AS thumbnail,
               v.view_count::bigint AS views,
               v.like_count::bigint AS likes,
               v.comment_count::bigint AS comments,
               v.share_count::bigint AS shares,
               v.published_at AS ngay
        FROM video_management_ownedvideocontent v
        LEFT JOIN video_management_managedfacebookpage mp ON mp.id = v.managed_page_id
        WHERE v.published_at >= ${tu} AND v.published_at <= ${den}
      `);
    }

    if (!platform || platform === 'tiktok') {
      nhanh.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform,
               p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS kenh_ten,
               v.video_id::text AS post_id,
               v.url::text AS url,
               v.description::text AS mo_ta,
               COALESCE(v.cover_image, '')::text AS thumbnail,
               v.play_count::bigint AS views,
               v.digg_count::bigint AS likes,
               v.comment_count::bigint AS comments,
               v.share_count::bigint AS shares,
               v.date_posted AS ngay
        FROM scraper_tiktok_profile_videos v
        JOIN scraper_tiktok_profiles p ON p.id = v.profile_id
        WHERE p.is_owned = true AND v.date_posted >= ${tu} AND v.date_posted <= ${den}
      `);
    }

    if (!platform || platform === 'instagram') {
      nhanh.push(Prisma.sql`
        SELECT 'instagram'::text AS platform,
               p.username::text AS kenh_id,
               p.username::text AS kenh_ten,
               r.post_id::text AS post_id,
               r.url::text AS url,
               r.description::text AS mo_ta,
               COALESCE(NULLIF(r.thumbnail_drive_url, ''), r.thumbnail_url, '')::text AS thumbnail,
               r.play_count::bigint AS views,
               r.likes_count::bigint AS likes,
               r.comments_count::bigint AS comments,
               0::bigint AS shares,
               r.date_posted AS ngay
        FROM scraper_instagram_reels r
        JOIN scraper_instagram_profiles p ON p.id = r.profile_id
        WHERE p.is_owned = true AND r.date_posted >= ${tu} AND r.date_posted <= ${den}
      `);
    }

    if (!platform || platform === 'youtube') {
      // Bảng Shorts KHÔNG có ngày đăng — created_at là ngày CÀO VỀ. Số liệu YouTube theo
      // ngày vì thế là theo ngày cào, giống hệt cách /owned/videos đang xử lý.
      nhanh.push(Prisma.sql`
        SELECT 'youtube'::text AS platform,
               p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS kenh_ten,
               s.video_id::text AS post_id,
               s.url::text AS url,
               s.title::text AS mo_ta,
               COALESCE(NULLIF(s.thumbnail_drive_url, ''), s.thumbnail_url, '')::text AS thumbnail,
               s.view_count::bigint AS views,
               0::bigint AS likes,
               0::bigint AS comments,
               0::bigint AS shares,
               s.created_at AS ngay
        FROM scraper_youtube_shorts s
        JOIN scraper_youtube_profiles p ON p.id = s.profile_id
        WHERE p.is_owned = true AND s.created_at >= ${tu} AND s.created_at <= ${den}
      `);
    }

    return Prisma.sql`(${Prisma.join(nhanh, ' UNION ALL ')})`;
  }

  /**
   * Danh sách KÊNH nội bộ kèm người theo dõi và lần đăng gần nhất.
   *
   * Tách khỏi nguonVideo() vì cảnh báo "kênh im lặng" phải thấy được cả kênh KHÔNG có
   * video nào trong kỳ — đúng những kênh mà truy vấn theo video không bao giờ trả về.
   */
  private nguonKenh(platform: string): Prisma.Sql {
    const nhanh: Prisma.Sql[] = [];

    if (!platform || platform === 'facebook') {
      nhanh.push(Prisma.sql`
        SELECT 'facebook'::text AS platform, mp.page_id::text AS kenh_id, mp.name::text AS ten,
               COALESCE(NULLIF(mp.avatar_drive_url, ''), mp.avatar_url, '')::text AS avatar,
               mp.followers_count::bigint AS followers,
               mp.last_synced_at AS dong_bo,
               NULLIF(mp.scrape_error, '')::text AS loi,
               mp.is_active AS hoat_dong,
               (SELECT MAX(v.published_at) FROM video_management_ownedvideocontent v
                 WHERE v.managed_page_id = mp.id) AS ngay_cuoi
        FROM video_management_managedfacebookpage mp
      `);
    }

    if (!platform || platform === 'tiktok') {
      nhanh.push(Prisma.sql`
        SELECT 'tiktok'::text AS platform, p.username::text AS kenh_id,
               COALESCE(NULLIF(p.nickname, ''), p.username)::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.followers_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(v.date_posted) FROM scraper_tiktok_profile_videos v WHERE v.profile_id = p.id) AS ngay_cuoi
        FROM scraper_tiktok_profiles p WHERE p.is_owned = true
      `);
    }

    if (!platform || platform === 'instagram') {
      nhanh.push(Prisma.sql`
        SELECT 'instagram'::text AS platform, p.username::text AS kenh_id, p.username::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.followers_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(r.date_posted) FROM scraper_instagram_reels r WHERE r.profile_id = p.id) AS ngay_cuoi
        FROM scraper_instagram_profiles p WHERE p.is_owned = true
      `);
    }

    if (!platform || platform === 'youtube') {
      nhanh.push(Prisma.sql`
        SELECT 'youtube'::text AS platform, p.channel_id::text AS kenh_id,
               COALESCE(NULLIF(p.title, ''), p.channel_id)::text AS ten,
               COALESCE(p.avatar_url, '')::text AS avatar, p.subscriber_count::bigint AS followers,
               p.last_scraped_at AS dong_bo, NULLIF(p.scrape_error, '')::text AS loi,
               true AS hoat_dong,
               (SELECT MAX(s.created_at) FROM scraper_youtube_shorts s WHERE s.profile_id = p.id) AS ngay_cuoi
        FROM scraper_youtube_profiles p WHERE p.is_owned = true
      `);
    }

    return Prisma.sql`${Prisma.join(nhanh, ' UNION ALL ')}`;
  }

  // ── Gộp kết quả ──────────────────────────────────────────────────────────────

  private gopNenTang(
    tong: DongTong[],
    theoNgay: DongNgay[],
    danhSachKenh: DongDanhSachKenh[],
    cacNgay: string[],
    platform: string,
  ) {
    const dsNenTang = platform ? [platform] : [...NEN_TANG_NOI_BO];

    return dsNenTang
      .map((p) => {
        const nay = tong.find((t) => t.platform === p && t.ky === 'nay');
        const truoc = tong.find((t) => t.platform === p && t.ky === 'truoc');
        const ngayCuaP = new Map(theoNgay.filter((d) => d.platform === p).map((d) => [d.ngay, d]));

        return {
          platform: p,
          views: n(nay?.views),
          likes: n(nay?.likes),
          comments: n(nay?.comments),
          shares: n(nay?.shares),
          posts: n(nay?.posts),
          truoc: {
            views: n(truoc?.views),
            likes: n(truoc?.likes),
            comments: n(truoc?.comments),
            shares: n(truoc?.shares),
            posts: n(truoc?.posts),
          },
          followers: danhSachKenh
            .filter((k) => k.platform === p)
            .reduce((s, k) => s + n(k.followers), 0),
          so_kenh: n(nay?.so_kenh),
          tong_kenh: danhSachKenh.filter((k) => k.platform === p).length,
          // Ngày không có bài phải là 0 chứ không được thiếu — thiếu thì đường biểu đồ nối
          // tắt qua chỗ trống, nhìn như ngày đó vẫn có lượt xem.
          theo_ngay: cacNgay.map((ngay) => {
            const d = ngayCuaP.get(ngay);
            return {
              ngay,
              views: n(d?.views),
              likes: n(d?.likes),
              comments: n(d?.comments),
              shares: n(d?.shares),
              posts: n(d?.posts),
            };
          }),
        };
      })
      .filter((x) => x.tong_kenh > 0);
  }

  private gopKenh(theoKenh: DongKenh[], tenKenh: Map<string, DongDanhSachKenh>) {
    const nay = theoKenh.filter((k) => k.ky === 'nay');
    return nay
      .map((k) => {
        const khoa = `${k.platform}|${k.kenh_id}`;
        const meta = tenKenh.get(khoa);
        const truoc = theoKenh.find(
          (x) => x.ky === 'truoc' && x.platform === k.platform && x.kenh_id === k.kenh_id,
        );
        return {
          platform: k.platform,
          id: k.kenh_id,
          ten: meta?.ten || k.kenh_id,
          avatar: meta?.avatar || '',
          followers: n(meta?.followers),
          dong_bo: meta?.dong_bo?.toISOString() ?? null,
          posts: n(k.posts),
          views: n(k.views),
          likes: n(k.likes),
          comments: n(k.comments),
          shares: n(k.shares),
          views_truoc: n(truoc?.views),
        };
      })
      .sort((a, b) => b.views - a.views);
  }

  private gopThiTruong(rows: DongThiTruong[]) {
    const theoP = new Map<string, { platform: string; vn: number; global: number; posts_vn: number; posts_global: number }>();
    for (const r of rows) {
      const cur =
        theoP.get(r.platform) ??
        { platform: r.platform, vn: 0, global: 0, posts_vn: 0, posts_global: 0 };
      if (r.vn) {
        cur.vn += n(r.views);
        cur.posts_vn += n(r.posts);
      } else {
        cur.global += n(r.views);
        cur.posts_global += n(r.posts);
      }
      theoP.set(r.platform, cur);
    }
    return [...theoP.values()].sort((a, b) => b.vn + b.global - (a.vn + a.global));
  }

  private gopTuyen(rows: DongTuyen[]) {
    const theoMa = new Map<string, { ma: string; posts: number; views: number; views_vn: number; views_global: number }>();
    for (const r of rows) {
      const cur = theoMa.get(r.ma) ?? { ma: r.ma, posts: 0, views: 0, views_vn: 0, views_global: 0 };
      cur.posts += n(r.posts);
      cur.views += n(r.views);
      if (r.vn) cur.views_vn += n(r.views);
      else cur.views_global += n(r.views);
      theoMa.set(r.ma, cur);
    }
    return [...theoMa.values()].sort((a, b) => b.views - a.views);
  }

  /**
   * Cảnh báo cho khối "Cần chú ý".
   *
   * Ba loại, xếp nặng trước nhẹ sau: lỗi đồng bộ → tụt lượt xem → im lặng. Chỉ xét kênh
   * đang hoạt động; kênh đã tắt im lặng là chuyện đương nhiên, báo lên chỉ làm nhiễu.
   */
  private dungCanhBao(danhSachKenh: DongDanhSachKenh[], theoKenh: DongKenh[], soNgay: number) {
    const canhBao: {
      platform: string;
      kenh: string;
      noi_dung: string;
      muc: 'w' | 'b';
      nhan: string;
    }[] = [];
    const bayGio = Date.now();

    for (const k of danhSachKenh) {
      if (!k.hoat_dong) continue;
      if (!k.loi) continue;
      canhBao.push({
        platform: k.platform,
        kenh: k.ten,
        noi_dung: `Đồng bộ lỗi: ${k.loi.slice(0, 120)}`,
        muc: 'b',
        nhan: 'Lỗi',
      });
    }

    for (const k of theoKenh.filter((x) => x.ky === 'nay')) {
      const truoc = theoKenh.find(
        (x) => x.ky === 'truoc' && x.platform === k.platform && x.kenh_id === k.kenh_id,
      );
      const vTruoc = n(truoc?.views);
      // Kỳ trước quá ít lượt xem thì tỷ lệ phần trăm nhảy loạn (100 → 40 là "tụt 60%"
      // nhưng chẳng nói lên gì), nên đặt sàn.
      if (vTruoc < 10_000) continue;
      const delta = Math.round(((n(k.views) - vTruoc) / vTruoc) * 100);
      if (delta > NGUONG_TUT) continue;
      const meta = danhSachKenh.find((x) => x.platform === k.platform && x.kenh_id === k.kenh_id);
      if (meta && !meta.hoat_dong) continue;
      canhBao.push({
        platform: k.platform,
        kenh: meta?.ten || k.kenh_id,
        noi_dung: `Lượt xem giảm ${Math.abs(delta)}% so với ${soNgay} ngày trước đó`,
        muc: 'b',
        nhan: 'Tụt',
      });
    }

    for (const k of danhSachKenh) {
      if (!k.hoat_dong) continue;
      if (!k.ngay_cuoi) {
        canhBao.push({
          platform: k.platform,
          kenh: k.ten,
          noi_dung: 'Chưa cào được video nào',
          muc: 'w',
          nhan: 'Trống',
        });
        continue;
      }
      const soNgayIm = Math.floor((bayGio - k.ngay_cuoi.getTime()) / 86_400_000);
      if (soNgayIm < NGUONG_IM_LANG) continue;
      canhBao.push({
        platform: k.platform,
        kenh: k.ten,
        noi_dung: `Chưa đăng bài trong ${soNgayIm} ngày`,
        muc: 'w',
        nhan: 'Im lặng',
      });
    }

    return canhBao.slice(0, 12);
  }
}

/**
 * Bốn hàm dưới đây được OwnedDuplicateService dùng lại — xuất ra thay vì chép sang đó, để
 * trang tổng quan và khối trùng lặp không bao giờ hiểu "từ / đến" hay tên nền tảng lệch nhau.
 * Chép một bản thứ hai thì sửa trần SO_NGAY_TOI_DA ở đây mà bên kia vẫn cho chọn 10 năm.
 */
export function chuanHoaNenTang(raw?: string): string {
  const v = (raw || '').trim().toLowerCase();
  if (!v || v === 'all') return '';
  return (NEN_TANG_NOI_BO as readonly string[]).includes(v) ? v : '';
}

/** Đúng dạng 'YYYY-MM-DD' VÀ là ngày có thật — '2026-02-31' khớp regex nhưng không tồn tại. */
function laNgayHopLe(s?: string): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function soNgayGiua(tu: string, den: string): number {
  const a = Date.parse(`${tu}T00:00:00.000Z`);
  const b = Date.parse(`${den}T00:00:00.000Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Quy mọi cách gọi về đúng một khoảng ngày đóng [tu, den] theo giờ VN.
 *
 * Ba đường vào, theo thứ tự ưu tiên:
 *   1. `tu` + `den` — người dùng tự chọn trên lịch.
 *   2. `days` — giữ lại cho các lần gọi cũ và cho nút preset.
 *   3. Không có gì — mặc định 28 ngày gần nhất.
 *
 * Chặn ở đây chứ không tin FE: khoảng ngược thì lật lại, ngày tương lai thì cắt về hôm nay
 * (video chưa đăng nên có kéo dài cũng không thêm được gì), và chặn trần độ dài — bóc hashtag
 * bằng regexp trên caption tốn ~3,4 giây cho 90 ngày, thả cho chọn 10 năm là treo cả request.
 */
export function chuanHoaKhoang(rawTu?: string, rawDen?: string, rawDays?: string): { tu: string; den: string } {
  const homNay = ngayVN(new Date());

  let den = laNgayHopLe(rawDen) ? rawDen : homNay;
  let tu: string;

  if (laNgayHopLe(rawTu)) {
    tu = rawTu;
  } else {
    const soNgay = SO_NGAY_HOP_LE.includes(parseInt(rawDays || '', 10))
      ? parseInt(rawDays!, 10)
      : SO_NGAY_MAC_DINH;
    tu = congNgay(den, -(soNgay - 1));
  }

  if (tu > den) [tu, den] = [den, tu];
  if (den > homNay) den = homNay;
  if (tu > den) tu = den;
  if (soNgayGiua(tu, den) > SO_NGAY_TOI_DA) tu = congNgay(den, -(SO_NGAY_TOI_DA - 1));

  return { tu, den };
}

function danhSachNgay(tu: string, den: string): string[] {
  const out: string[] = [];
  let cur = tu;
  while (cur <= den) {
    out.push(cur);
    cur = congNgay(cur, 1);
  }
  return out;
}

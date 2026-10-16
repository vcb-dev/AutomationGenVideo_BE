import { Prisma } from '@prisma/client';
import { buildPageChannelMap, ResolverChannel } from '../facebook-owned-pages/page-channel-resolver';

/**
 * Hai bộ lọc dùng chung cho video kênh nội bộ: theo THỊ TRƯỜNG (VN / Global) và theo
 * TUYẾN NỘI DUNG (A1–A5).
 *
 * ── Tuyến nội dung ──────────────────────────────────────────────────────────────
 * KHÔNG cần bảng ánh xạ hashtag → tuyến. Đã tra dữ liệu thật: đội nội dung vốn đã gắn
 * thẳng #A1 … #A5 vào caption. Đếm được trên 19.971 video Facebook nội bộ:
 *     A1=5.287  A2=2.227  A3=716  A4=9.464  A5=522
 * Nên chỉ cần bắt đúng hashtag đó. Một video có thể mang nhiều tuyến (đo được 8 video
 * mang cả #A1 lẫn #A4) — đúng bản chất, không phải lỗi dữ liệu.
 *
 * Ranh giới cuối `([^[:alnum:]]|$)` là BẮT BUỘC: trong dữ liệu có một caption gắn #A54,
 * thiếu ranh giới thì lọc A5 sẽ vơ luôn cái đó.
 *
 * ── Thị trường ──────────────────────────────────────────────────────────────────
 * Bảng kênh của cả 8 nền tảng không có cột nào về vùng, nên đoán theo chữ: caption có
 * dấu tiếng Việt (hoặc chữ đ) thì coi là kênh VN. Đo trên dữ liệu thật: 14.318/19.971
 * caption Facebook có dấu tiếng Việt.
 *
 * Chỗ yếu đã biết và chấp nhận: video của kênh Việt nhưng viết caption không dấu hoặc
 * viết tiếng Anh sẽ bị xếp nhầm sang Global. Muốn chắc chắn tuyệt đối thì phải gắn nhãn
 * tay cho từng kênh — người dùng đã chọn cách tự đoán để dùng được ngay.
 */

/** Tuyến nội dung hợp lệ. Thêm A6 thì chỉ cần thêm vào đây. */
export const CONTENT_LINES = ['A1', 'A2', 'A3', 'A4', 'A5'] as const;
export type ContentLine = (typeof CONTENT_LINES)[number];

export const MARKETS = ['vn', 'global', 'doda'] as const;
export type Market = (typeof MARKETS)[number];

/**
 * Lớp ký tự nhận diện tiếng Việt: các nguyên âm có dấu + chữ đ.
 * Không đưa a-z trơn vào — tiếng Anh cũng có, đưa vào là mọi thứ đều thành VN.
 */
const CHU_TIENG_VIET =
  'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';

const MAU_TIENG_VIET = `[${CHU_TIENG_VIET}]`;

/**
 * Mẫu nhận diện kênh / page đồ da (Nhạn Nhạn, Vân Phong Các, xưởng da, thợ da, đồ da, leathercraft...).
 */
export const DODA_CHANNEL_PATTERN =
  'nhạn|nyan|vân phong các|van phong cac|thợ da|tho da|xưởng da|xuong da|đồ da|do da|leather|chinhandoda|nhannhan';

/**
 * Mẫu nhận diện caption / bài đăng thuộc line đồ da.
 */
export const DODA_CAPTION_PATTERN =
  'nhạn nhạn|chị nhạn|chi nhan|vân phong các|thợ da|xưởng da|đồ da|ví da|túi da|da bò|da thật|da thủ công|#doda|#dathat|#xuongda|#thoda|#leather';

export function laTuyenHopLe(value: string): value is ContentLine {
  return (CONTENT_LINES as readonly string[]).includes(value.toUpperCase());
}

export function laThiTruongHopLe(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value.toLowerCase());
}

/**
 * Điều kiện lọc theo thị trường (vn / global / doda).
 *
 * @param cot biểu thức SQL trỏ tới cột chữ của nhánh (description / title / caption).
 * @param cotKenh biểu thức SQL trỏ tới tên kênh / page để nhận diện chính xác các kênh đồ da.
 */
export function marketFilter(
  cot: Prisma.Sql,
  market: string,
  cotKenh?: Prisma.Sql,
): Prisma.Sql | null {
  const m = (market || '').toLowerCase();
  if (!laThiTruongHopLe(m)) return null;

  const chu = Prisma.sql`COALESCE(${cot}, '')`;
  const isDoda = cotKenh
    ? Prisma.sql`(COALESCE(${cotKenh}, '') ~* ${DODA_CHANNEL_PATTERN} OR ${chu} ~* ${DODA_CAPTION_PATTERN})`
    : Prisma.sql`(${chu} ~* ${DODA_CAPTION_PATTERN})`;

  if (m === 'doda') {
    return isDoda;
  }
  if (m === 'vn') {
    return Prisma.sql`(${chu} ~* ${MAU_TIENG_VIET} AND NOT ${isDoda})`;
  }
  // m === 'global'
  return Prisma.sql`(${chu} !~* ${MAU_TIENG_VIET} AND NOT ${isDoda})`;
}

/**
 * Điều kiện lọc theo tuyến nội dung, bắt hashtag #A1…#A5 trong chữ.
 *
 * @param cotHashtag cột mảng hashtag nếu bảng đó có (TikTok, Instagram, Douyin, YouTube).
 *        Bảng video Facebook nội bộ KHÔNG có cột này — mà đó lại là nơi chứa gần như toàn
 *        bộ video nội bộ — nên nhánh bắt theo chữ mới là nhánh chính, không phải phòng hờ.
 */
export function contentLineFilter(
  cot: Prisma.Sql,
  line: string,
  cotHashtag?: Prisma.Sql,
): Prisma.Sql | null {
  const ma = (line || '').toUpperCase();
  if (!laTuyenHopLe(ma)) return null;

  const mau = `#${ma}([^[:alnum:]]|$)`;
  const byKeyword = Prisma.sql`COALESCE(${cot}, '') ~* ${mau}`;
  if (!cotHashtag) return byKeyword;

  // Mảng hashtag lưu không kèm dấu #, và hoa/thường không thống nhất → so bằng lower().
  return Prisma.sql`(${byKeyword} OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(${cotHashtag}, ARRAY[]::text[])) AS t WHERE lower(t) = ${ma.toLowerCase()}
  ))`;
}

/**
 * Tuyến nội dung có trong chữ (#A1…#A5) — bản JS của contentLineFilter, cùng ranh giới cuối nên
 * #A54 không thành A5. Trả theo thứ tự CONTENT_LINES, không lặp.
 */
export function contentLinesInText(text: string | null | undefined): ContentLine[] {
  const found = new Set<string>();
  for (const m of (text || '').matchAll(/#(A\d+)(?![\p{L}\p{N}])/giu)) found.add(m[1].toUpperCase());
  return CONTENT_LINES.filter((line) => found.has(line));
}

/**
 * Lọc theo HASHTAG bất kỳ (khác với tuyến A1–A5 vốn là bộ mã cố định).
 *
 * Bảng video Facebook nội bộ — nơi chứa gần như toàn bộ dữ liệu nội bộ, 19.971/19.971 dòng —
 * KHÔNG có cột hashtag, chỉ có caption. Nên nhánh bắt theo chữ mới là nhánh chính; cột mảng
 * hashtag của mấy nền tảng khác chỉ là bổ sung.
 *
 * Ranh giới cuối `([^[:alnum:]_]|$)` là bắt buộc: thiếu nó thì lọc #vang sẽ vơ luôn #vangtay,
 * và lọc #a1 sẽ vơ #a10.
 */
export function hashtagFilter(
  cot: Prisma.Sql,
  hashtag: string,
  cotHashtag?: Prisma.Sql,
): Prisma.Sql | null {
  const the = chuanHoaHashtag(hashtag);
  if (!the) return null;

  // `the` đã qua chuanHoaHashtag nên chắc chắn không còn ký tự có nghĩa trong biểu thức
  // chính quy — không cần thoát thêm, và giá trị vẫn đi vào truy vấn dưới dạng tham số.
  const mau = `#${the}([^[:alnum:]_]|$)`;
  const byKeyword = Prisma.sql`COALESCE(${cot}, '') ~* ${mau}`;
  if (!cotHashtag) return byKeyword;

  return Prisma.sql`(${byKeyword} OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(${cotHashtag}, ARRAY[]::text[])) AS t WHERE lower(t) = ${the.toLowerCase()}
  ))`;
}

/** Bỏ dấu # người dùng lỡ gõ, và CẤM ký tự lạ để không ai nhét được biểu thức chính quy vào. */
export function chuanHoaHashtag(raw: string): string {
  const s = (raw || '').trim().replace(/^#+/, '');
  // Hashtag thật chỉ gồm chữ, số và gạch dưới. Dữ liệu có cả hashtag tiếng Việt có dấu và
  // tiếng Trung/Thái nên KHÔNG giới hạn về a-z; chặn theo ký tự nguy hiểm thay vì liệt kê.
  if (!s || s.length > 64) return '';
  // Ký tự có nghĩa trong biểu thức chính quy của Postgres, khoảng trắng, ký tự đại diện của
  // LIKE (% _) và ký tự điều khiển đều bị loại — hashtag thật không bao giờ chứa chúng.
  if (/[\s#.*+?^${}()|[\]\\%_]/.test(s)) return '';
  // `\s` KHONG bao gom ky tu dieu khien nhu \b (xoa lui) nen phai chan rieng.
  // PHAI viet bang ma thoat \u...: go ky tu that vao day lam ca tep thanh nhi phan.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return '';
  return s;
}

/**
 * Lọc theo KÊNH.
 *
 * Mỗi nhánh nền tảng gọi định danh kênh một tên khác nhau (page_id / username / channel_id),
 * nên phải truyền cột vào chứ không viết cứng được. So sánh không phân biệt hoa thường vì
 * username Facebook và TikTok trong dữ liệu không thống nhất.
 */
export function channelFilter(cot: Prisma.Sql, kenh: string): Prisma.Sql | null {
  const v = (kenh || '').trim();
  if (!v) return null;
  return Prisma.sql`lower(COALESCE(${cot}, '')) = ${v.toLowerCase()}`;
}

/**
 * Lọc theo MỘT TẬP kênh (vd mọi kênh của một người cầm). Tập rỗng nghĩa là "không kênh nào"
 * chứ không phải "không lọc" — trả FALSE để nhánh đó không lọt video nào.
 */
export function channelInFilter(cot: Prisma.Sql, keys: string[]): Prisma.Sql {
  const ds = [...new Set(keys.map((k) => (k || '').trim().toLowerCase()).filter(Boolean))];
  if (!ds.length) return Prisma.sql`FALSE`;
  return Prisma.sql`lower(COALESCE(${cot}, '')) IN (${Prisma.join(ds)})`;
}

/** Nền tảng có bảng profile nội bộ ghép được với huyk_channels. Douyin/XHS chưa có kênh nội bộ. */
export const OWNER_SCOPE_PLATFORMS = ['facebook', 'instagram', 'threads', 'tiktok', 'youtube'] as const;
export type OwnerScopePlatform = (typeof OWNER_SCOPE_PLATFORMS)[number];

export interface OwnedProfile {
  platform: OwnerScopePlatform;
  /** Khoá dùng ở cột lọc kênh của nhánh: page_id (FB) / username / channel_id (YouTube). */
  key: string;
  name: string;
  username: string | null;
}

export interface ChannelScope {
  keys: Record<OwnerScopePlatform, string[]>;
  channels: { platform: OwnerScopePlatform; name: string }[];
}

/**
 * Kênh nội bộ (page FB, profile IG/Threads/...) thuộc một người cầm và/hoặc một team, theo từng nền tảng.
 * Phải đưa MỌI kênh vào buildPageChannelMap (không chỉ kênh trong phạm vi) để phát hiện mơ hồ:
 * 2 người cùng một tên kênh thì không gán cho ai.
 */
export function channelScope(
  scope: { ownerId?: string; teamId?: string },
  profiles: OwnedProfile[],
  channels: ResolverChannel[],
): ChannelScope {
  const keys = Object.fromEntries(OWNER_SCOPE_PLATFORMS.map((p) => [p, [] as string[]])) as Record<
    OwnerScopePlatform,
    string[]
  >;
  const owned: ChannelScope['channels'] = [];
  for (const platform of OWNER_SCOPE_PLATFORMS) {
    const list = profiles.filter((p) => p.platform === platform);
    if (!list.length) continue;
    const map = buildPageChannelMap(
      list.map((p) => ({ page_id: p.key, name: p.name, username: p.username })),
      channels,
      platform,
    );
    for (const p of list) {
      const ref = map.get(p.key);
      if (!ref) continue;
      if (scope.ownerId && ref.ownerId !== scope.ownerId) continue;
      if (scope.teamId && ref.teamId !== scope.teamId) continue;
      keys[platform].push(p.key);
      owned.push({ platform, name: p.name || p.key });
    }
  }
  return { keys, channels: owned };
}

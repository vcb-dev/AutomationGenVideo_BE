import { Prisma } from '@prisma/client';

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

export const MARKETS = ['vn', 'global'] as const;
export type Market = (typeof MARKETS)[number];

/**
 * Lớp ký tự nhận diện tiếng Việt: các nguyên âm có dấu + chữ đ.
 * Không đưa a-z trơn vào — tiếng Anh cũng có, đưa vào là mọi thứ đều thành VN.
 */
const CHU_TIENG_VIET =
  'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';

const MAU_TIENG_VIET = `[${CHU_TIENG_VIET}]`;

export function laTuyenHopLe(value: string): value is ContentLine {
  return (CONTENT_LINES as readonly string[]).includes(value.toUpperCase());
}

export function laThiTruongHopLe(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value.toLowerCase());
}

/**
 * Điều kiện lọc theo thị trường.
 *
 * @param cot biểu thức SQL trỏ tới cột chữ của nhánh (mỗi nền tảng một tên: description /
 *            title / caption), nên phải truyền vào chứ không viết cứng được.
 */
export function marketFilter(cot: Prisma.Sql, market: string): Prisma.Sql | null {
  const m = (market || '').toLowerCase();
  if (!laThiTruongHopLe(m)) return null;
  // COALESCE: caption NULL thì `~*` trả NULL chứ không trả false, video sẽ rơi khỏi CẢ HAI
  // nhóm VN lẫn Global — cộng hai nhóm lại không bằng tổng, nhìn như mất video.
  const chu = Prisma.sql`COALESCE(${cot}, '')`;
  return m === 'vn'
    ? Prisma.sql`${chu} ~* ${MAU_TIENG_VIET}`
    : Prisma.sql`${chu} !~* ${MAU_TIENG_VIET}`;
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
  const byWord = Prisma.sql`COALESCE(${cot}, '') ~* ${mau}`;
  if (!cotHashtag) return byWord;

  // Mảng hashtag lưu không kèm dấu #, và hoa/thường không thống nhất → so bằng lower().
  return Prisma.sql`(${byWord} OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(${cotHashtag}, ARRAY[]::text[])) AS t WHERE lower(t) = ${ma.toLowerCase()}
  ))`;
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
  const the = normalizeHashtag(hashtag);
  if (!the) return null;

  // `the` đã qua normalizeHashtag nên chắc chắn không còn ký tự có nghĩa trong biểu thức
  // chính quy — không cần thoát thêm, và giá trị vẫn đi vào truy vấn dưới dạng tham số.
  const mau = `#${the}([^[:alnum:]_]|$)`;
  const byWord = Prisma.sql`COALESCE(${cot}, '') ~* ${mau}`;
  if (!cotHashtag) return byWord;

  return Prisma.sql`(${byWord} OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(${cotHashtag}, ARRAY[]::text[])) AS t WHERE lower(t) = ${the.toLowerCase()}
  ))`;
}

/** Bỏ dấu # người dùng lỡ gõ, và CẤM ký tự lạ để không ai nhét được biểu thức chính quy vào. */
export function normalizeHashtag(raw: string): string {
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

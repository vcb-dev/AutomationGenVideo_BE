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
export function dieuKienThiTruong(cot: Prisma.Sql, market: string): Prisma.Sql | null {
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
export function dieuKienTuyenNoiDung(
  cot: Prisma.Sql,
  line: string,
  cotHashtag?: Prisma.Sql,
): Prisma.Sql | null {
  const ma = (line || '').toUpperCase();
  if (!laTuyenHopLe(ma)) return null;

  const mau = `#${ma}([^[:alnum:]]|$)`;
  const theoChu = Prisma.sql`COALESCE(${cot}, '') ~* ${mau}`;
  if (!cotHashtag) return theoChu;

  // Mảng hashtag lưu không kèm dấu #, và hoa/thường không thống nhất → so bằng lower().
  return Prisma.sql`(${theoChu} OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(${cotHashtag}, ARRAY[]::text[])) AS t WHERE lower(t) = ${ma.toLowerCase()}
  ))`;
}

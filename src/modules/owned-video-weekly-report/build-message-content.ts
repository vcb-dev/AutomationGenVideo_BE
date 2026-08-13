/**
 * Dựng nội dung message cảnh báo video bùng nổ. Hàm THUẦN — không chạm Prisma, không gọi mạng.
 *
 * Vì sao tách file riêng: đây là phần chắc chắn phải sửa đi sửa lại theo góp ý của người đọc,
 * và sau này còn đổi từ text sang thẻ tương tác Lark. Tách ra thì mỗi lần đổi chỉ động vào đây,
 * mà test cũng không cần dựng DB.
 */

/**
 * Trần số video liệt kê trong một message.
 *
 * Đo thật: với ngưỡng 1 triệu chỉ có ~1 video/tuần đạt, nên bình thường message chỉ có 1–2 khối và
 * trần này không bao giờ chạm tới. Nó tồn tại cho hai trường hợp: lần chạy đầu (gom cả cửa sổ
 * 14 ngày) và khi ai đó hạ ngưỡng xuống thấp.
 */
export const MAX_VIDEOS = 20;

/** Cắt caption cho một dòng vừa màn hình điện thoại. */
const DAI_CAPTION_TOI_DA = 60;

export interface FullWeekVideo {
  post_id: string;
  ten_fanpage: string;
  caption: string;
  permalink_url: string | null;
  published_at: Date;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
}

/**
 * 1.240.000 → "1,24M". Dấu phẩy thập phân theo cách viết số của tiếng Việt.
 *
 * Số càng lớn càng ít chữ số lẻ: "763,85K" đọc vướng mắt mà hai chữ số cuối chẳng nói thêm gì,
 * "764K" là đủ. Đo trên message thật dựng từ 1.037 video mới thấy.
 */
export function compactNumber(n: number): string {
  const format = (value: number, suffix: string) => {
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    const factor = 10 ** decimals;
    const round2 = Math.round(value * factor) / factor;
    return `${String(round2).replace('.', ',')}${suffix}`;
  };
  if (n >= 1_000_000) return format(n / 1_000_000, 'M');
  if (n >= 1_000) return format(n / 1_000, 'K');
  return String(n);
}

const twoDigits = (n: number) => String(n).padStart(2, '0');
const fullDate = (d: Date) =>
  `${twoDigits(d.getUTCDate())}/${twoDigits(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

function truncateCaption(caption: string): string {
  const mot = caption.replace(/\s+/g, ' ').trim();
  if (!mot) return '(không có mô tả)';
  return mot.length <= DAI_CAPTION_TOI_DA ? mot : `${mot.slice(0, DAI_CAPTION_TOI_DA - 1)}…`;
}

/**
 * Trả về null khi không có video nào đạt ngưỡng — gọi bên ngoài phải hiểu là KHÔNG GỬI GÌ CẢ.
 *
 * Vì sao null chứ không phải câu "hôm nay không có video nào": với ngưỡng 1 triệu thì 85% số
 * ngày sẽ rơi vào trường hợp này. Gửi message báo "không có gì" mỗi sáng là cách nhanh nhất để
 * người nhận tắt thông báo, và thế là mất luôn cái message thật sự đáng đọc.
 */
export function buildMessageContent(videos: FullWeekVideo[], threshold: number): string | null {
  if (videos.length === 0) return null;

  const byView = [...videos].sort((a, b) => b.view_count - a.view_count);
  const hien = byView.slice(0, MAX_VIDEOS);

  const dong: string[] = [
    `🚀 Video vượt ${compactNumber(threshold)} view trong 7 ngày đầu`,
    videos.length === 1 ? '1 video' : `${videos.length} video`,
  ];

  for (const v of hien) {
    dong.push('');
    dong.push(`▸ ${v.ten_fanpage} · đăng ${fullDate(v.published_at)}`);
    dong.push(`  "${truncateCaption(v.caption)}"`);
    dong.push(
      `  ${compactNumber(v.view_count)} view · ${compactNumber(v.like_count)} like · ` +
        `${compactNumber(v.comment_count)} bình luận · ${compactNumber(v.share_count)} chia sẻ`,
    );
    if (v.permalink_url) dong.push(`  ${v.permalink_url}`);
  }

  const remaining = videos.length - hien.length;
  if (remaining > 0) dong.push('', `… và ${remaining} video khác cũng vượt ngưỡng.`);

  return dong.join('\n');
}

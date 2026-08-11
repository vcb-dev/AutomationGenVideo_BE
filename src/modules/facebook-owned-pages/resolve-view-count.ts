/**
 * Quyết định ghi lượt xem nào khi đồng bộ video. Tách khỏi service để test được mà không cần DB —
 * cùng lối với `scraper-aggregate/content-filters.ts`.
 */

/**
 * `null`/`undefined` từ AI nghĩa là KHÔNG LẤY ĐƯỢC lượt xem (request insights bị Facebook từ
 * chối), khác hẳn `0` nghĩa là THẬT SỰ không ai xem.
 *
 * Vì sao phải phân biệt: sự cố 27/07–09/08/2026 chính là chỗ này. Metric
 * `post_video_reels_organic_plays` bị khai tử kéo sập cả request insights, AI trả về không có số,
 * và `BigInt(v.view_count || 0)` biến nó thành 0 rồi ghi đè lên video ĐANG CÓ lượt xem thật.
 * Sync chạy mỗi sáng nên chỉ vài ngày là xoá sạch, 1.169 video về 0 mà nhìn vẫn như dữ liệu thật.
 *
 * Không lấy được thì giữ nguyên số cũ — thà cũ còn hơn sai.
 */
export function resolveViewCount(
  incoming: number | null | undefined,
  existing: bigint | null | undefined,
): bigint {
  if (incoming === null || incoming === undefined) {
    return existing ?? BigInt(0);
  }
  return BigInt(incoming);
}

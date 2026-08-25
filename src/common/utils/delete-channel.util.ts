/**
 * Kết quả xoá cứng một kênh khám phá bên ngoài, dùng chung cho cả 8 nền tảng.
 *
 * `videos_deleted` phải là số ĐẾM TRƯỚC khi xoá. Sáu nền tảng dùng khoá ngoại
 * onDelete Cascade, nên nếu đếm sau lệnh xoá thì Postgres đã dọn sạch bảng con và
 * con số trả về luôn bằng 0 — trong khi FE lại dùng chính con số này để nói với
 * người dùng họ vừa mất bao nhiêu video.
 */
export interface DeleteChannelResult {
  deleted: true;
  id: number;
  /** Tên hiển thị của kênh, để FE báo "Đã xoá <tên>" mà không phải gọi lại API. */
  name: string;
  videos_deleted: number;
}

export function buildDeleteChannelResult(
  id: bigint,
  name: string,
  videosDeleted: number,
): DeleteChannelResult {
  return { deleted: true, id: Number(id), name, videos_deleted: videosDeleted };
}

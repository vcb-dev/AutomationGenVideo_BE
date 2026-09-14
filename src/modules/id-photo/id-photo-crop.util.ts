/**
 * Toán học thuần cho tính năng "Điều chỉnh vị trí ảnh trong khung tròn" — dùng CHUNG cho:
 *   - preview FE (CSS transform trên ảnh, xem ExportStep.tsx#IdCardPreview)
 *   - PDF thật BE (id-photo.service.ts#drawIdCardPage)
 *
 * BẢN SAO Ở FE: id-photo/components/crop-math.ts — sửa 1 bên PHẢI sửa bên kia, nếu không
 * preview và PDF sẽ crop lệch nhau (đúng nguyên tắc đã áp dụng cho CARD_LAYOUT/shadeHex).
 *
 * Toàn bộ toạ độ tính theo TỈ LỆ của khung vuông cạnh 1 (S=1) bao quanh vòng tròn — không phụ
 * thuộc kích thước pixel/point thực tế của khung: FE nhân với bề rộng khung tròn hiện tại (%),
 * BE nhân với `circleR * 2` (điểm PDF). Nhờ vậy công thức chỉ phụ thuộc ĐÚNG MỘT biến số ngoài
 * transform người dùng chọn: tỉ lệ khung/cao (aspect ratio) của ẢNH GỐC — vốn là thuộc tính nội
 * tại của file ảnh, đọc ra giống hệt nhau ở FE (Image.naturalWidth/Height) và BE (PDFKit
 * doc.openImage().width/height) vì CÙNG một file bytes, nên không có rủi ro trôi lệch.
 */

/** offsetX/offsetY: độ lệch tâm ảnh so với tâm khung, tính theo phần trăm cạnh khung (S=1).
 *  scale: hệ số phóng to TRÊN NỀN "cover-fit" (scale=1 = ảnh phủ khít khung, không hở viền —
 *  giống hệt hành vi CŨ khi chưa có tính năng này). */
export interface CropTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export const CROP_SCALE_MIN = 1;
export const CROP_SCALE_MAX = 3;

/** scale=1 + offset=(0,0) ⇔ đúng hành vi pdfkit `cover + align/valign center` cũ — mọi bản ghi
 *  cũ có crop_offset_x/y/crop_scale = NULL trong DB đều render giống hệt trước khi có tính năng. */
export const CROP_DEFAULT: CropTransform = { offsetX: 0, offsetY: 0, scale: CROP_SCALE_MIN };

function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function clampCropScale(scale: number | null | undefined): number {
  return Math.min(CROP_SCALE_MAX, Math.max(CROP_SCALE_MIN, finite(scale, CROP_DEFAULT.scale)));
}

/** Kích thước ảnh phủ kín khung vuông cạnh 1 (cover-fit) tại scale=1, theo ĐÚNG tỉ lệ ảnh gốc —
 *  công thức giống hệt nhánh `options.cover` của pdfkit (bp=1 vì khung vuông): cạnh dài co theo
 *  tỉ lệ ảnh, cạnh ngắn co đúng bằng 1. */
function coverSizeAtScale1(imgWidth: number, imgHeight: number): { w: number; h: number } {
  if (!(imgWidth > 0) || !(imgHeight > 0)) return { w: 1, h: 1 };
  const r = imgWidth / imgHeight;
  return r >= 1 ? { w: r, h: 1 } : { w: 1, h: 1 / r };
}

/** Biên độ lệch tâm tối đa (mỗi chiều) mà ảnh vẫn phủ kín khung ở `scale` cho trước — chính là
 *  cơ chế giữ yêu cầu (5): không cho kéo/zoom ra ngoài phạm vi khiến khung hở viền trắng. */
export function maxCropOffset(
  imgWidth: number,
  imgHeight: number,
  scale: number | null | undefined,
): { x: number; y: number } {
  const s = clampCropScale(scale);
  const { w, h } = coverSizeAtScale1(imgWidth, imgHeight);
  return { x: Math.max(0, (w * s - 1) / 2), y: Math.max(0, (h * s - 1) / 2) };
}

export function clampCropOffset(
  imgWidth: number,
  imgHeight: number,
  scale: number | null | undefined,
  offsetX: number | null | undefined,
  offsetY: number | null | undefined,
): { offsetX: number; offsetY: number } {
  const max = maxCropOffset(imgWidth, imgHeight, scale);
  const ox = finite(offsetX, CROP_DEFAULT.offsetX);
  const oy = finite(offsetY, CROP_DEFAULT.offsetY);
  // "+ 0" chuẩn hoá -0 → 0 (Math.max(-0, ...) có thể sinh -0 khi max.x/y = 0) — vô hại về số học
  // nhưng tránh bất ngờ vô nghĩa khi so sánh bằng Object.is (vd Jest toBe/toEqual trong test).
  return {
    offsetX: Math.min(max.x, Math.max(-max.x, ox)) + 0,
    offsetY: Math.min(max.y, Math.max(-max.y, oy)) + 0,
  };
}

/** Hình chữ nhật vẽ ảnh, tính theo tỉ lệ cạnh khung (S=1), ĐÃ CLAMP để luôn phủ kín khung dù
 *  transform truyền vào có hỏng/vượt phạm vi tới đâu (phòng vệ cho dữ liệu cũ hoặc client lỗi) —
 *  nhân `x/y/width/height` với kích thước khung thật (% ở FE, `circleR*2` điểm ở BE) là ra toạ
 *  độ vẽ cuối cùng. */
export interface CropLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeCropLayout(
  imgWidth: number,
  imgHeight: number,
  transform?: Partial<CropTransform> | null,
): CropLayout {
  const scale = clampCropScale(transform?.scale);
  const { w: w0, h: h0 } = coverSizeAtScale1(imgWidth, imgHeight);
  const width = w0 * scale;
  const height = h0 * scale;
  const { offsetX, offsetY } = clampCropOffset(imgWidth, imgHeight, scale, transform?.offsetX, transform?.offsetY);
  return {
    x: 0.5 + offsetX - width / 2,
    y: 0.5 + offsetY - height / 2,
    width,
    height,
  };
}

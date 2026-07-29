// Chuẩn hoá dấu tiếng Việt qua NFD + xử lý riêng đ/Đ (không tách được qua NFD).
// 'da quy' khớp 'đá quý'. Dùng để tính cột ascii tính sẵn (search-keywords) —
// search theo unaccent trực tiếp trong query đã chuyển sang DB qua
// immutable_unaccent() (Postgres, xem migration 20260716000000).

// eslint-disable-next-line no-misleading-character-class
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function unaccent(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

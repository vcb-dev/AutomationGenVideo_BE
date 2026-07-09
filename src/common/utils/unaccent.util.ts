// Port của _unaccent_match (Python unidecode-based) dùng ở nhiều view đọc scraper cũ.
// Chuẩn hoá dấu tiếng Việt qua NFD + xử lý riêng đ/Đ (không tách được qua NFD).
// 'da quy' khớp 'đá quý'.

// eslint-disable-next-line no-misleading-character-class
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function unaccent(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function unaccentMatch(text: string | null | undefined, query: string): boolean {
  if (!text || !query) return false;
  return unaccent(text).toLowerCase().includes(unaccent(query).toLowerCase());
}

export function unaccentIncludesHashtag(hashtags: string[] | null | undefined, query: string): boolean {
  const q = query.toLowerCase().replace(/^#/, '');
  return (hashtags || []).some((h) => h.toLowerCase().includes(q));
}

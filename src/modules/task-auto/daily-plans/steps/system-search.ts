import { unaccent } from "../../../../common/utils/unaccent.util";
import { ContentCandidate } from "../types";

/** Chữ thường, bỏ dấu tiếng Việt (kể cả đ), gộp khoảng trắng — "Nhẫn  Cưới" khớp "nhan cuoi". */
export function normalizeSearchText(text: string | null | undefined): string {
  return unaccent(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mọi từ trong `q` đều có trong tiêu đề hoặc mã content (không phân biệt dấu/hoa thường). */
export function contentMatchesQuery(c: Pick<ContentCandidate, "title" | "code">, q: string): boolean {
  const tokens = normalizeSearchText(q).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeSearchText(`${c.title ?? ""} ${c.code ?? ""}`);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Bỏ các bản trùng của cùng 1 content ở nhiều kho (khớp theo khoá nhận diện), giữ bản ở kho gần
 * người làm nhất: kho cá nhân → kho team → kho tổng.
 */
export function dedupeContentCopies(candidates: ContentCandidate[]): ContentCandidate[] {
  const seen = new Set<string>();
  const kept: ContentCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => a.tier - b.tier)) {
    if (c.keys.some((k) => seen.has(k))) continue;
    kept.push(c);
    for (const k of c.keys) seen.add(k);
  }
  return kept;
}

/** Tuyến ghi trong caption video (#A1..#A5 — cùng quy ước bộ lọc tuyến của lưới video), không có → null. */
export function lineNameFromCaption(caption: string | null | undefined): string | null {
  const m = (caption ?? "").match(/#(a[1-5])(?![\p{L}\p{N}])/iu);
  return m ? m[1].toUpperCase() : null;
}

// ── Thị trường ────────────────────────────────────────────────────────────────

export const SEARCH_MARKETS = ["vn", "global", "all"] as const;
export type SearchMarket = (typeof SEARCH_MARKETS)[number];

function isVietnamMarket(market: string | null | undefined): boolean {
  return (market || "VIETNAM").toUpperCase() === "VIETNAM";
}

/** Mặc định theo thị trường của team: team Việt Nam → Việt Nam, team nước ngoài → Global. */
export function defaultSearchMarket(team: { market: string | null }): Exclude<SearchMarket, "all"> {
  return isVietnamMarket(team.market) ? "vn" : "global";
}

/** Content: Việt Nam = market VIETNAM, Global = mọi thị trường còn lại (GLOBAL/THAILAND/JAPAN/...). */
export function contentMatchesMarket(c: { market: string | null }, market: SearchMarket): boolean {
  if (market === "all") return true;
  return market === "vn" ? isVietnamMarket(c.market) : !isVietnamMarket(c.market);
}

/**
 * Tham số `market` của lưới video (content-filters.ts marketFilter: đoán theo dấu tiếng Việt). Nhánh
 * "vn" ở đó loại video Đồ Da, nên team Đồ Da chọn Việt Nam phải dùng nhánh "doda".
 */
export function videoMarketParam(market: SearchMarket, brandType: string): string | undefined {
  if (market === "all") return undefined;
  if (market === "vn") return brandType === "DO_DA" ? "doda" : "vn";
  return "global";
}

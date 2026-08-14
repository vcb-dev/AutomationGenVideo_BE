/**
 * Helpers dùng chung bởi các script export/seed dữ liệu `characters` trong `scratch/`
 * (14e7727, b5d407d) — trước đây copy-paste giống hệt nhau ở 3 file, tách ra một nguồn
 * duy nhất để sửa 1 chỗ áp dụng cho cả 3.
 */

/**
 * Escape một chuỗi để nhúng an toàn vào template literal TypeScript.
 *
 * ECMAScript chuẩn hoá mọi CR/CRLF *nằm literal* trong template string thành LF khi engine
 * parse/thực thi. Nếu để \r thật trong backtick, mỗi lần file kết quả được require/ts-node/
 * node chạy lại, các dòng \r\n gốc sẽ rụng mất \r. Escape \r thành chuỗi "\r" TƯỜNG MINH
 * (backslash + r) — lúc đó nó chỉ là escape sequence, không bị chuẩn hoá, và khi evaluate
 * lại sẽ tái tạo đúng byte CR ban đầu.
 */
export function toTemplateLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return `\`${escaped}\``;
}

/** slug ("huy-k") -> tên hằng số hợp lệ ("HUY_K_SYSTEM_PROMPT"), bỏ dấu tiếng Việt. */
export function toConstName(slug: string): string {
  const base = slug
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^_+|_+$/g, '');
  return `${base}_SYSTEM_PROMPT`;
}

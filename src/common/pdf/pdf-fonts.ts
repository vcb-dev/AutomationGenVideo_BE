import * as fs from 'fs';
import * as path from 'path';

/**
 * Font Unicode cho mọi PDF do BE sinh ra.
 *
 * Bản trước dò font theo đường dẫn của HỆ ĐIỀU HÀNH (C:/Windows/Fonts, /usr/share/fonts/...).
 * Cách đó chạy được trên máy dev Windows nên không ai thấy vấn đề, nhưng image production là
 * `node:20-alpine` — KHÔNG cài sẵn font nào, và ngay cả khi `apk add ttf-dejavu` thì Alpine
 * đặt file ở `/usr/share/fonts/dejavu/` chứ không phải `/usr/share/fonts/truetype/dejavu/`
 * như đường dẫn Debian đang dò. Kết quả: production luôn rơi về Helvetica, mà Helvetica là
 * font 1-byte WinAnsi — pdfkit ghi "Ễ" (U+1EC4) thành 2 byte thô, PDF in ra ký tự rác.
 *
 * Nên bây giờ font được COMMIT THẲNG vào `assets/fonts/` (cùng cách đã làm với
 * `card-frame-*.png`, và Dockerfile đã có sẵn dòng `COPY assets ./assets/`). Không còn dò
 * đường dẫn hệ điều hành nữa: file font đi cùng mã nguồn thì môi trường nào cũng như nhau.
 *
 * Font đã chọn: Noto Sans (SIL Open Font License 1.1, kèm LICENSE trong assets/fonts) — đã
 * kiểm bằng fontkit: đủ glyph cho toàn bộ 178 ký tự chữ cái tiếng Việt hoa/thường, gồm cả các
 * tổ hợp hai dấu như Ễ/Ộ/Ữ/Ỡ mà nhiều font Latin cơ bản thiếu.
 */

const FONT_DIR_SEGMENTS = ['assets', 'fonts'];
const REGULAR_FILE = 'NotoSans-Regular.ttf';
const BOLD_FILE = 'NotoSans-Bold.ttf';

/** Tên font đăng ký trong PDFDocument — dùng ở `doc.font(...)`. */
export const VN_FONT = 'vn';
export const VN_FONT_BOLD = 'vn-bold';

/**
 * Chỗ đứng của `assets/` khác nhau tuỳ cách chạy: production chạy `node dist/main.js` từ
 * WORKDIR `/app` nên `process.cwd()/assets` là đúng, còn test/script chạy từ thư mục khác thì
 * không. Vì vậy tìm thêm bằng cách đi ngược lên từ `__dirname` (dist/common/pdf → /app, hoặc
 * src/common/pdf → gốc repo). Tất cả đều là đường dẫn TƯƠNG ĐỐI so với mã nguồn, không có
 * đường dẫn nào của hệ điều hành.
 */
function candidateFontDirs(): string[] {
  const dirs = [path.join(process.cwd(), ...FONT_DIR_SEGMENTS)];
  let cur = __dirname;
  for (let i = 0; i < 6; i++) {
    dirs.push(path.join(cur, ...FONT_DIR_SEGMENTS));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dirs;
}

/** Cặp đường dẫn font đã commit sẵn. Ném lỗi nếu thiếu file — xem `registerVietnameseFonts`. */
export function resolveVietnameseFontFiles(): { regular: string; bold: string } {
  const tried = candidateFontDirs();
  for (const dir of tried) {
    const regular = path.join(dir, REGULAR_FILE);
    const bold = path.join(dir, BOLD_FILE);
    if (fs.existsSync(regular) && fs.existsSync(bold)) return { regular, bold };
  }
  throw new Error(
    `Không đọc được font tiếng Việt đã commit sẵn (${REGULAR_FILE} + ${BOLD_FILE}). ` +
      `Đã tìm ở: ${tried.join(', ')}. ` +
      `File font phải nằm trong assets/fonts/ và Dockerfile phải giữ dòng "COPY assets ./assets/".`,
  );
}

/**
 * Đăng ký font tiếng Việt vào một PDFDocument và trả về tên font để gọi `doc.font(...)`.
 *
 * CỐ TÌNH ném lỗi thay vì lùi về Helvetica như bản trước: fallback âm thầm khiến API vẫn trả
 * 200 với file PDF sai dấu, không ai biết cho tới lúc thẻ đã in ra giấy. Hỏng hẳn kèm thông
 * báo rõ ràng thì phát hiện được ngay ở request đầu tiên.
 */
export function registerVietnameseFonts(doc: {
  registerFont(name: string, src: string): unknown;
}): { regular: string; bold: string } {
  const { regular, bold } = resolveVietnameseFontFiles();
  doc.registerFont(VN_FONT, regular);
  doc.registerFont(VN_FONT_BOLD, bold);
  return { regular: VN_FONT, bold: VN_FONT_BOLD };
}

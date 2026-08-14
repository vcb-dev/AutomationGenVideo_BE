import { toTemplateLiteral, toConstName } from '../character-export.util';

/**
 * Script export/seed characters (14e7727, b5d407d) sinh ra file .ts chứa system_prompt
 * NGUYÊN VĂN (kể cả \r\n gốc) dưới dạng template literal — bản thật của HuyK dài 29.424 ký
 * tự, và một lần seed lại ĐÃ từng ghi đè mất bản mới vì literal \r bị ECMAScript chuẩn hoá
 * rụng mất khi file được require/ts-node lại. Test này khoá đúng cơ chế escape đã sửa lỗi
 * đó, evaluate ngược lại bằng `new Function` để xác nhận không chỉ escape ĐÚNG mà còn
 * ROUND-TRIP đúng — giữ lại y nguyên chuỗi gốc sau khi eval.
 */

/** Evaluate chuỗi template-literal-đã-escape y như khi file kết quả được require lại. */
function evalTemplateLiteral(escaped: string): string {
  // eslint-disable-next-line no-new-func
  return new Function(`return ${escaped};`)();
}

describe('toTemplateLiteral', () => {
  it('round-trip giữ nguyên \\r\\n gốc sau khi eval lại (lỗi đã sửa: CRLF rụng mất \\r)', () => {
    const original = 'dòng 1\r\ndòng 2\r\ndòng 3';

    const literal = toTemplateLiteral(original);
    const evaluated = evalTemplateLiteral(literal);

    expect(evaluated).toBe(original);
    expect(evaluated).toContain('\r\n');
  });

  it('escape \\r thành chuỗi "\\\\r" tường minh, không để byte CR thật trong output', () => {
    const literal = toTemplateLiteral('a\rb');

    expect(literal).toContain('\\r');
    expect(literal).not.toMatch(/[^\\]\r/); // không còn CR thật (chỉ escape sequence)
  });

  it('escape backslash TRƯỚC để không tự nhân đôi khi escape \\r sau đó', () => {
    const original = 'đường dẫn C:\\temp\\a.txt';

    const evaluated = evalTemplateLiteral(toTemplateLiteral(original));

    expect(evaluated).toBe(original);
  });

  it('escape backtick — nếu không, backtick trong nội dung sẽ đóng sớm template literal', () => {
    const original = 'trích dẫn `code` ở giữa câu';

    const literal = toTemplateLiteral(original);
    const evaluated = evalTemplateLiteral(literal);

    expect(evaluated).toBe(original);
  });

  it('escape ${...} — nếu không, bị hiểu nhầm thành interpolation khi eval lại', () => {
    const original = 'giá ${100} đồng, biến ${foo.bar}';

    const literal = toTemplateLiteral(original);
    const evaluated = evalTemplateLiteral(literal);

    expect(evaluated).toBe(original);
  });

  it('nội dung dài thật (mô phỏng system_prompt HuyK) round-trip nguyên vẹn độ dài', () => {
    const original = 'Xin chào tôi là HuyK.\r\n'.repeat(1200); // > 29.000 ký tự, có CRLF rải khắp

    const evaluated = evalTemplateLiteral(toTemplateLiteral(original));

    expect(evaluated.length).toBe(original.length);
    expect(evaluated).toBe(original);
  });

  it('chuỗi rỗng không lỗi, round-trip ra chuỗi rỗng', () => {
    expect(evalTemplateLiteral(toTemplateLiteral(''))).toBe('');
  });
});

describe('toConstName', () => {
  it('slug đơn giản -> UPPER_SNAKE_CASE kèm hậu tố _SYSTEM_PROMPT', () => {
    expect(toConstName('huyk')).toBe('HUYK_SYSTEM_PROMPT');
  });

  it('slug có dấu gạch ngang -> gạch dưới', () => {
    expect(toConstName('anh-tuan')).toBe('ANH_TUAN_SYSTEM_PROMPT');
  });

  it('bỏ dấu tiếng Việt (normalize NFD)', () => {
    expect(toConstName('huy-khánh')).toBe('HUY_KHANH_SYSTEM_PROMPT');
  });

  it('không để gạch dưới thừa ở đầu/cuối khi slug có ký tự đặc biệt ở biên', () => {
    expect(toConstName('-huyk-')).toBe('HUYK_SYSTEM_PROMPT');
  });
});

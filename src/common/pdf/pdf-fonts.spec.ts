import * as fs from 'fs';
import * as zlib from 'zlib';
import * as PDFDocument from 'pdfkit';
import { registerVietnameseFonts, resolveVietnameseFontFiles } from './pdf-fonts';

/**
 * Lỗi đã gặp trên production: không có font Unicode → pdfkit lùi về Helvetica (font 1-byte
 * WinAnsi) → "Nguyễn" bị ghi thành byte thô, PDF in ra ký tự rác. Test này dựng PDF THẬT rồi
 * ĐỌC NGƯỢC text ra qua bảng ToUnicode CMap — đúng cách trình xem PDF giải mã — nên nó bắt
 * được lỗi đó chứ không chỉ kiểm tra "có gọi registerFont hay chưa".
 */

const NAMES = ['NGUYỄN THỊ BÍCH NGỌC', 'Đặng Hữu Phước', 'Ễ Ộ Ữ Ỡ Ặ ỷ đ Đ'];

function buildPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new (PDFDocument as any)({ size: [420, 669], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const { regular, bold } = registerVietnameseFonts(doc);
    let y = 40;
    for (const n of NAMES) {
      doc.font(bold).fontSize(13).fillColor('#000').text(n, 20, y, { lineBreak: false });
      y += 30;
      doc.font(regular).fontSize(11).text(n, 20, y, { lineBreak: false });
      y += 30;
    }
    doc.end();
  });
}

// ── Bộ đọc text tối giản: mỗi font nhúng có ToUnicode CMap riêng nên phải bám theo `/Fx Tf` ──
interface PdfObj { dict: string; stream: Buffer | null }

function parseObjects(pdf: Buffer): Map<string, PdfObj> {
  const s = pdf.toString('latin1');
  const objs = new Map<string, PdfObj>();
  const re = /(\d+) 0 obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const bodyStart = m.index + m[0].length;
    const endObj = s.indexOf('endobj', bodyStart);
    if (endObj < 0) continue;
    const sm = /stream\r?\n/.exec(s.slice(bodyStart, endObj));
    if (!sm) {
      objs.set(m[1], { dict: s.slice(bodyStart, endObj), stream: null });
      continue;
    }
    const sStart = bodyStart + sm.index + sm[0].length;
    const raw = pdf.subarray(sStart, s.indexOf('endstream', sStart));
    let stream: Buffer;
    try { stream = zlib.inflateSync(raw); } catch { stream = raw; }
    objs.set(m[1], { dict: s.slice(bodyStart, bodyStart + sm.index), stream });
  }
  return objs;
}

function parseCMap(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  const rangeArr = /<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rangeArr.exec(cmap))) {
    const lo = parseInt(m[1], 16);
    (m[3].match(/<([0-9a-fA-F]*)>/g) || []).forEach((it, i) => {
      const hex = it.slice(1, -1);
      const uni = (hex.match(/.{4}/g) || []).map(h => String.fromCharCode(parseInt(h, 16))).join('');
      map.set((lo + i).toString(16).padStart(4, '0'), uni);
    });
  }
  return map;
}

function extractLines(pdf: Buffer): string[] {
  const objs = parseObjects(pdf);
  const maps = new Map<string, Map<string, string>>();
  for (const o of objs.values()) {
    const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dict);
    if (!fontDict) continue;
    const pair = /\/(F\d+)\s+(\d+) 0 R/g;
    let p: RegExpExecArray | null;
    while ((p = pair.exec(fontDict[1]))) {
      const tu = /\/ToUnicode\s+(\d+) 0 R/.exec(objs.get(p[2])?.dict || '');
      const cmap = tu ? objs.get(tu[1])?.stream : null;
      maps.set(p[1], cmap ? parseCMap(cmap.toString('latin1')) : new Map());
    }
  }

  const byY = new Map<string, string>();
  for (const o of objs.values()) {
    const st = o.stream?.toString('latin1');
    if (!st || !/\bTJ\b|\bTj\b/.test(st)) continue;
    const tok = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\/(F\d+)[^\n]*Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\(([^)]*)\)\s*Tj/g;
    let y = '0';
    let cur = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = tok.exec(st))) {
      if (m[1] !== undefined) { y = m[2]; continue; }
      if (m[3] !== undefined) { cur = maps.get(m[3]) || new Map(); continue; }
      const decode = (body: string) => {
        let r = '';
        if (cur.size > 0) for (const c of body.match(/.{4}/g) || []) r += cur.get(c) ?? '�';
        else for (const b of body.match(/.{2}/g) || []) r += String.fromCharCode(parseInt(b, 16));
        return r;
      };
      let piece = '';
      if (m[4] !== undefined) for (const h of m[4].match(/<([0-9a-fA-F]+)>/g) || []) piece += decode(h.slice(1, -1).toLowerCase());
      else if (m[5] !== undefined) piece = decode(m[5].toLowerCase());
      else if (m[6] !== undefined) piece = m[6];
      byY.set(y, (byY.get(y) || '') + piece);
    }
  }
  return [...byY.values()].map(l => l.replace(/\s+/g, ' ').trim());
}

describe('pdf-fonts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('font tiếng Việt được commit sẵn trong assets/fonts, không phụ thuộc font hệ điều hành', () => {
    const { regular, bold } = resolveVietnameseFontFiles();
    expect(fs.statSync(regular).size).toBeGreaterThan(100_000);
    expect(fs.statSync(bold).size).toBeGreaterThan(100_000);
    // Không được là đường dẫn font của HĐH — đó chính là lỗi cũ (container Alpine không có).
    expect(regular).not.toMatch(/Windows\/Fonts|\/usr\/share\/fonts|\/System\/Library/i);
  });

  it('PDF sinh ra giữ nguyên dấu tiếng Việt (đọc ngược qua ToUnicode CMap)', async () => {
    const lines = extractLines(await buildPdf());
    for (const name of NAMES) {
      expect(lines).toContain(name.replace(/\s+/g, ' ').trim());
    }
  });

  it('thiếu file font thì NÉM LỖI thay vì lặng lẽ xuất PDF sai dấu', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => resolveVietnameseFontFiles()).toThrow(/Không đọc được font tiếng Việt/);
  });
});

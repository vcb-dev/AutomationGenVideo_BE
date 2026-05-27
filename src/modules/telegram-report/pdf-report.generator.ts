import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

// ─── Colors — professional, low-saturation palette ───────────────────────────
const C = {
  primary:   '#1E3A5F',   // deep navy
  accent:    '#2D6A9F',   // calm blue (was bright violet)
  gold:      '#9B7D4B',   // warm bronze (was amber)
  green:     '#2D7D5A',   // muted emerald
  red:       '#B05252',   // muted red
  blue:      '#2D6A9F',   // calm blue
  teal:      '#357A7A',   // muted teal
  gray1:     '#1A2433',   // near-black navy
  gray2:     '#374151',
  gray3:     '#6B7280',
  gray4:     '#D1D5DB',
  gray5:     '#F4F6F8',   // very light cool gray
  white:     '#FFFFFF',
  rowAlt:    '#EEF2F6',   // light blue-gray (was purple-tinted)
  rowAlt2:   '#EAF0F5',   // slightly darker blue-gray
  headerBg:  '#EEF2F6',   // section header background
};

// ─── Fonts ────────────────────────────────────────────────────────────────────
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
];

// ─── Main Generator ──────────────────────────────────────────────────────────
export class PdfReportGenerator {
  private doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private W: number;   // content width
  private L = 36;      // left margin
  private hasFont = false;
  private fontReg = 'Helvetica';
  private fontBold = 'Helvetica-Bold';

  constructor() {
    this.doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    this.W = this.doc.page.width - 72;
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));

    const fp = FONT_CANDIDATES.find(f => fs.existsSync(f));
    if (fp) {
      this.doc.registerFont('VN', fp);
      this.fontReg = 'VN';
      this.fontBold = 'VN';
      this.hasFont = true;
    }
  }

  async generate(data: ReportData): Promise<Buffer> {
    return new Promise(resolve => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this._build(data);
      this.doc.end();
    });
  }

  // ── Build all pages ────────────────────────────────────────────────────────

  private _build(data: ReportData) {
    if (data.type === 'traffic') this._buildTraffic(data);
    else this._buildAds(data);
    this._addPageNumbers();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRAFFIC REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildTraffic(d: ReportData) {
    const { year, month } = d;

    // Cover
    this._cover(`BÁO CÁO TRAFFIC\nTHÁNG ${month}/${year}`, C.teal);
    this.doc.addPage();

    // S1: Tổng quan
    this._sectionHeader('1. TỔNG QUAN HIỆU SUẤT', C.teal);
    this._kpiGrid([
      { label: 'Tổng lượt xem', value: this._f(d.totalViews),  sub: this._delta(d.totalViews, d.prevTotalViews) },
      { label: 'Team Việt Nam', value: this._f(d.vnViews),      sub: this._delta(d.vnViews, d.prevVnViews) },
      { label: 'Team Global',   value: this._f(d.globalViews),  sub: this._delta(d.globalViews, d.prevGlobalViews) },
      { label: 'Tổng video',    value: this._f(d.totalVideos),  sub: this._delta(d.totalVideos, d.prevTotalVideos) },
    ], C.teal);
    this.doc.moveDown(0.5);

    // S2: Platform
    this._sectionHeader('2. PHÂN BỔ THEO NỀN TẢNG', C.blue);
    if (d.byPlatform.length > 0) {
      this._platformTable(d.byPlatform, d.totalViews);
      this._barChart(d.byPlatform.map(r => ({ label: r.platform, value: this._n(r.views) })), C.blue);
    }
    this.doc.addPage();

    // S3: Team
    this._sectionHeader('3. TRAFFIC THEO TEAM & KHU VỰC', C.accent);
    this._table(
      ['Thị trường', 'Team', 'Nền tảng', 'Lượt xem', '% Tổng', 'Videos', 'Followers'],
      [65, 95, 65, 75, 50, 55, 65],
      d.byTeam.map((r, _, arr) => {
        const tot = arr.reduce((a: number, x: any) => a + this._n(x.views), 0);
        return [
          this._isGlobal(r.team) ? 'Global' : 'Việt Nam',
          r.team || 'N/A', r.platform || '',
          this._f(r.views),
          tot > 0 ? ((this._n(r.views)/tot)*100).toFixed(1) + '%' : '0%',
          this._f(r.videos), this._f(r.followers),
        ];
      }),
      C.accent,
    );

    // S4: Content types A1-A5
    if (d.contentTypes.length > 0) {
      this.doc.moveDown(0.5);
      this._sectionHeader('4. PHÂN BỔ THEO LOẠI NỘI DUNG (A1-A5)', C.gold);
      const ctMap: Record<string, {videos: number; views: number}> = {};
      for (const r of d.contentTypes) {
        if (!ctMap[r.ct]) ctMap[r.ct] = { videos: 0, views: 0 };
        ctMap[r.ct].videos += this._n(r.videos);
        ctMap[r.ct].views  += this._n(r.views);
      }
      this._table(
        ['Loại', 'Số video', 'Tổng views', 'View/Video'],
        [60, 80, 100, 90],
        Object.entries(ctMap).sort(([a],[b]) => a<b?-1:1).map(([ct, v]) => [
          ct, String(v.videos), this._f(v.views),
          v.videos > 0 ? this._f(Math.round(v.views / v.videos)) : '-',
        ]),
        C.gold,
      );
      this._barChart(
        Object.entries(ctMap).sort(([a],[b])=>a<b?-1:1).map(([k, v]) => ({ label: k, value: v.views })),
        C.gold,
      );
    }

    this.doc.addPage();

    // S5: Top channels
    this._sectionHeader('5. KÊNH NỔI BẬT', C.blue);
    this._table(
      ['#', 'Kênh', 'Nền tảng', 'Team', 'Lượt xem'],
      [25, 160, 60, 80, 90],
      d.topChannels.slice(0, 10).map((r, i) => [
        String(i + 1), (r.channel_name || '').slice(0, 28),
        r.platform || '', r.team || '', this._f(r.views),
      ]),
      C.blue,
    );

    // S6: Top 10 views
    this.doc.moveDown(0.5);
    this._sectionHeader('6. TOP 10 VIDEO NHIỀU VIEWS NHẤT', C.green);
    this._table(
      ['#', 'Tiêu đề', 'Kênh', 'Team', 'Views', 'Likes', 'CMT'],
      [22, 140, 75, 65, 55, 45, 45],
      d.topViews.map((r, i) => [
        String(i + 1), (r.title || '').slice(0, 28),
        (r.channel_name || '').slice(0, 14), r.team || '',
        this._f(r.views), this._f(r.likes), this._f(r.comments),
      ]),
      C.green,
    );

    this.doc.addPage();

    // S7: Top 10 comments
    this._sectionHeader('7. TOP 10 VIDEO NHIỀU COMMENT NHẤT', C.primary);
    this._table(
      ['#', 'Tiêu đề', 'Kênh', 'Team', 'CMT', 'Views'],
      [22, 150, 80, 65, 55, 75],
      d.topCmts.map((r, i) => [
        String(i + 1), (r.title || '').slice(0, 30),
        (r.channel_name || '').slice(0, 16), r.team || '',
        this._f(r.comments), this._f(r.views),
      ]),
      C.primary,
    );

    // S8: Top SKUs
    if (d.topSkus.length > 0) {
      this.doc.moveDown(0.5);
      this._sectionHeader('8. TOP SKU NHIỀU VIDEO NHẤT', C.gold);
      this._table(
        ['SKU', 'Số video', 'Tổng views', 'Teams'],
        [60, 70, 90, 220],
        d.topSkus.slice(0, 10).map(r => [
          r.sku, String(this._n(r.videos)), this._f(r.views),
          Array.isArray(r.teams) ? r.teams.filter(Boolean).slice(0, 3).join(', ') : '',
        ]),
        C.gold,
      );
    }

    this.doc.addPage();

    // S9: Nhận xét & Đề xuất
    this._sectionHeader('9. NHẬN XÉT & ĐỀ XUẤT', C.accent);
    this._recommendations(d, 'traffic');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ADS REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildAds(d: ReportData) {
    const { year, month } = d;
    const BM = { great: 18000, good: 25000, avg: 40000 };
    const cpmLabel = (c: number) => c <= BM.great ? 'Xuất sắc' : c <= BM.good ? 'Tốt' : c <= BM.avg ? 'Trung bình' : 'Cần tối ưu';
    const cpmColor = (c: number) => c <= BM.great ? C.green : c <= BM.good ? C.gold : c <= BM.avg ? '#A0823A' : C.red;

    // Cover
    this._cover(`BÁO CÁO QUẢNG CÁO\nTHÁNG ${month}/${year}`, C.accent);
    this.doc.addPage();

    // S1: Tổng quan
    this._sectionHeader('1. TỔNG QUAN CHI PHÍ QUẢNG CÁO', C.accent);
    const ts = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.spend), 0);
    const tm = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.mess), 0);
    const tl = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.likes), 0);
    const te = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.engage), 0);
    const cpm = tm > 0 ? Math.round(ts / tm) : 0;
    const vnS = (d.adsTeam || []).filter((r: any) => !this._isGlobal(r.team)).reduce((a: number, r: any) => a + this._n(r.spend), 0);
    const glS = (d.adsTeam || []).filter((r: any) => this._isGlobal(r.team)).reduce((a: number, r: any) => a + this._n(r.spend), 0);

    this._kpiGrid([
      { label: 'Tổng chi phí',    value: this._f(ts) + ' VND',  sub: `VN: ${this._f(vnS)} | GL: ${this._f(glS)}` },
      { label: 'Tin nhắn (Mess)', value: this._f(tm),            sub: `CPMess: ${this._f(cpm)} VND` },
      { label: 'Like Page',       value: this._f(tl) },
      { label: 'Tương tác',       value: this._f(te) },
    ], C.accent);

    // Benchmark box
    this.doc.moveDown(0.4);
    const bColor = cpmColor(cpm);
    const bLabel = cpmLabel(cpm);
    const boxY = this.doc.y;
    const boxH = 26;
    // Use a muted background for the benchmark box
    this.doc.roundedRect(this.L, boxY, this.W, boxH, 4).fill(C.gray5).stroke(bColor);
    this.doc.fillColor(bColor).font(this.fontBold).fontSize(9)
      .text(
        `ĐÁNH GIÁ CPMESS: ${bLabel.toUpperCase()}  (${this._f(cpm)} VND)  |  Benchmark: <18K Xuất sắc | 18-25K Tốt | 25-40K TB | >40K Cần tối ưu`,
        this.L + 8, boxY + 8,
        { width: this.W - 16, align: 'center', lineBreak: false },
      );
    this.doc.y = boxY + boxH + 10;
    this.doc.fillColor(C.gray1);

    // S2: Phân bổ theo thị trường
    this._sectionHeader('2. PHÂN BỔ THEO THỊ TRƯỜNG', C.blue);
    const mktData: Record<string, {sp: number; ms: number; ims: number}> = {
      'Việt Nam': {sp:0, ms:0, ims:0}, 'Global': {sp:0, ms:0, ims:0},
    };
    for (const r of (d.adsTeam || [])) {
      const mk = this._isGlobal(r.team) ? 'Global' : 'Việt Nam';
      mktData[mk].sp  += this._n(r.spend);
      mktData[mk].ms  += this._n(r.mess);
      mktData[mk].ims += this._n(r.impr);
    }
    this._table(
      ['Thị trường', 'Chi phí (VND)', 'Tin nhắn', 'Hiển thị', 'CPMess', '% Chi phí', 'Đánh giá'],
      [70, 95, 60, 70, 70, 60, 90],
      Object.entries(mktData).map(([mk, v]) => {
        const cpmMk = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
        return [mk, this._f(v.sp)+' VND', this._f(v.ms), this._f(v.ims),
          this._f(cpmMk), ts>0 ? ((v.sp/ts)*100).toFixed(1)+'%' : '0%',
          cpmLabel(cpmMk)];
      }),
      C.blue,
    );
    this._barChart([
      { label: 'Việt Nam', value: mktData['Việt Nam'].sp },
      { label: 'Global',   value: mktData['Global'].sp },
    ], C.blue);

    this.doc.addPage();

    // S3: Theo loại chiến dịch
    this._sectionHeader('3. PHÂN TÍCH THEO LOẠI CHIẾN DỊCH', C.gold);
    const ctSpend: Record<string, {sp:number; ms:number; camps:number}> = {};
    for (const c of (d.adsCamps || [])) {
      const ct = this._campType(c);
      if (!ctSpend[ct]) ctSpend[ct] = {sp:0, ms:0, camps:0};
      ctSpend[ct].sp += this._n(c.spend);
      ctSpend[ct].ms += this._n(c.mess);
      ctSpend[ct].camps++;
    }
    this._table(
      ['Loại camp', 'Số campaign', 'Chi phí', 'Tin nhắn', 'CPMess', 'Đánh giá'],
      [90, 80, 100, 70, 70, 100],
      Object.entries(ctSpend).map(([ct, v]) => {
        const cpmCt = v.ms > 0 ? Math.round(v.sp / v.ms) : 0;
        return [ct, String(v.camps), this._f(v.sp)+' VND', this._f(v.ms), this._f(cpmCt), cpmLabel(cpmCt)];
      }),
      C.gold,
    );
    this._barChart(
      Object.entries(ctSpend).map(([k, v]) => ({ label: k, value: v.sp })),
      C.gold,
    );

    // S4: Chi tiết theo team
    this._sectionHeader('4. CHI TIẾT THEO TEAM', C.primary);
    this._table(
      ['Thị trường', 'Team', 'Chi phí', 'Tin nhắn', 'Hiển thị', 'CPMess', 'Đánh giá'],
      [65, 90, 90, 55, 65, 55, 90],
      (d.adsTeam || []).map((r: any) => {
        const cpmR = this._n(r.mess) > 0 ? Math.round(this._n(r.spend) / this._n(r.mess)) : 0;
        return [
          this._isGlobal(r.team) ? 'Global' : 'VN',
          r.team || 'N/A',
          this._f(r.spend) + ' VND',
          this._f(r.mess),
          this._f(r.impr),
          this._f(cpmR),
          cpmLabel(cpmR),
        ];
      }),
      C.primary,
    );

    this.doc.addPage();

    // S5: Nhận xét
    this._sectionHeader('5. NHẬN XÉT & ĐỀ XUẤT', C.accent);
    this._recommendations(d, 'ads');
  }

  // ─── Drawing Primitives ───────────────────────────────────────────────────

  private _cover(title: string, color: string) {
    const doc = this.doc;
    const PW = doc.page.width;
    const PH = doc.page.height;

    // Clean light background
    doc.rect(0, 0, PW, PH).fill('#FAFBFC');
    // Thin top accent strip
    doc.rect(0, 0, PW, 6).fill(color);
    // Subtle bottom footer strip
    doc.rect(0, PH - 36, PW, 36).fill('#F0F2F5');

    // Logo
    const logoPath = path.join(__dirname, '..', '..', '..', '..', 'public', 'images', 'ai-avatar.png');
    const logoY = 60;
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, PW / 2 - 32, logoY, { width: 64, height: 64 });
    }

    // Company name
    const nameY = fs.existsSync(logoPath) ? logoY + 78 : 70;
    doc.fillColor(color).font(this.fontBold).fontSize(10)
      .text('VCB STUDIO', 60, nameY, { align: 'center', width: PW - 120 });

    // Short accent line under company name
    doc.moveTo(PW / 2 - 40, nameY + 16).lineTo(PW / 2 + 40, nameY + 16)
      .lineWidth(1.5).strokeColor(color).stroke();

    // Main title
    doc.fillColor(C.primary).font(this.fontBold).fontSize(22)
      .text(title, 60, nameY + 28, { align: 'center', width: PW - 120 });

    // Divider
    const lineCount = title.split('\n').length;
    const dY = nameY + 28 + lineCount * 30 + 16;
    doc.moveTo(this.L + 50, dY).lineTo(PW - this.L - 50, dY)
      .lineWidth(0.5).strokeColor(C.gray4).stroke();

    // Generated date
    doc.fillColor(C.gray3).font(this.fontReg).fontSize(9)
      .text(`Tạo lúc: ${new Date().toLocaleString('vi-VN')}`, 60, dY + 14, { align: 'center', width: PW - 120 });

    // Footer text on bottom strip
    doc.fillColor(C.gray3).font(this.fontReg).fontSize(7.5)
      .text('Báo cáo được tạo tự động bởi VCB Studio AI. Dữ liệu lấy từ database VCB Studio.', 60, PH - 24, { align: 'center', width: PW - 120 });
  }

  private _sectionHeader(title: string, color: string) {
    const doc = this.doc;
    if (doc.y > doc.page.height - 120) { doc.addPage(); }
    const y = doc.y + 6;
    // Light background — not the saturated color
    doc.rect(this.L, y, this.W, 22).fill(C.headerBg);
    // Narrow colored left accent bar (4 px)
    doc.rect(this.L, y, 4, 22).fill(color);
    // Dark text (readable without white-on-color)
    doc.fillColor(C.primary).font(this.fontBold).fontSize(10)
      .text(title, this.L + 12, y + 5, { width: this.W - 20 });
    doc.fillColor(C.gray1).moveDown(0.4);
  }

  private _kpiGrid(items: {label: string; value: string; sub?: string}[], color: string) {
    const doc = this.doc;
    const cw = this.W / items.length;
    const y0 = doc.y;
    items.forEach(({ label, value, sub }, i) => {
      const x = this.L + i * cw;
      doc.roundedRect(x, y0, cw - 6, 52, 3).fill(C.gray5).stroke(C.gray4);
      // Thin colored top accent
      doc.rect(x, y0, cw - 6, 3).fill(color);
      doc.fillColor(C.primary).font(this.fontBold).fontSize(13)
        .text(value, x + 4, y0 + 10, { width: cw - 14, align: 'center' });
      doc.fillColor(C.gray3).font(this.fontReg).fontSize(7)
        .text(label, x + 4, y0 + 28, { width: cw - 14, align: 'center' });
      if (sub) {
        const isNeg = sub.includes('Giảm') || sub.includes('-');
        const isPos = sub.includes('Tăng') || sub.includes('+');
        doc.fillColor(isPos ? C.green : isNeg ? C.red : C.gray3).fontSize(6.5)
          .text(sub, x + 4, y0 + 40, { width: cw - 14, align: 'center' });
      }
    });
    doc.y = y0 + 60;
  }

  private _table(headers: string[], widths: number[], rows: string[][], hColor: string) {
    const doc = this.doc;
    const totalW = widths.reduce((a, b) => a + b, 0);

    // Header — muted: use primary color background (dark but not saturated)
    let y = doc.y + 4;
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    doc.rect(this.L, y, totalW, 18).fill(C.primary);
    doc.fillColor(C.white).font(this.fontBold).fontSize(7.5);
    let x = this.L;
    headers.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: widths[i] - 6 }); x += widths[i]; });
    y += 18;

    rows.forEach((row, ri) => {
      if (y > doc.page.height - 40) { doc.addPage(); y = 50; }
      const isGlobalRow = row[0] === 'Global';
      const rowBg = ri % 2 === 0 ? (isGlobalRow ? C.rowAlt2 : C.rowAlt) : C.white;
      doc.rect(this.L, y, totalW, 14).fill(rowBg);
      doc.fillColor(C.gray1).font(this.fontReg).fontSize(6.5);
      x = this.L;
      row.forEach((cell, ci) => {
        const txt = String(cell);
        let fc = C.gray1;
        if (txt === 'Xuất sắc') fc = C.green;
        else if (txt === 'Tốt') fc = '#2D7D5A';
        else if (txt === 'Trung bình') fc = C.gold;
        else if (txt === 'Cần tối ưu') fc = C.red;
        doc.fillColor(fc).text(txt.slice(0, 36), x + 3, y + 3, { width: widths[ci] - 6 });
        doc.fillColor(C.gray1);
        x += widths[ci];
      });
      y += 14;
    });

    // Bottom border
    doc.moveTo(this.L, y).lineTo(this.L + totalW, y).lineWidth(0.5).strokeColor(C.gray4).stroke();
    doc.y = y + 6;
  }

  private _platformTable(rows: any[], totalViews: number) {
    this._table(
      ['Nền tảng', 'Lượt xem', 'Tỷ trọng', 'Số video', 'Nhận xét'],
      [80, 90, 60, 70, 155],
      rows.map(r => {
        const pct = totalViews > 0 ? ((this._n(r.views) / totalViews) * 100).toFixed(1) + '%' : '0%';
        const note = this._platformNote(r.platform);
        return [r.platform || '', this._f(r.views), pct, this._f(r.cnt), note];
      }),
      C.teal,
    );
  }

  private _barChart(items: {label: string; value: number}[], color: string) {
    if (!items.length) return;
    const doc = this.doc;
    const chartH = 80;
    const chartW = this.W;
    const maxVal = Math.max(...items.map(i => i.value), 1);
    const barW = Math.min(60, (chartW - 20) / items.length - 8);

    if (doc.y + chartH + 30 > doc.page.height - 40) { doc.addPage(); }
    const y0 = doc.y + 8;
    const baseY = y0 + chartH;

    // Axes
    doc.moveTo(this.L, y0).lineTo(this.L, baseY).lineWidth(0.5).strokeColor(C.gray4).stroke();
    doc.moveTo(this.L, baseY).lineTo(this.L + chartW, baseY).lineWidth(0.5).stroke();

    // Bars — slightly translucent feel via a lighter secondary fill
    items.forEach((item, i) => {
      const bH = Math.max(2, (item.value / maxVal) * chartH);
      const bX = this.L + 10 + i * (barW + 8);
      const bY = baseY - bH;

      doc.rect(bX, bY, barW, bH).fill(color);
      // Subtle top highlight
      doc.rect(bX, bY, barW, Math.min(3, bH)).fillOpacity(0.2).fill(C.white).fillOpacity(1);

      // Value label
      doc.fillColor(C.gray2).font(this.fontReg).fontSize(5.5)
        .text(this._f(item.value), bX - 2, bY - 9, { width: barW + 4, align: 'center' });

      // X label
      doc.fillColor(C.gray3).fontSize(6)
        .text(item.label.slice(0, 10), bX - 2, baseY + 3, { width: barW + 4, align: 'center' });
    });

    doc.y = baseY + 22;
  }

  private _recommendations(d: ReportData, type: 'ads' | 'traffic') {
    const doc = this.doc;
    const items: {icon: string; title: string; body: string; color: string}[] = [];

    if (type === 'traffic') {
      const total = d.totalViews || 0;
      const glPct = total > 0 ? ((d.globalViews || 0) / total * 100) : 0;
      items.push({
        icon: '✓', title: 'Điểm mạnh',
        body: `Tổng lượt xem ${this._f(total)}. Global chiếm ${glPct.toFixed(1)}% tổng traffic.`,
        color: C.green,
      });
      if (d.contentTypes.length > 0) {
        const ctMap: Record<string, number> = {};
        for (const r of d.contentTypes) ctMap[r.ct] = (ctMap[r.ct]||0) + this._n(r.views);
        const topCt = Object.entries(ctMap).sort(([,a],[,b])=>b-a)[0];
        items.push({
          icon: '★', title: 'Content hiệu quả nhất',
          body: `${topCt?.[0] || 'A1'} đang có view cao nhất. Nên ưu tiên sản xuất loại nội dung này.`,
          color: C.gold,
        });
      }
      items.push({
        icon: '→', title: 'Đề xuất tháng tới',
        body: '1. Duy trì momentum Facebook. 2. Tăng REELs Global. 3. Phân tích A1-A5 để optimize content mix. 4. Theo dõi kênh có view/video cao để scale.',
        color: C.blue,
      });
    } else {
      const ts = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.spend), 0);
      const tm = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.mess), 0);
      const cpm = tm > 0 ? Math.round(ts / tm) : 0;
      items.push({
        icon: '✓', title: 'Kết quả',
        body: `Tổng chi phí ${this._f(ts)} VND, CPMess ${this._f(cpm)} VND — ${cpm <= 18000 ? 'Xuất sắc' : cpm <= 25000 ? 'Tốt' : cpm <= 40000 ? 'Trung bình' : 'Cần tối ưu'}`,
        color: cpm <= 25000 ? C.green : C.gold,
      });
      items.push({
        icon: '!', title: 'Lưu ý',
        body: 'Benchmark: CPMess <18K Xuất sắc | 18-25K Tốt | 25-40K Trung bình | >40K Cần tối ưu. Camp có CPMess cao nên review creative và targeting.',
        color: C.gold,
      });
      items.push({
        icon: '→', title: 'Đề xuất',
        body: '1. Scale budget cho camp có CPMess thấp nhất. 2. Pause hoặc refresh creative cho camp >40K CPMess. 3. A/B test content type A1 vs A4.',
        color: C.blue,
      });
    }

    items.forEach(item => {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const y0 = doc.y + 4;
      doc.roundedRect(this.L, y0, this.W, 52, 3).fill(C.gray5).stroke(C.gray4);
      // Narrow left accent strip instead of full-width colored header
      doc.rect(this.L, y0, 4, 52).fill(item.color);
      doc.fillColor(item.color).font(this.fontBold).fontSize(10).text(item.title, this.L + 14, y0 + 8);
      doc.fillColor(C.gray2).font(this.fontReg).fontSize(8).text(item.body, this.L + 14, y0 + 24, { width: this.W - 24 });
      doc.y = y0 + 60;
    });
  }

  private _addPageNumbers() {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      this.doc.switchToPage(range.start + i);
      const PW = this.doc.page.width;
      const PH = this.doc.page.height;
      this.doc.fillColor(C.gray3).font(this.fontReg).fontSize(7)
        .text(`VCB Studio AI  |  Trang ${i + 1}/${range.count}`, 36, PH - 20, { align: 'center', width: PW - 72 });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _n(v: any): number { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

  private _f(v: any): string {
    const x = this._n(v);
    if (x >= 1e9) return `${(x/1e9).toFixed(1)}B`;
    if (x >= 1e6) return `${(x/1e6).toFixed(1)}M`;
    if (x >= 1e3) return `${(x/1e3).toFixed(1)}K`;
    return x.toLocaleString('vi-VN');
  }

  private _delta(cur: number, prev: number): string {
    if (!prev || !cur) return '';
    const pct = ((cur - prev) / prev * 100);
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% so với tháng trước`;
  }

  private _isGlobal(team: string): boolean {
    return ['global','thái lan','thai lan','indo','japan','jp'].some(k => (team||'').toLowerCase().includes(k));
  }

  private _campType(c: any): string {
    const s = (c.camp_type || c.campaign_name || '').toLowerCase();
    if (s.includes('like page') || s.includes('likepage')) return 'Like Page';
    if (s.includes('tuong tac') || s.includes('tương tác')) return 'Tương Tác';
    if (s.includes('mess')) return 'Mess';
    return 'Khác';
  }

  private _platformNote(p: string): string {
    const notes: Record<string, string> = {
      facebook:  'Nền tảng chủ lực, traffic cao',
      tiktok:    'Viral content, ưu tiên REEL',
      instagram: 'Tiềm năng cao, tăng đầu tư REEL',
      youtube:   'Kênh dài hạn, cần SEO content',
    };
    return notes[(p||'').toLowerCase()] || '';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportData {
  type: 'ads' | 'traffic';
  year: number;
  month: number;
  // Traffic
  totalViews?: number;
  vnViews?: number;
  globalViews?: number;
  totalVideos?: number;
  prevTotalViews?: number;
  prevVnViews?: number;
  prevGlobalViews?: number;
  prevTotalVideos?: number;
  byPlatform?: any[];
  byTeam?: any[];
  topChannels?: any[];
  contentTypes?: any[];
  topSkus?: any[];
  topViews?: any[];
  topCmts?: any[];
  // Ads
  adsTeam?: any[];
  adsCamps?: any[];
}

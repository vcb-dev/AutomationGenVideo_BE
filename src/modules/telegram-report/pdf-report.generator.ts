import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { registerVietnameseFonts } from '../../common/pdf/pdf-fonts';

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  primary:   '#1E1B4B',   // deep indigo
  accent:    '#7C3AED',   // violet
  gold:      '#D97706',   // amber
  green:     '#059669',
  red:       '#DC2626',
  blue:      '#2563EB',
  teal:      '#0D9488',
  gray1:     '#111827',
  gray2:     '#374151',
  gray3:     '#6B7280',
  gray4:     '#D1D5DB',
  gray5:     '#F9FAFB',
  white:     '#FFFFFF',
  rowAlt:    '#F5F3FF',
  rowAlt2:   '#EFF6FF',
};

// ─── Main Generator ──────────────────────────────────────────────────────────
export class PdfReportGenerator {
  private doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private W: number;   // content width
  private L = 36;      // left margin
  private fontReg: string;
  private fontBold: string;

  constructor() {
    this.doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    this.W = this.doc.page.width - 72;
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));

    // Font đọc từ assets/fonts đã commit sẵn, không dò font hệ điều hành nữa: image
    // production là node:20-alpine, không có sẵn font nào nên bản cũ luôn rơi về Helvetica —
    // font 1-byte WinAnsi làm chữ có dấu trong báo cáo (tên team, tiêu đề) ra ký tự rác.
    // Thiếu file font thì ném lỗi ngay tại đây thay vì gửi báo cáo sai lên Telegram.
    const { regular, bold } = registerVietnameseFonts(this.doc);
    this.fontReg = regular;
    this.fontBold = bold;
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
    this._cover(`BAO CAO TRAFFIC\nTHANG ${month}/${year}`, C.teal);
    this.doc.addPage();

    // S1: Tong quan
    this._sectionHeader('1. TONG QUAN HIEU SUAT', C.teal);
    this._kpiGrid([
      { label: 'Tong luot xem', value: this._f(d.totalViews),     sub: this._delta(d.totalViews, d.prevTotalViews) },
      { label: 'Team Viet Nam', value: this._f(d.vnViews),         sub: this._delta(d.vnViews, d.prevVnViews) },
      { label: 'Team Global',   value: this._f(d.globalViews),     sub: this._delta(d.globalViews, d.prevGlobalViews) },
      { label: 'Tong video',    value: this._f(d.totalVideos),     sub: this._delta(d.totalVideos, d.prevTotalVideos) },
    ], C.teal);
    this.doc.moveDown(0.5);

    // S2: Platform
    this._sectionHeader('2. PHAN BO THEO NEN TANG', C.blue);
    if (d.byPlatform.length > 0) {
      this._platformTable(d.byPlatform, d.totalViews);
      this._barChart(d.byPlatform.map(r => ({ label: r.platform, value: this._n(r.views) })), C.blue);
    }
    this.doc.addPage();

    // S3: Team
    this._sectionHeader('3. TRAFFIC THEO TEAM & KHU VUC', C.accent);
    this._table(
      ['Market', 'Team', 'Platform', 'Luot xem', '% Tong', 'Videos', 'Followers'],
      [50, 100, 65, 80, 50, 55, 70],
      d.byTeam.map((r, _, arr) => {
        const tot = arr.reduce((a: number, x: any) => a + this._n(x.views), 0);
        return [
          this._isGlobal(r.team) ? 'Global' : 'Viet Nam',
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
      this._sectionHeader('4. PHAN BO THEO LOAI NOI DUNG (A1-A5)', C.gold);
      const ctMap: Record<string, {videos: number; views: number}> = {};
      for (const r of d.contentTypes) {
        if (!ctMap[r.ct]) ctMap[r.ct] = { videos: 0, views: 0 };
        ctMap[r.ct].videos += this._n(r.videos);
        ctMap[r.ct].views  += this._n(r.views);
      }
      this._table(
        ['Loai', 'So video', 'Tong views', 'View/Video'],
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
    this._sectionHeader('5. KENH NOI BAT', C.blue);
    this._table(
      ['#', 'Kenh', 'Platform', 'Team', 'Luot xem'],
      [25, 160, 60, 80, 90],
      d.topChannels.slice(0, 10).map((r, i) => [
        String(i + 1), (r.channel_name || '').slice(0, 28),
        r.platform || '', r.team || '', this._f(r.views),
      ]),
      C.blue,
    );

    // S6: Top 10 views
    this.doc.moveDown(0.5);
    this._sectionHeader('6. TOP 10 VIDEO NHIEU VIEWS NHAT', C.green);
    this._table(
      ['#', 'Title', 'Kenh', 'Team', 'Views', 'Likes', 'CMT'],
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
    this._sectionHeader('7. TOP 10 VIDEO NHIEU COMMENT NHAT', C.primary);
    this._table(
      ['#', 'Title', 'Kenh', 'Team', 'CMT', 'Views'],
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
      this._sectionHeader('8. TOP SKU NHIEU VIDEO NHAT', C.gold);
      this._table(
        ['SKU', 'So video', 'Tong views', 'Teams'],
        [60, 70, 90, 220],
        d.topSkus.slice(0, 10).map(r => [
          r.sku, String(this._n(r.videos)), this._f(r.views),
          Array.isArray(r.teams) ? r.teams.filter(Boolean).slice(0, 3).join(', ') : '',
        ]),
        C.gold,
      );
    }

    this.doc.addPage();

    // S9: Nhan xet & De xuat
    this._sectionHeader('9. NHAN XET & DE XUAT', C.accent);
    this._recommendations(d, 'traffic');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ADS REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildAds(d: ReportData) {
    const { year, month } = d;
    const BM = { great: 18000, good: 25000, avg: 40000 };
    const cpmLabel = (c: number) => c <= BM.great ? 'Xuat sac' : c <= BM.good ? 'Tot' : c <= BM.avg ? 'Trung binh' : 'Can toi uu';
    const cpmColor = (c: number) => c <= BM.great ? C.green : c <= BM.good ? C.gold : c <= BM.avg ? '#F59E0B' : C.red;

    // Cover
    this._cover(`BAO CAO QUANG CAO\nTHANG ${month}/${year}`, C.accent);
    this.doc.addPage();

    // S1: Tong quan
    this._sectionHeader('1. TONG QUAN CHI PHI QUANG CAO', C.accent);
    const ts = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.spend), 0);
    const tm = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.mess), 0);
    const tl = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.likes), 0);
    const te = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.engage), 0);
    const cpm = tm > 0 ? Math.round(ts / tm) : 0;
    const vnS = (d.adsTeam || []).filter((r: any) => !this._isGlobal(r.team)).reduce((a: number, r: any) => a + this._n(r.spend), 0);
    const glS = (d.adsTeam || []).filter((r: any) => this._isGlobal(r.team)).reduce((a: number, r: any) => a + this._n(r.spend), 0);

    this._kpiGrid([
      { label: 'Tong chi phi',   value: this._f(ts) + ' VND',  sub: `VN: ${this._f(vnS)} | GL: ${this._f(glS)}` },
      { label: 'Tin nhan (Mess)', value: this._f(tm),            sub: `CPMess: ${this._f(cpm)} VND` },
      { label: 'Like Page',      value: this._f(tl) },
      { label: 'Tuong tac',      value: this._f(te) },
    ], C.accent);

    // Benchmark box — vẽ tại vị trí y cố định, sau đó set y xuống dưới hộp
    this.doc.moveDown(0.4);
    const bColor = cpmColor(cpm);
    const bLabel = cpmLabel(cpm);
    const boxY = this.doc.y;
    const boxH = 26;
    this.doc.roundedRect(this.L, boxY, this.W, boxH, 4).fill(bColor);
    this.doc.fillColor(C.white).font(this.fontBold).fontSize(9)
      .text(
        `DANH GIA CPMESS: ${bLabel.toUpperCase()}  (${this._f(cpm)} VND)  |  Benchmark: <18K Xuat sac | 18-25K Tot | 25-40K TB | >40K Can toi uu`,
        this.L + 8, boxY + 8,
        { width: this.W - 16, align: 'center', lineBreak: false },
      );
    this.doc.y = boxY + boxH + 10;
    this.doc.fillColor(C.gray1);

    // S2: Theo thi truong
    this._sectionHeader('2. PHAN BO THEO THI TRUONG', C.blue);
    const mktData: Record<string, {sp: number; ms: number; ims: number}> = {
      'Viet Nam': {sp:0, ms:0, ims:0}, 'Global': {sp:0, ms:0, ims:0},
    };
    for (const r of (d.adsTeam || [])) {
      const mk = this._isGlobal(r.team) ? 'Global' : 'Viet Nam';
      mktData[mk].sp  += this._n(r.spend);
      mktData[mk].ms  += this._n(r.mess);
      mktData[mk].ims += this._n(r.impr);
    }
    this._table(
      ['Thi truong', 'Chi phi (VND)', 'Mess', 'Hien thi', 'CPMess', '% Chi phi', 'Danh gia'],
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
      { label: 'Viet Nam', value: mktData['Viet Nam'].sp },
      { label: 'Global',   value: mktData['Global'].sp },
    ], C.blue);

    this.doc.addPage();

    // S3: Theo loai camp
    this._sectionHeader('3. PHAN TICH THEO LOAI CHIEN DICH', C.gold);
    const ctSpend: Record<string, {sp:number; ms:number; camps:number}> = {};
    for (const c of (d.adsCamps || [])) {
      const ct = this._campType(c);
      if (!ctSpend[ct]) ctSpend[ct] = {sp:0, ms:0, camps:0};
      ctSpend[ct].sp += this._n(c.spend);
      ctSpend[ct].ms += this._n(c.mess);
      ctSpend[ct].camps++;
    }
    this._table(
      ['Loai camp', 'So campaign', 'Chi phi', 'Tin nhan', 'CPMess', 'Danh gia'],
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

    // S4: Chi tiet team
    this._sectionHeader('4. CHI TIET THEO TEAM', C.primary);
    this._table(
      ['Market', 'Team', 'Chi phi', 'Mess', 'Hien thi', 'CPMess', 'Danh gia'],
      [55, 95, 90, 55, 65, 65, 90],
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

    // S5: Nhan xet
    this._sectionHeader('5. NHAN XET & DE XUAT', C.accent);
    this._recommendations(d, 'ads');
  }

  // ─── Drawing Primitives ───────────────────────────────────────────────────

  private _cover(title: string, color: string) {
    const doc = this.doc;
    const PW = doc.page.width;
    const PH = doc.page.height;

    // Background gradient (solid approximation)
    doc.rect(0, 0, PW, PH).fill('#F8F7FF');
    doc.rect(0, 0, PW, PH * 0.45).fill(color);

    // Logo area
    const logoPath = path.join(__dirname, '..', '..', '..', '..', 'public', 'images', 'ai-avatar.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, PW / 2 - 40, 60, { width: 80, height: 80 });
    }

    // Title
    doc.fillColor(C.white).font(this.fontBold).fontSize(24)
      .text(title, 60, fs.existsSync(logoPath) ? 160 : 120, { align: 'center', width: PW - 120 });

    // Divider
    const dY = PH * 0.45 + 30;
    doc.moveTo(60, dY).lineTo(PW - 60, dY).lineWidth(1).strokeColor(color).stroke();

    // Company name
    doc.fillColor(color).font(this.fontBold).fontSize(14)
      .text('VCB STUDIO', 60, dY + 20, { align: 'center', width: PW - 120 });

    // Generated date
    doc.fillColor(C.gray3).font(this.fontReg).fontSize(10)
      .text(`Generated: ${new Date().toLocaleString('vi-VN')}`, 60, dY + 50, { align: 'center', width: PW - 120 });

    // Bottom info box
    doc.roundedRect(60, PH - 100, PW - 120, 60, 6).fill(color);
    doc.fillColor(C.white).font(this.fontReg).fontSize(8)
      .text('Bao cao nay duoc tao tu dong boi VCB Studio AI.\nDu lieu lay tu database VCB Studio.', 80, PH - 85, { align: 'center', width: PW - 160 });
  }

  private _sectionHeader(title: string, color: string) {
    const doc = this.doc;
    if (doc.y > doc.page.height - 120) { doc.addPage(); }
    const y = doc.y + 4;
    doc.rect(this.L, y, this.W, 22).fill(color);
    doc.fillColor(C.white).font(this.fontBold).fontSize(10)
      .text(title, this.L + 8, y + 5, { width: this.W - 16 });
    doc.fillColor(C.gray1).moveDown(0.4);
  }

  private _kpiGrid(items: {label: string; value: string; sub?: string}[], color: string) {
    const doc = this.doc;
    const cw = this.W / items.length;
    const y0 = doc.y;
    items.forEach(({ label, value, sub }, i) => {
      const x = this.L + i * cw;
      doc.roundedRect(x, y0, cw - 6, 52, 4).fill(C.gray5).stroke(C.gray4);
      // Colored top bar
      doc.rect(x, y0, cw - 6, 4).fill(color);
      doc.fillColor(color).font(this.fontBold).fontSize(14)
        .text(value, x + 4, y0 + 10, { width: cw - 14, align: 'center' });
      doc.fillColor(C.gray3).font(this.fontReg).fontSize(7)
        .text(label, x + 4, y0 + 28, { width: cw - 14, align: 'center' });
      if (sub) {
        const isNeg = sub.includes('Giam') || sub.includes('-');
        const isPos = sub.includes('Tang') || sub.includes('+');
        doc.fillColor(isPos ? C.green : isNeg ? C.red : C.gray3).fontSize(6.5)
          .text(sub, x + 4, y0 + 40, { width: cw - 14, align: 'center' });
      }
    });
    doc.y = y0 + 60;
  }

  private _table(headers: string[], widths: number[], rows: string[][], hColor: string) {
    const doc = this.doc;
    const totalW = widths.reduce((a, b) => a + b, 0);

    // Header
    let y = doc.y + 4;
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    doc.rect(this.L, y, totalW, 18).fill(hColor);
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
        // Color code evaluation cells
        const txt = String(cell);
        let fc = C.gray1;
        if (txt === 'Xuat sac') fc = C.green;
        else if (txt === 'Tot') fc = '#15803D';
        else if (txt === 'Trung binh') fc = C.gold;
        else if (txt === 'Can toi uu') fc = C.red;
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
      ['Nen tang', 'Luot xem', 'Ty trong', 'So video', 'Nhan xet'],
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

    // Axis
    doc.moveTo(this.L, y0).lineTo(this.L, baseY).lineWidth(1).strokeColor(C.gray4).stroke();
    doc.moveTo(this.L, baseY).lineTo(this.L + chartW, baseY).lineWidth(1).stroke();

    // Bars
    items.forEach((item, i) => {
      const bH = Math.max(2, (item.value / maxVal) * chartH);
      const bX = this.L + 10 + i * (barW + 8);
      const bY = baseY - bH;

      // Bar with slight gradient effect
      doc.rect(bX, bY, barW, bH).fill(color);
      doc.rect(bX, bY, barW, Math.min(4, bH)).fillOpacity(0.3).fill(C.white).fillOpacity(1);

      // Value label on top
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
        icon: '✓', title: 'Diem manh',
        body: `Tong luot xem ${this._f(total)}. Global chiem ${glPct.toFixed(1)}% tong traffic.`,
        color: C.green,
      });
      if (d.contentTypes.length > 0) {
        const ctMap: Record<string, number> = {};
        for (const r of d.contentTypes) ctMap[r.ct] = (ctMap[r.ct]||0) + this._n(r.views);
        const topCt = Object.entries(ctMap).sort(([,a],[,b])=>b-a)[0];
        items.push({
          icon: '★', title: 'Content hieu qua nhat',
          body: `${topCt?.[0] || 'A1'} dang co view cao nhat. Nen tang uu tien san xuat loai nay.`,
          color: C.gold,
        });
      }
      items.push({
        icon: '→', title: 'De xuat thang toi',
        body: '1. Duy tri momentum Facebook. 2. Tang REELs Global. 3. Phan tich A1-A5 de optimize content mix. 4. Theo doi kenh co view/video cao de scale.',
        color: C.blue,
      });
    } else {
      const ts = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.spend), 0);
      const tm = (d.adsTeam || []).reduce((a: number, r: any) => a + this._n(r.mess), 0);
      const cpm = tm > 0 ? Math.round(ts / tm) : 0;
      items.push({
        icon: '✓', title: 'Ket qua',
        body: `Tong chi phi ${this._f(ts)} VND, CPMess ${this._f(cpm)} VND — ${cpm <= 18000 ? 'Xuat sac' : cpm <= 25000 ? 'Tot' : cpm <= 40000 ? 'Trung binh' : 'Can toi uu'}`,
        color: cpm <= 25000 ? C.green : C.gold,
      });
      items.push({
        icon: '!', title: 'Luu y',
        body: 'Benchmark: CPMess <18K Xuat sac | 18-25K Tot | 25-40K Trung binh | >40K Can toi uu. Camp co CPMess cao nen review creative va targeting.',
        color: C.gold,
      });
      items.push({
        icon: '→', title: 'De xuat',
        body: '1. Scale budget cho camp co CPMess thap nhat. 2. Pause hoac refresh creative cho camp >40K CPMess. 3. A/B test content type A1 vs A4.',
        color: C.blue,
      });
    }

    items.forEach(item => {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const y0 = doc.y + 4;
      doc.roundedRect(this.L, y0, this.W, 52, 4).fill(C.gray5).stroke(C.gray4);
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
    return `${sign}${pct.toFixed(1)}% so thang truoc`;
  }

  private _isGlobal(team: string): boolean {
    return ['global','thái lan','thai lan','indo','japan','jp'].some(k => (team||'').toLowerCase().includes(k));
  }

  private _campType(c: any): string {
    const s = (c.camp_type || c.campaign_name || '').toLowerCase();
    if (s.includes('like page') || s.includes('likepage')) return 'Like Page';
    if (s.includes('tuong tac') || s.includes('tương tác')) return 'Tuong Tac';
    if (s.includes('mess')) return 'Mess';
    return 'Khac';
  }

  private _platformNote(p: string): string {
    const notes: Record<string, string> = {
      facebook:  'Nen tang chu luc, traffic cao',
      tiktok:    'Viral content, uu tien REEL',
      instagram: 'Tiem nang cao, tang dau tu REEL',
      youtube:   'Kenh dai han, can SEO content',
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

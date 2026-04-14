import fs from 'fs';

const path = 'src/modules/lark-sync/lark.service.ts';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');

const cp1252ToUnicode = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E,
    0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
    0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
    0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
    0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
    0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

const unicodeToCp1252 = {};
for (const [byte, unicode] of Object.entries(cp1252ToUnicode)) {
    unicodeToCp1252[unicode] = Number(byte);
}

function fixDoubleEncoding(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code <= 0xFF) {
            bytes.push(code);
        } else if (unicodeToCp1252[code] !== undefined) {
            bytes.push(unicodeToCp1252[code]);
        } else {
            const ch = str[i];
            const chBuf = Buffer.from(ch, 'utf8');
            for (const b of chBuf) bytes.push(b);
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

const fixed = fixDoubleEncoding(text);

// Verify
console.log('Has ĐÚNG HẠN:', fixed.includes('ĐÚNG HẠN'));
console.log('Has CHƯA BÁO CÁO:', fixed.includes('CHƯA BÁO CÁO'));
console.log('Has Tên kênh hiện tại:', fixed.includes('Tên kênh hiện tại'));
console.log('Has Khác:', fixed.includes("'Khác'"));
console.log('Has Chưa báo cáo:', fixed.includes("'Chưa báo cáo'"));
console.log('Has Đang hoạt động:', fixed.includes('Đang hoạt động'));
console.log('Has garbled ÄÃš:', fixed.includes('ÄÃš'));
console.log('Has garbled ChÆ°:', fixed.includes('ChÆ°'));
console.log('Has class LarkService:', fixed.includes('class LarkService'));

const idx = fixed.indexOf('reportStatus');
if (idx > 0) console.log('\nFixed reportStatus:', fixed.substring(idx, idx + 80));

const allGood = fixed.includes('ĐÚNG HẠN') && fixed.includes('CHƯA BÁO CÁO') && !fixed.includes('ÄÃš') && fixed.includes('class LarkService');

if (allGood) {
    // Strip BOM if present
    const clean = fixed.replace(/^\uFEFF/, '');
    fs.writeFileSync(path, clean, 'utf8');
    console.log('\n✅ File fixed and saved successfully!');
    console.log('File size:', Buffer.byteLength(clean, 'utf8'), 'bytes');
} else {
    console.log('\n❌ Fix verification failed - NOT saving.');
}

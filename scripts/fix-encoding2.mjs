import fs from 'fs';

const path = 'src/modules/lark-sync/lark.service.ts';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');

// Find the reportStatus area and show hex bytes
const searchStr = 'reportStatus';
const byteIdx = buf.indexOf(Buffer.from(searchStr, 'utf8'));
if (byteIdx > 0) {
    const slice = buf.slice(byteIdx, byteIdx + 100);
    console.log('Hex around reportStatus:');
    console.log(Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('As UTF8:', slice.toString('utf8'));
    console.log('As Latin1:', slice.toString('latin1'));
}

// Let's try: read bytes, for sequences that look like double-encoded UTF-8,
// fix them by converting the multi-byte UTF-8 chars back to single bytes
console.log('\n--- Trying manual fix ---');

// Read as latin1 to get raw bytes as char codes
const raw = buf.toString('latin1');

// Find reportStatus in raw
const rawIdx = raw.indexOf('reportStatus');
if (rawIdx > 0) {
    const snippet = raw.substring(rawIdx, rawIdx + 100);
    console.log('Raw Latin1 codes:');
    for (let i = 0; i < Math.min(snippet.length, 60); i++) {
        process.stdout.write(snippet.charCodeAt(i).toString(16).padStart(2, '0') + ' ');
    }
    console.log();
    
    // Try decoding the raw bytes as UTF8
    const rawBuf = Buffer.from(snippet, 'latin1');
    const asUtf8 = rawBuf.toString('utf8');
    console.log('Re-decoded as UTF8:', asUtf8);
}

// Count how many non-ASCII chars are in the file
let nonAscii = 0;
for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 127) nonAscii++;
}
console.log('\nTotal non-ASCII bytes:', nonAscii);
console.log('File size:', buf.length);

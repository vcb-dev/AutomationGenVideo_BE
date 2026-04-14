import fs from 'fs';

const path = 'src/modules/lark-sync/lark.service.ts';
const buf = fs.readFileSync(path);

// Decode as UTF-8 (gives the garbled double-encoded text)
const garbled = buf.toString('utf8');

// Re-encode to Latin-1 bytes (reverses the second UTF-8 encoding)
const latin1Buf = Buffer.from(garbled, 'latin1');

// Decode those bytes as UTF-8 (gets original Vietnamese text)
const fixed = latin1Buf.toString('utf8');

// Verify
const hasCorrect = fixed.includes('ĐÚNG HẠN');
const hasGarbled = fixed.includes('ÄÃšNG');
console.log('Has correct ĐÚNG HẠN:', hasCorrect);
console.log('Still has garbled:', hasGarbled);

// Show the fixed reportStatus line
const idx = fixed.indexOf('reportStatus');
if (idx > 0) console.log('Fixed reportStatus:', fixed.substring(idx, idx + 80));

// Show a Lark field name to verify
const idx2 = fixed.indexOf('Tên kênh hiện tại');
console.log('Has correct Lark field name:', idx2 > 0);

if (hasCorrect && !hasGarbled) {
    fs.writeFileSync(path, fixed, 'utf8');
    console.log('\nFile fixed and saved!');
} else {
    console.log('\nFix verification failed - NOT saving.');
    console.log('Attempting alternative fix...');
    
    // Try character-by-character repair
    let result = '';
    for (let i = 0; i < garbled.length; i++) {
        const code = garbled.charCodeAt(i);
        if (code > 127 && code < 256) {
            result += String.fromCharCode(code);
        } else {
            result += garbled[i];
        }
    }
    console.log('Alternative check:', result.includes('ĐÚNG HẠN'));
}

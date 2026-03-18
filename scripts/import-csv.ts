import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';

const prisma = new PrismaClient();

// Parse CSV manually (handles quoted fields with commas)
function parseCSV(content: string): any[] {
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim());

    const records: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                if (inQuotes && line[j + 1] === '"') {
                    current += '"';
                    j++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());

        const record: any = {};
        headers.forEach((h, idx) => {
            record[h] = values[idx] || '';
        });
        records.push(record);
    }
    return records;
}

function mapRoles(larkRole: string): string[] {
    const role = larkRole.toLowerCase().trim();
    if (role === 'admin') return ['ADMIN'];
    if (role === 'leader') return ['LEADER_VIDEO', 'LEADER_CONTENT'];
    if (role === 'member' || role === '') return ['EDITOR', 'CONTENT'];
    return ['CONTENT'];
}

function parsePermissions(raw: string): any | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function main() {
    console.log('🚀 Importing CSV from Lark Base → DB...\n');

    const csvPath = 'c:\\Users\\pc\\Downloads\\VCB - HR Secure_PHAN_QUYEN.csv';
    const content = fs.readFileSync(csvPath, 'utf-8');
    const records = parseCSV(content);

    console.log(`📊 Found ${records.length} records in CSV\n`);

    let created = 0, updated = 0, skipped = 0;

    for (const rec of records) {
        const email = rec['Email']?.toLowerCase().trim();
        if (!email) { skipped++; continue; }

        const fullName = rec['HoTen']?.trim() || rec['Nhân viên']?.trim() || email.split('@')[0];
        const larkRole = rec['Role']?.trim() || 'Member';
        const team = rec['Team']?.trim() || null;
        const status = rec['Trang Thai']?.trim() || 'ON';
        const permissions = parsePermissions(rec['Permissions']);

        const roles = mapRoles(larkRole);
        const isActive = status.toUpperCase() === 'ON';

        try {
            const existing = await prisma.user.findUnique({ where: { email } });

            if (existing) {
                await prisma.user.update({
                    where: { email },
                    data: {
                        full_name: fullName,
                        roles: roles as any[],
                        team: team,
                        lark_permissions: permissions,
                        is_active: isActive,
                    },
                });
                updated++;
                console.log(`📝 Updated: ${email.padEnd(40)} | [${roles.join(', ')}] | Team: ${team || '-'}`);
            } else {
                const hash = await bcrypt.hash('VCB@2024', 10);
                await prisma.user.create({
                    data: {
                        email,
                        password_hash: hash,
                        full_name: fullName,
                        roles: roles as any[],
                        team: team,
                        lark_permissions: permissions,
                        is_active: isActive,
                    },
                });
                created++;
                console.log(`✅ Created: ${email.padEnd(40)} | [${roles.join(', ')}] | Team: ${team || '-'}`);
            }
        } catch (err: any) {
            console.log(`❌ Error (${email}): ${err.message}`);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🏁 Import complete!`);
    console.log(`   📊 Total CSV records: ${records.length}`);
    console.log(`   ✅ Created: ${created}`);
    console.log(`   📝 Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   🔑 Default password for new users: VCB@2024`);
}

main()
    .catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());

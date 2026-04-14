import { PrismaClient } from '@prisma/client';

const SERVER_URL = 'postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public&connection_limit=10';
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/video_production?schema=public';

const server = new PrismaClient({ datasources: { db: { url: SERVER_URL } } });
const local = new PrismaClient({ datasources: { db: { url: LOCAL_URL } } });

const CHUNK = 400;

async function syncTable(name, serverDelegate, localDelegate) {
    console.log(`\n[${name}] Fetching from server...`);
    const rows = await serverDelegate.findMany();
    console.log(`[${name}] Got ${rows.length} rows. Replacing local...`);

    await localDelegate.deleteMany({});
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await localDelegate.createMany({ data: chunk, skipDuplicates: true });
        written += chunk.length;
        process.stdout.write(`\r[${name}] ${written}/${rows.length}`);
    }
    console.log(`\n[${name}] Done: ${written} rows restored.`);
    return written;
}

async function syncUsers() {
    console.log('\n[users] Fetching from server...');
    const rows = await server.user.findMany();
    console.log(`[users] Got ${rows.length} rows. Upserting to local...`);

    let count = 0;
    for (const u of rows) {
        await local.user.upsert({
            where: { id: u.id },
            update: {
                email: u.email, password_hash: u.password_hash, full_name: u.full_name,
                google_id: u.google_id, is_active: u.is_active, custom_permissions: u.custom_permissions,
                lark_permissions: u.lark_permissions, last_app_update_at: u.last_app_update_at,
                roles: u.roles, team: u.team, lark_employee_record_id: u.lark_employee_record_id,
                employee_id: u.employee_id, image_url: u.image_url, employee_data: u.employee_data,
                employee_position: u.employee_position, employee_status: u.employee_status,
                employee_date: u.employee_date,
            },
            create: {
                id: u.id, email: u.email, password_hash: u.password_hash, full_name: u.full_name,
                google_id: u.google_id, is_active: u.is_active, custom_permissions: u.custom_permissions,
                lark_permissions: u.lark_permissions, last_app_update_at: u.last_app_update_at,
                roles: u.roles, team: u.team, lark_employee_record_id: u.lark_employee_record_id,
                employee_id: u.employee_id, image_url: u.image_url, employee_data: u.employee_data,
                employee_position: u.employee_position, employee_status: u.employee_status,
                employee_date: u.employee_date,
            },
        });
        count++;
        if (count % 50 === 0) process.stdout.write(`\r[users] ${count}/${rows.length}`);
    }
    console.log(`\n[users] Done: ${count} rows restored.`);
    return count;
}

async function main() {
    console.log('=== Restoring local DB from server DB ===\n');

    const results = {};
    results.users = await syncUsers();
    results.channels = await syncTable('channels', server.channel, local.channel);
    results.larkKPI = await syncTable('lark_kpi', server.larkKPI, local.larkKPI);

    try {
        const serverDoDa = server.larkKpiDoDa || (server).larkKpiDoDa;
        const localDoDa = local.larkKpiDoDa || (local).larkKpiDoDa;
        if (serverDoDa && localDoDa) {
            results.larkKpiDoDa = await syncTable('lark_kpi_do_da', serverDoDa, localDoDa);
        }
    } catch (e) {
        console.log('[lark_kpi_do_da] Skipped:', e.message);
    }

    console.log('\n=== RESTORE COMPLETE ===');
    console.log(results);
}

main().finally(async () => {
    await server.$disconnect().catch(() => {});
    await local.$disconnect().catch(() => {});
});

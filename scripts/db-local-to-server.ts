import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function localToServerSync() {
    const local = new PrismaClient();

    const serverUrl = process.env.SERVER_DATABASE_URL;
    if (!serverUrl) {
        console.error('❌ Missing SERVER_DATABASE_URL in .env');
        process.exit(1);
    }

    const remote = new PrismaClient({
        datasources: {
            db: { url: serverUrl },
        },
    });

    try {
        console.log('🔗 Connected to Local and Remote DBs...');

        // 1. Fetch Local Data
        console.log('📥 Fetching Local Kpi data...');
        const localKpi = await local.kpi.findMany();
        const localDoDa = await local.kpiDoDaEditor.findMany();
        console.log(`✅ Found ${localKpi.length} Kpi and ${localDoDa.length} DoDa records locally.`);

        // 2. Clear Remote Data (OVERWRITE mode)
        console.log('🗑️  CLEANING Remote DB Server (Deleting all Kpi records)...');
        await remote.kpi.deleteMany({});
        await remote.kpiDoDaEditor.deleteMany({});
        console.log('✅ Remote DB cleaned.');

        // 3. Insert into Remote (Chunking to avoid payload limits)
        console.log('🚀 Uploading Local data to Server...');

        const chunkSize = 100;

        // Sync main Kpi
        for (let i = 0; i < localKpi.length; i += chunkSize) {
            const chunk = localKpi.slice(i, i + chunkSize);
            await remote.kpi.createMany({
                data: chunk as any,
                skipDuplicates: true,
            });
            console.log(`📡 Uploaded Kpi: ${i + chunk.length}/${localKpi.length}`);
        }

        // Sync DoDa KPI
        for (let i = 0; i < localDoDa.length; i += chunkSize) {
            const chunk = localDoDa.slice(i, i + chunkSize);
            await remote.kpiDoDaEditor.createMany({
                data: chunk as any,
                skipDuplicates: true,
            });
            console.log(`📡 Uploaded DoDa KPI: ${i + chunk.length}/${localDoDa.length}`);
        }

        console.log('✨ SUCCESS: Server DB Kpi has been overwritten with Local data!');

    } catch (error) {
        console.error('❌ SYNC FAILED:', error);
    } finally {
        await local.$disconnect();
        await remote.$disconnect();
    }
}

localToServerSync();

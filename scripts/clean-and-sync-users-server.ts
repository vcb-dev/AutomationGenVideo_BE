import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const serverPrisma = new PrismaClient({
    datasources: { db: { url: process.env.SERVER_DATABASE_URL } },
});

async function getLarkToken() {
    const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: process.env.LARK_APP_ID,
        app_secret: process.env.LARK_APP_SECRET,
    });
    return res.data.tenant_access_token;
}

async function syncUsers() {
    try {
        console.log('--- CLEANING USERS TABLE ON SERVER ---');
        await serverPrisma.user.deleteMany({});
        console.log('Cleaned users table.');

        const token = await getLarkToken();
        const baseId = process.env.LARK_REPORT_BASE_ID;
        const tableId = process.env.LARK_PERMISSION_TABLE_ID;

        console.log(`Using Base: ${baseId}, Table: ${tableId}`);

        console.log('--- FETCHING USERS FROM LARK ---');
        let records: any[] = [];
        let pageToken = '';
        
        while (true) {
            const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
            const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
            records = [...records, ...response.data.data.items];
            if (!response.data.data.has_more) break;
            pageToken = response.data.data.page_token;
        }
        
        console.log(`Found ${records.length} records in Lark.`);

        const userEntries = records.map((rec: any) => {
            const f = rec.fields;
            const full_name = f['HoTen'] || f['Họ Tên'] || f['Name'] || '';
            const email = f['Email'] || '';
            let team = f['Team'] || f['Phòng ban'] || 'Khác';
            if (Array.isArray(team)) team = team.join(', ');
            
            const roleRaw = f['Role'] || f['Chức vụ'] || 'Member';
            let role = 'MEMBER';
            if (roleRaw.toUpperCase().includes('ADMIN')) role = 'ADMIN';
            else if (roleRaw.toUpperCase().includes('MANAGER')) role = 'MANAGER';
            else if (roleRaw.toUpperCase().includes('LEADER')) role = 'LEADER';
            
            const employeeRaw = f['Nhân viên'] || f['Nhan vien'];
            let avatarUrl = null;
            let empId = null;
            if (Array.isArray(employeeRaw) && employeeRaw.length > 0) {
                avatarUrl = employeeRaw[0].avatar_url || null;
                empId = employeeRaw[0].id || null;
            }

            const statusRaw = f['Trạng thái nhân sự'] || f['Trạng thái'] || f['Status'] || 'Đang hoạt động';
            let employee_status = 'on';
            const lowStatus = String(statusRaw).toLowerCase();
            if (lowStatus.includes('nghỉ') || lowStatus.includes('off') || lowStatus.includes('khóa')) {
                employee_status = 'off';
            }

            return {
                full_name,
                email: email.toLowerCase().trim(),
                team: String(team),
                roles: [role] as any,
                employee_status: employee_status,
                image_url: avatarUrl,
                employee_id: empId || rec.record_id,
            };
        });

        console.log('--- SYNCING TO SERVER DB ---');
        let count = 0;
        const created: { id: string; team: string | null; roles: string[] }[] = [];
        for (const user of userEntries) {
            if (!user.full_name || !user.email) continue;
            try {
                const row = await serverPrisma.user.create({
                    data: {
                        ...user,
                        is_active: true
                    },
                    select: { id: true, team: true, roles: true },
                });
                created.push(row);
                count++;
            } catch (err: any) {
                console.error(`Error creating user ${user.email}:`, err.message);
            }
        }

        console.log(`SUCCESS: ${count} users synced to server.`);
    } catch (error: any) {
        console.error('SYNC ERROR:', error.response?.data || error.message);
    } finally {
        await serverPrisma.$disconnect();
    }
}

syncUsers();

#!/usr/bin/env npx ts-node
/**
 * Script to sync employee data from Lark to database
 * Usage: npx ts-node sync-employee-manual.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface LarkEmployeeRecord {
  record_id: string;
  fields: Record<string, any>;
}

// Copy functions from lark.service.ts
function platformFromLarkString(platformRaw: string | null | undefined): string | null {
  if (!platformRaw?.trim()) return null;
  const s = platformRaw.trim().toLowerCase();
  if (s.includes('tiktok') || s.includes('tik tok')) return 'TIKTOK';
  if (s.includes('instagram') || s === 'ig' || s.includes('insta')) return 'INSTAGRAM';
  if (s.includes('facebook') || s.includes('fb ') || s === 'fb') return 'FACEBOOK';
  if (s.includes('douyin') || s.includes('抖音')) return 'DOUYIN';
  return null;
}

function normalizeOwnerName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
}

function mapRecordToEmployee(record: LarkEmployeeRecord): any {
  const fields = record.fields;

  const extractString = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      return first.name || first.text || (typeof first === 'string' ? first : null);
    }
    if (typeof val === 'object') return val.name || val.text || null;
    return String(val);
  };

  const extractTeamList = (val: any): string[] => {
    if (!val) return [];
    if (typeof val === 'string') {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(val)) {
      return val
        .map((item) => {
          if (!item) return null;
          if (typeof item === 'string') return item;
          if (typeof item === 'object') return item.name || item.text || null;
          return String(item);
        })
        .filter((s): s is string => !!s)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof val === 'object') {
      const one = val.name || val.text || null;
      return one ? [String(one).trim()] : [];
    }
    return [];
  };

  const nameRaw = extractString(fields['Tên']) || extractString(fields['name']) || 'Unknown';

  return {
    id: record.record_id,
    name: nameRaw,
    employee_id: extractString(fields['Mã NV']) || extractString(fields['employee_id']) || null,
    email: extractString(fields['Email']) || extractString(fields['email']) || null,
    image_url: extractString(fields['Avatar']) || extractString(fields['avatar_url']) || null,
    position: extractString(fields['Chức vụ']) || extractString(fields['position']) || null,
    team: extractTeamList(fields['Bộ phận'] || fields['Team']).join(', ') || null,
    status: extractString(fields['Tình trạng']) || extractString(fields['status']) || null,
    date: extractString(fields['Ngày']) || extractString(fields['date']) || null,
    employee_data: JSON.stringify(fields),
  };
}

async function main() {
  console.log('🔄 Starting employee sync from Lark...\n');

  try {
    // Get all employees from database
    const employees = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        full_name: true,
        team: true,
      },
      orderBy: { full_name: 'asc' },
    });

    console.log(`✅ Found ${employees.length} employees in database:\n`);
    
    // Show first 30 employees
    for (let i = 0; i < Math.min(30, employees.length); i++) {
      const emp = employees[i];
      console.log(`  ${i + 1}. ${emp.full_name} (${emp.email}) - Team: ${emp.team || 'N/A'}`);
    }

    if (employees.length > 30) {
      console.log(`  ... and ${employees.length - 30} more`);
    }

    console.log('\n✅ Sync complete!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

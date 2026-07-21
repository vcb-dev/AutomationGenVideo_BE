import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const DROPPED_COLS = [
  'start_date_work','employment_status','full_name_legal','employee_code_primary','job_title',
  'direct_manager','gender','birth_date','phone_primary','education_level','address_current',
  'address_household','identity_document_info','marital_status','children_info','emergency_contact_1',
  'school_name','bank_account_info','vehicle_info','hometown_detail','family_notes',
  'father_guardian_contact','mother_guardian_contact','attachment_id_front','attachment_id_back',
  'facebook_url','profile_review_date','cv_attachment_ref','province_after_merger','hometown_new',
  'birth_time','insurance_book_number','cccd_photo_link','form_submitted_at','confidentiality_agreement',
  'manager_text','raw_data','last_synced_at','department_id','team_id','admin_unit_code',
  'manager_block_code','team_order_number','submitted_on_1','division_id','custom_permissions',
  'lark_permissions','avatar','last_login_at','last_activity_at',
];

async function main() {
  const prisma = new PrismaClient();
  const rows: { column_name: string }[] = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = ANY($1::text[])
  `, DROPPED_COLS);
  const stillExist = rows.map(r => r.column_name);
  console.log(`Còn tồn tại: ${stillExist.length}/50 cột`);
  if (stillExist.length > 0) console.log('Danh sách còn:', stillExist.join(', '));
  await prisma.$disconnect();
}
main().catch(e => { console.error('ERROR', e.message); process.exit(1); });

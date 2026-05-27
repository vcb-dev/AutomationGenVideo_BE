-- Tạo / cập nhật tài khoản admin@vcb.vn
-- Chạy trực tiếp trên Supabase SQL Editor: https://supabase.com/dashboard/project/ivbwkywststgweeujsjp/sql
-- Password: khaiem2k4

INSERT INTO "User" (
  id,
  email,
  password_hash,
  full_name,
  roles,
  is_active,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  'admin@vcb.vn',
  '$2b$10$a8QVEzaYjZDn/.XpkV7ljOy1QjNgNUy6heqOsAypYUFR3/Qx/L0ai',
  'Admin VCB',
  ARRAY['ADMIN']::"UserRole"[],
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = '$2b$10$a8QVEzaYjZDn/.XpkV7ljOy1QjNgNUy6heqOsAypYUFR3/Qx/L0ai',
  roles         = ARRAY['ADMIN']::"UserRole"[],
  is_active     = true,
  full_name     = 'Admin VCB',
  updated_at    = NOW();

-- Kiểm tra kết quả
SELECT id, email, full_name, roles, is_active, created_at
FROM "User"
WHERE email = 'admin@vcb.vn';

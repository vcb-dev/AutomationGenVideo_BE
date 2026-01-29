-- Create new EDITOR users with manager assigned
-- Manager ID: 38711093-5494-4b55-bf79-1364092dc04c (manager@vietchibao.com)

-- Example: Create 2 editors
INSERT INTO users (id, email, password_hash, full_name, role, manager_id, is_active, created_at, updated_at)
VALUES 
  (
    gen_random_uuid(),
    'editor1@vietchibao.com',
    '$2b$10$YourHashedPasswordHere', -- You need to hash the password
    'Editor Một',
    'EDITOR',
    '38711093-5494-4b55-bf79-1364092dc04c',
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'editor2@vietchibao.com',
    '$2b$10$YourHashedPasswordHere', -- You need to hash the password
    'Editor Hai',
    'EDITOR',
    '38711093-5494-4b55-bf79-1364092dc04c',
    true,
    NOW(),
    NOW()
  );

-- Verify
SELECT id, email, full_name, role, manager_id FROM users WHERE role = 'EDITOR';

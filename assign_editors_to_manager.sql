-- First, check all users and their roles
SELECT id, email, full_name, role, manager_id FROM users ORDER BY role, email;

-- Update existing EDITOR users to have this manager
-- Replace 'editor@example.com' with actual editor emails you want to assign
UPDATE users 
SET manager_id = '38711093-5494-4b55-bf79-1364092dc04c'
WHERE role = 'EDITOR' 
  AND manager_id IS NULL;

-- Or update specific editors by email:
-- UPDATE users 
-- SET manager_id = '38711093-5494-4b55-bf79-1364092dc04c'
-- WHERE email IN ('editor1@example.com', 'editor2@example.com');

-- Verify the update
SELECT 
    e.email as editor_email,
    e.full_name as editor_name,
    e.manager_id,
    m.email as manager_email,
    COUNT(tc.id) as channel_count
FROM users e
LEFT JOIN users m ON e.manager_id = m.id
LEFT JOIN tracked_channels tc ON tc.user_id = e.id
WHERE e.role = 'EDITOR'
GROUP BY e.id, e.email, e.full_name, e.manager_id, m.email;

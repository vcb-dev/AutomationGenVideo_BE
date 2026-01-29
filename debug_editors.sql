-- Check current user and their role
SELECT id, email, full_name, role, manager_id 
FROM users 
WHERE email = 'manager@example.com' OR role = 'MANAGER';

-- Check all editors and their managers
SELECT id, email, full_name, role, manager_id 
FROM users 
WHERE role = 'EDITOR';

-- Check tracked channels and their owners
SELECT 
    tc.id,
    tc.platform,
    tc.username,
    tc.total_videos,
    u.email as owner_email,
    u.role as owner_role,
    u.manager_id
FROM tracked_channels tc
JOIN users u ON tc.user_id = u.id
ORDER BY u.email;

-- Check if any editor has a manager
SELECT 
    e.email as editor_email,
    e.full_name as editor_name,
    m.email as manager_email,
    m.full_name as manager_name,
    COUNT(tc.id) as channel_count
FROM users e
LEFT JOIN users m ON e.manager_id = m.id
LEFT JOIN tracked_channels tc ON tc.user_id = e.id
WHERE e.role = 'EDITOR'
GROUP BY e.id, e.email, e.full_name, m.email, m.full_name;

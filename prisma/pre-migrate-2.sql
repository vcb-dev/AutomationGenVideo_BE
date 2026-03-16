-- Bước 2: Map các role cũ sang role mới (MEMBER đã tồn tại trong enum sau bước 1)
-- EDITOR, CONTENT → MEMBER | LEADER_VIDEO, LEADER_CONTENT, LEADER → MANAGER
UPDATE "users"
SET "roles" = ARRAY(
  SELECT CASE elem::text
    WHEN 'EDITOR'         THEN 'MEMBER'::"UserRole"
    WHEN 'CONTENT'        THEN 'MEMBER'::"UserRole"
    WHEN 'LEADER_VIDEO'   THEN 'MANAGER'::"UserRole"
    WHEN 'LEADER_CONTENT' THEN 'MANAGER'::"UserRole"
    WHEN 'LEADER'         THEN 'MANAGER'::"UserRole"
    ELSE elem
  END
  FROM unnest("roles") elem
)
WHERE "roles" IS NOT NULL
  AND ("roles")::text[] && ARRAY['EDITOR','CONTENT','LEADER_VIDEO','LEADER_CONTENT','LEADER'];

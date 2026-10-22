-- Team = dự án bên HRM, thành viên = content/editor của dự án đó. Lưu id phía HRM để đổi tên dự án
-- hay đổi email nhân sự vẫn khớp đúng team/tài khoản cũ (task, KPI, kho gắn theo id team).
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "hrm_project_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "teams_hrm_project_id_key" ON "teams"("hrm_project_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hrm_employee_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "users_hrm_employee_id_key" ON "users"("hrm_employee_id");

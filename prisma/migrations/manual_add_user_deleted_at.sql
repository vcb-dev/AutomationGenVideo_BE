-- Migration: add_user_deleted_at
-- Xóa mềm vĩnh viễn tài khoản (nút "Xóa tài khoản" ở Quản lý nhân sự): khác "Vô hiệu hóa" ở chỗ
-- không có nút "Kích hoạt lại" — tài khoản bị ẩn hoàn toàn khỏi mọi danh sách nhưng lịch sử
-- task/KPI/checklist gắn với user_id vẫn giữ nguyên (không xóa cứng để tránh lỗi FK constraint
-- trên hàng chục bảng liên quan tới users.id không có onDelete Cascade/SetNull).
-- Idempotent: chạy lại nhiều lần không lỗi.
-- LƯU Ý: phải schema-qualify "public"."users" — Supabase có sẵn bảng auth.users (GoTrue) trùng
-- tên và tình cờ đã có sẵn cột deleted_at riêng của nó, dễ nhầm là migration này đã chạy.
ALTER TABLE "public"."users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

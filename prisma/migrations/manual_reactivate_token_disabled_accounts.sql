-- Migration: reactivate_token_disabled_parent_accounts
-- Cron checkExpiringTokens (9h sáng) trước đây tự tắt is_active của account có token hết hạn,
-- khiến account cha (và mọi Facebook Page con render lồng dưới card của nó ở FE) biến mất khỏi
-- trang Kênh dù các page con trong DB vẫn active và page token vẫn đăng bài được. Cron đã được
-- sửa để chỉ cảnh báo, không tắt nữa — script này bật lại các account CHA bị cron tắt oan.
--
-- Phân biệt với account bị user chủ động gỡ (disconnect): disconnect tắt CẢ account con
-- (qua parent_id lẫn extra_data->>'parentAccountId'), còn cron chỉ tắt account cha —
-- nên "inactive nhưng còn >= 1 con active" chắc chắn là do cron, không phải do user gỡ.
-- Account không có con (TikTok/Zalo/YouTube...) không phân biệt được nguồn tắt nên KHÔNG đụng —
-- user reconnect qua OAuth là saveAccount tự bật lại is_active.
-- Idempotent: chạy lại nhiều lần không lỗi.
UPDATE social_accounts p
SET is_active = true, updated_at = NOW()
WHERE p.is_active = false
  AND p.token_expires_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM social_accounts c
    WHERE (c.parent_id = p.id OR c.extra_data->>'parentAccountId' = p.id)
      AND c.is_active = true
  );

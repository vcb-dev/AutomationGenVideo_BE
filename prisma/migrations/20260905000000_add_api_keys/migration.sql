-- API key cho hệ thống ngoài gọi server-to-server vào BE (header `X-API-Key: agv_...`).
-- DB chỉ giữ `key_hash` = sha256(key thô); key thô chỉ trả về 1 lần lúc tạo.
-- Mỗi key gắn 1-1 với 1 `service_user` (row `users` không đăng nhập được) để các endpoint dùng
-- `req.user.id` / `req.user.roles` chạy nguyên vẹn khi principal là API key.

CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "service_user_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- Tra key theo hash là đường nóng của mọi request server-to-server.
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_key" ON "api_keys"("key_hash");
-- 1 tài khoản dịch vụ ↔ tối đa 1 key.
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_service_user_id_key" ON "api_keys"("service_user_id");
CREATE INDEX IF NOT EXISTS "api_keys_is_active_idx" ON "api_keys"("is_active");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_service_user_id_fkey') THEN
        ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_user_id_fkey"
            FOREIGN KEY ("service_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_created_by_fkey') THEN
        ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey"
            FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

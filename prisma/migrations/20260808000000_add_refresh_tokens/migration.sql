-- CreateTable: refresh_tokens
CREATE TABLE "refresh_tokens" (
    "id"          UUID         NOT NULL,
    "user_id"     UUID         NOT NULL,
    "token_hash"  TEXT         NOT NULL,
    "family_id"   UUID         NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "revoked_at"  TIMESTAMP(3),
    "replaced_by" UUID,
    "user_agent"  TEXT,
    "ip_address"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Tra cứu lúc refresh đi thẳng qua index này: O(1) thay vì quét bảng.
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- Xoá user thì phiên của họ đi theo. Không có nhánh nào cần giữ token mồ côi lại.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

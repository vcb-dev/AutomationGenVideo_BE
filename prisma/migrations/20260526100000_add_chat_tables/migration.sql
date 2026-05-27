-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dashboard" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_conversations_user_id_idx" ON "chat_conversations"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_conversations_user_id_updated_at_idx" ON "chat_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_conversations_telegram_chat_id_idx" ON "chat_conversations"("telegram_chat_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_idx" ON "chat_messages"("conversation_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (only add if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chat_messages_conversation_id_fkey'
    ) THEN
        ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey"
            FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_chat_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON "chat_conversations";
CREATE TRIGGER trg_chat_conversations_updated_at
    BEFORE UPDATE ON "chat_conversations"
    FOR EACH ROW EXECUTE FUNCTION update_chat_conversations_updated_at();

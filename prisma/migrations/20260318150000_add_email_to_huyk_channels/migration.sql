-- Khớp schema Prisma model Channel (huyk_channels.email)
ALTER TABLE "huyk_channels" ADD COLUMN IF NOT EXISTS "email" TEXT;
CREATE INDEX IF NOT EXISTS "huyk_channels_email_idx" ON "huyk_channels"("email");

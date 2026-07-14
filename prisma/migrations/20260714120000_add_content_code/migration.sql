-- Add "code" (mã content) column to the three content warehouse tables,
-- mirroring the "sku" column already present on the product warehouse tables.
ALTER TABLE "contents" ADD COLUMN "code" TEXT;
ALTER TABLE "team_contents" ADD COLUMN "code" TEXT;
ALTER TABLE "editor_contents" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "contents_code_key" ON "contents"("code");
CREATE UNIQUE INDEX "team_contents_code_key" ON "team_contents"("code");
CREATE UNIQUE INDEX "editor_contents_code_key" ON "editor_contents"("code");

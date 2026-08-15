-- CreateTable
CREATE TABLE "mems_asset_photos" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "caption" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_asset_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mems_asset_photos_asset_id_sort_order_idx" ON "mems_asset_photos"("asset_id", "sort_order");

-- AddForeignKey
ALTER TABLE "mems_asset_photos" ADD CONSTRAINT "mems_asset_photos_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


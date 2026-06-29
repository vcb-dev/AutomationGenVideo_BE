-- CreateTable
CREATE TABLE "video_management_managedfacebookpage" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "page_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255),
    "category" VARCHAR(255) NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "page_access_token" TEXT NOT NULL DEFAULT '',
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "followers_count" BIGINT NOT NULL DEFAULT 0,
    "likes_count" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(6),
    "raw_data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "video_management_managedfacebookpage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_ownedvideocontent" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "managed_page_id" BIGINT NOT NULL,
    "post_id" VARCHAR(255) NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "permalink_url" VARCHAR(500),
    "thumbnail_url" TEXT,
    "video_url" TEXT,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "reach_count" INTEGER NOT NULL DEFAULT 0,
    "link_clicks" INTEGER NOT NULL DEFAULT 0,
    "raw_data" JSONB NOT NULL DEFAULT '{}',
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_ownedvideocontent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_management_managedfacebookpage_page_id_key" ON "video_management_managedfacebookpage"("page_id");

-- CreateIndex
CREATE INDEX "video_management_managedfacebookpage_page_id_idx" ON "video_management_managedfacebookpage"("page_id");

-- CreateIndex
CREATE INDEX "video_management_managedfacebookpage_is_active_idx" ON "video_management_managedfacebookpage"("is_active");

-- CreateIndex
CREATE INDEX "video_management_managedfacebookpage_is_active_name_idx" ON "video_management_managedfacebookpage"("is_active", "name");

-- CreateIndex
CREATE INDEX "video_management_managedfacebookpage_is_active_last_synced__idx" ON "video_management_managedfacebookpage"("is_active", "last_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_ownedvideocontent_post_id_key" ON "video_management_ownedvideocontent"("post_id");

-- CreateIndex
CREATE INDEX "video_management_ownedvideocontent_managed_page_id_idx" ON "video_management_ownedvideocontent"("managed_page_id");

-- CreateIndex
CREATE INDEX "video_management_ownedvideocontent_post_id_idx" ON "video_management_ownedvideocontent"("post_id");

-- CreateIndex
CREATE INDEX "video_management_ownedvideocontent_published_at_idx" ON "video_management_ownedvideocontent"("published_at");

-- CreateIndex
CREATE INDEX "video_management_ownedvideocontent_view_count_idx" ON "video_management_ownedvideocontent"("view_count");

-- CreateIndex
CREATE INDEX "video_management_ownedvideocontent_managed_page_id_view_cou_idx" ON "video_management_ownedvideocontent"("managed_page_id", "view_count" DESC);

-- AddForeignKey
ALTER TABLE "video_management_ownedvideocontent" ADD CONSTRAINT "video_management_ownedvideocontent_managed_page_id_fkey" FOREIGN KEY ("managed_page_id") REFERENCES "video_management_managedfacebookpage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the column `total_posts` on the `tracked_channels` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tracked_channels" DROP COLUMN "total_posts";

-- CreateTable
CREATE TABLE "auth_group" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,

    CONSTRAINT "auth_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_group_permissions" (
    "id" BIGSERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_group_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_permission" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content_type_id" INTEGER NOT NULL,
    "codename" VARCHAR(100) NOT NULL,

    CONSTRAINT "auth_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user" (
    "id" SERIAL NOT NULL,
    "password" VARCHAR(128) NOT NULL,
    "last_login" TIMESTAMPTZ(6),
    "is_superuser" BOOLEAN NOT NULL,
    "username" VARCHAR(150) NOT NULL,
    "first_name" VARCHAR(150) NOT NULL,
    "last_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "is_staff" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "date_joined" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_groups" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user_user_permissions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "auth_user_user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_admin_log" (
    "id" SERIAL NOT NULL,
    "action_time" TIMESTAMPTZ(6) NOT NULL,
    "object_id" TEXT,
    "object_repr" VARCHAR(200) NOT NULL,
    "action_flag" SMALLINT NOT NULL,
    "change_message" TEXT NOT NULL,
    "content_type_id" INTEGER,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "django_admin_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_content_type" (
    "id" SERIAL NOT NULL,
    "app_label" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,

    CONSTRAINT "django_content_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_migrations" (
    "id" BIGSERIAL NOT NULL,
    "app" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "applied" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "django_session" (
    "session_key" VARCHAR(40) NOT NULL,
    "session_data" TEXT NOT NULL,
    "expire_date" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "django_session_pkey" PRIMARY KEY ("session_key")
);

-- CreateTable
CREATE TABLE "video_management_collectionvideo" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "video_id" BIGINT NOT NULL,
    "collection_id" BIGINT NOT NULL,

    CONSTRAINT "video_management_collectionvideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_scrapedvideo" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "video_id" VARCHAR(255) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author_username" VARCHAR(255) NOT NULL,
    "author_name" VARCHAR(255) NOT NULL,
    "likes_count" BIGINT NOT NULL,
    "views_count" BIGINT NOT NULL,
    "comments_count" BIGINT NOT NULL,
    "shares_count" BIGINT NOT NULL,
    "video_url" VARCHAR(1000) NOT NULL,
    "download_url" VARCHAR(1000) NOT NULL,
    "thumbnail_url" VARCHAR(1000) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "hashtags" JSONB NOT NULL,
    "music_info" JSONB NOT NULL,
    "raw_data" JSONB NOT NULL,
    "search_history_id" BIGINT,
    "duration" DOUBLE PRECISION NOT NULL,
    "feature_vector" BYTEA,

    CONSTRAINT "video_management_scrapedvideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_searchhistory" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "keyword" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "min_likes" INTEGER NOT NULL,
    "min_views" INTEGER NOT NULL,
    "max_results" INTEGER NOT NULL,
    "results_count" INTEGER NOT NULL,
    "raw_results" JSONB NOT NULL,
    "task_id" VARCHAR(255),
    "error_message" TEXT,
    "execution_time" DOUBLE PRECISION NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_management_searchhistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_trackedchannel" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "check_interval_minutes" INTEGER NOT NULL,
    "min_likes_threshold" INTEGER NOT NULL,
    "last_checked_at" TIMESTAMPTZ(6),
    "follower_count" BIGINT NOT NULL,

    CONSTRAINT "video_management_trackedchannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_management_videocollection" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,

    CONSTRAINT "video_management_videocollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "platform" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_reports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT,
    "avatar" TEXT,
    "status" TEXT,
    "checklist" JSONB,
    "video_source_count" INTEGER NOT NULL DEFAULT 0,
    "questions" JSONB,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_name_key" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_name_a6ea08ec_like" ON "auth_group"("name");

-- CreateIndex
CREATE INDEX "auth_group_permissions_group_id_b120cbf9" ON "auth_group_permissions"("group_id");

-- CreateIndex
CREATE INDEX "auth_group_permissions_permission_id_84c5c92e" ON "auth_group_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_group_permissions_group_id_permission_id_0cd325b0_uniq" ON "auth_group_permissions"("group_id", "permission_id");

-- CreateIndex
CREATE INDEX "auth_permission_content_type_id_2f476e4b" ON "auth_permission"("content_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_permission_content_type_id_codename_01ab375a_uniq" ON "auth_permission"("content_type_id", "codename");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_username_key" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_username_6821ab7c_like" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_user_groups_group_id_97559544" ON "auth_user_groups"("group_id");

-- CreateIndex
CREATE INDEX "auth_user_groups_user_id_6a12ed8b" ON "auth_user_groups"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_groups_user_id_group_id_94350c0c_uniq" ON "auth_user_groups"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_permission_id_1fbb5f2c" ON "auth_user_user_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "auth_user_user_permissions_user_id_a95ead1b" ON "auth_user_user_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_user_permissions_user_id_permission_id_14a6b632_uniq" ON "auth_user_user_permissions"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "django_admin_log_content_type_id_c4bce8eb" ON "django_admin_log"("content_type_id");

-- CreateIndex
CREATE INDEX "django_admin_log_user_id_c564eba6" ON "django_admin_log"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "django_content_type_app_label_model_76bd3d3b_uniq" ON "django_content_type"("app_label", "model");

-- CreateIndex
CREATE INDEX "django_session_expire_date_a5c62663" ON "django_session"("expire_date");

-- CreateIndex
CREATE INDEX "django_session_session_key_c0390e0f_like" ON "django_session"("session_key");

-- CreateIndex
CREATE INDEX "video_manag_collect_c2bc46_idx" ON "video_management_collectionvideo"("collection_id", "order");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_collection_id_fc800f8b" ON "video_management_collectionvideo"("collection_id");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_created_at_e9cfa690" ON "video_management_collectionvideo"("created_at");

-- CreateIndex
CREATE INDEX "video_management_collectionvideo_video_id_38c886e2" ON "video_management_collectionvideo"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_collect_collection_id_video_id_e6a6a43b_uniq" ON "video_management_collectionvideo"("collection_id", "video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_scrapedvideo_video_id_key" ON "video_management_scrapedvideo"("video_id");

-- CreateIndex
CREATE INDEX "video_manag_author__e7db45_idx" ON "video_management_scrapedvideo"("author_username", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_manag_platfor_4f25a9_idx" ON "video_management_scrapedvideo"("platform", "likes_count" DESC);

-- CreateIndex
CREATE INDEX "video_manag_platfor_d00e35_idx" ON "video_management_scrapedvideo"("platform", "views_count" DESC);

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_author_username_0abb69cc" ON "video_management_scrapedvideo"("author_username");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_author_username_0abb69cc_like" ON "video_management_scrapedvideo"("author_username");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_created_at_ff4531cf" ON "video_management_scrapedvideo"("created_at");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_likes_count_3b349153" ON "video_management_scrapedvideo"("likes_count");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_platform_50b13b79" ON "video_management_scrapedvideo"("platform");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_platform_50b13b79_like" ON "video_management_scrapedvideo"("platform");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_published_at_085ce534" ON "video_management_scrapedvideo"("published_at");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_search_history_id_99cbd2b6" ON "video_management_scrapedvideo"("search_history_id");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_video_id_daf67164_like" ON "video_management_scrapedvideo"("video_id");

-- CreateIndex
CREATE INDEX "video_management_scrapedvideo_views_count_deb87e4a" ON "video_management_scrapedvideo"("views_count");

-- CreateIndex
CREATE INDEX "video_manag_platfor_cf643f_idx" ON "video_management_searchhistory"("platform", "keyword", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_manag_status_b42a65_idx" ON "video_management_searchhistory"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_management_searchhistory_created_at_442e2a9a" ON "video_management_searchhistory"("created_at");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_expires_at_1e28339e" ON "video_management_searchhistory"("expires_at");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_keyword_58f4c4f0" ON "video_management_searchhistory"("keyword");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_keyword_58f4c4f0_like" ON "video_management_searchhistory"("keyword");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_platform_6a299e04" ON "video_management_searchhistory"("platform");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_platform_6a299e04_like" ON "video_management_searchhistory"("platform");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_status_2477ce49" ON "video_management_searchhistory"("status");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_status_2477ce49_like" ON "video_management_searchhistory"("status");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_task_id_00dd06c2" ON "video_management_searchhistory"("task_id");

-- CreateIndex
CREATE INDEX "video_management_searchhistory_task_id_00dd06c2_like" ON "video_management_searchhistory"("task_id");

-- CreateIndex
CREATE INDEX "video_manag_is_acti_28ee72_idx" ON "video_management_trackedchannel"("is_active", "last_checked_at");

-- CreateIndex
CREATE INDEX "video_manag_platfor_25d894_idx" ON "video_management_trackedchannel"("platform", "is_active");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_created_at_c9729328" ON "video_management_trackedchannel"("created_at");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_is_active_f81e2fe8" ON "video_management_trackedchannel"("is_active");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_platform_4d998742" ON "video_management_trackedchannel"("platform");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_platform_4d998742_like" ON "video_management_trackedchannel"("platform");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_username_eb875a82" ON "video_management_trackedchannel"("username");

-- CreateIndex
CREATE INDEX "video_management_trackedchannel_username_eb875a82_like" ON "video_management_trackedchannel"("username");

-- CreateIndex
CREATE UNIQUE INDEX "video_management_tracked_platform_channel_id_7adddef1_uniq" ON "video_management_trackedchannel"("platform", "channel_id");

-- CreateIndex
CREATE INDEX "video_manag_name_1e4f76_idx" ON "video_management_videocollection"("name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "video_management_videocollection_created_at_6dd29d12" ON "video_management_videocollection"("created_at");

-- CreateIndex
CREATE INDEX "video_management_videocollection_name_fff3286f" ON "video_management_videocollection"("name");

-- CreateIndex
CREATE INDEX "video_management_videocollection_name_fff3286f_like" ON "video_management_videocollection"("name");

-- CreateIndex
CREATE INDEX "search_histories_user_id_idx" ON "search_histories"("user_id");

-- CreateIndex
CREATE INDEX "search_histories_timestamp_idx" ON "search_histories"("timestamp");

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissio_permission_id_84c5c92e_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_group_permissions" ADD CONSTRAINT "auth_group_permissions_group_id_b120cbf9_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_permission" ADD CONSTRAINT "auth_permission_content_type_id_2f476e4b_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_group_id_97559544_fk_auth_group_id" FOREIGN KEY ("group_id") REFERENCES "auth_group"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_groups" ADD CONSTRAINT "auth_user_groups_user_id_6a12ed8b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permi_permission_id_1fbb5f2c_fk_auth_perm" FOREIGN KEY ("permission_id") REFERENCES "auth_permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_user_user_permissions" ADD CONSTRAINT "auth_user_user_permissions_user_id_a95ead1b_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_content_type_id_c4bce8eb_fk_django_co" FOREIGN KEY ("content_type_id") REFERENCES "django_content_type"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "django_admin_log" ADD CONSTRAINT "django_admin_log_user_id_c564eba6_fk_auth_user_id" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_collectionvideo" ADD CONSTRAINT "video_management_col_collection_id_fc800f8b_fk_video_man" FOREIGN KEY ("collection_id") REFERENCES "video_management_videocollection"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_collectionvideo" ADD CONSTRAINT "video_management_col_video_id_38c886e2_fk_video_man" FOREIGN KEY ("video_id") REFERENCES "video_management_scrapedvideo"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "video_management_scrapedvideo" ADD CONSTRAINT "video_management_scr_search_history_id_99cbd2b6_fk_video_man" FOREIGN KEY ("search_history_id") REFERENCES "video_management_searchhistory"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

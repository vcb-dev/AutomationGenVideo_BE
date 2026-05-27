-- ═══════════════════════════════════════════════════════════════════
-- Migration: Thêm bảng social_video_snapshot
-- Mục đích : Chốt số liệu traffic cuối tháng để báo cáo công bằng
--            (video đăng cuối tháng có đủ thời gian tích lũy view)
-- Chạy     : psql $DATABASE_URL -f add_social_video_snapshot.sql
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS social_video_snapshot (
    -- Định danh
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform         TEXT NOT NULL,                    -- youtube | facebook | instagram | tiktok
    post_id          TEXT NOT NULL,                    -- ID video/post trên platform

    -- Thông tin kênh (copy từ social_video_report lúc chốt)
    channel_name     TEXT,
    username         TEXT,
    owner            TEXT,
    team             TEXT,
    title            TEXT,

    -- Số liệu ĐÃ CHỐT (bất biến sau khi lock)
    views_locked     BIGINT  NOT NULL DEFAULT 0,
    likes_locked     BIGINT  NOT NULL DEFAULT 0,
    comments_locked  BIGINT  NOT NULL DEFAULT 0,
    shares_locked    BIGINT  NOT NULL DEFAULT 0,
    followers_locked BIGINT  NOT NULL DEFAULT 0,

    -- Ngày đăng gốc (để biết video nằm cuối tháng)
    published_at     TIMESTAMPTZ,

    -- Tháng báo cáo (= tháng video được published)
    report_year      INT NOT NULL,
    report_month     INT NOT NULL,

    -- Thời điểm chốt (ví dụ: 07/05 cho báo cáo tháng 4)
    locked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique: mỗi video chỉ có 1 snapshot/tháng
    CONSTRAINT uq_snapshot_platform_post_month
        UNIQUE (platform, post_id, report_year, report_month)
);

-- Index để chatbot query nhanh
CREATE INDEX IF NOT EXISTS idx_snapshot_year_month
    ON social_video_snapshot (report_year, report_month);

CREATE INDEX IF NOT EXISTS idx_snapshot_team_year_month
    ON social_video_snapshot (team, report_year, report_month);

CREATE INDEX IF NOT EXISTS idx_snapshot_platform_year_month
    ON social_video_snapshot (platform, report_year, report_month);

CREATE INDEX IF NOT EXISTS idx_snapshot_owner
    ON social_video_snapshot (owner);

-- Comment để dễ nhớ
COMMENT ON TABLE social_video_snapshot IS
    'Số liệu traffic đã chốt cuối tháng. Chạy lock_monthly_report.py ngày 7 hàng tháng.';
COMMENT ON COLUMN social_video_snapshot.views_locked IS
    'Tổng views tại thời điểm chốt (ngày 7 tháng sau) — bất biến';
COMMENT ON COLUMN social_video_snapshot.locked_at IS
    'Thời điểm script lock_monthly_report.py chạy và chốt số liệu';

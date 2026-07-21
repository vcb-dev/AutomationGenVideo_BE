-- Tạo bảng lark_traffic giả lập để các migration alter table phía sau chạy được trên Shadow DB
CREATE TABLE IF NOT EXISTS "lark_traffic" (
    "id" SERIAL NOT NULL,
    PRIMARY KEY ("id")
);

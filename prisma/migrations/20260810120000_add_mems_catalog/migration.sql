-- CreateEnum
CREATE TYPE "MemsAssetStatus" AS ENUM ('PENDING_INSPECTION', 'AVAILABLE', 'ON_LOAN', 'POST_RETURN_CHECK', 'UNDER_MAINTENANCE', 'BROKEN', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "MemsAssetCondition" AS ENUM ('GOOD', 'USED', 'NEEDS_CHECK', 'BROKEN', 'IN_MAINTENANCE');

-- CreateEnum
CREATE TYPE "MemsRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'PREPARING', 'ON_LOAN', 'PARTIALLY_RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemsLineStatus" AS ENUM ('BACKORDERED', 'RESERVED', 'ALLOCATED', 'ON_LOAN', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MemsReservationStatus" AS ENUM ('TENTATIVE', 'CONFIRMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "MemsRole" AS ENUM ('MEMBER', 'APPROVER', 'MANAGER', 'ADMIN');

-- CreateTable
CREATE TABLE "mems_departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "borrow_limit" INTEGER,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "role" "MemsRole" NOT NULL DEFAULT 'MEMBER',
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_asset_models" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "reference_price" DECIMAL(14,2),
    "is_pooled" BOOLEAN NOT NULL DEFAULT false,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_asset_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_assets" (
    "id" UUID NOT NULL,
    "asset_code" TEXT NOT NULL,
    "model_id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "condition" "MemsAssetCondition" NOT NULL DEFAULT 'GOOD',
    "status" "MemsAssetStatus" NOT NULL DEFAULT 'PENDING_INSPECTION',
    "location_id" UUID,
    "purchase_date" DATE,
    "purchase_price" DECIMAL(14,2),
    "qr_code" TEXT NOT NULL,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mems_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_borrow_requests" (
    "id" UUID NOT NULL,
    "request_code" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "project" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "from_time" TIMESTAMP(3) NOT NULL,
    "to_time" TIMESTAMP(3) NOT NULL,
    "status" "MemsRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "is_fast_track" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mems_borrow_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_request_lines" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "MemsLineStatus" NOT NULL DEFAULT 'RESERVED',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_reservations" (
    "id" UUID NOT NULL,
    "request_line_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "asset_id" UUID,
    "from_time" TIMESTAMP(3) NOT NULL,
    "to_time" TIMESTAMP(3) NOT NULL,
    "buffer_to_time" TIMESTAMP(3) NOT NULL,
    "status" "MemsReservationStatus" NOT NULL DEFAULT 'TENTATIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_maintenances" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "from_time" TIMESTAMP(3) NOT NULL,
    "to_time" TIMESTAMP(3),
    "cost" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mems_departments_code_key" ON "mems_departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "mems_members_user_id_key" ON "mems_members"("user_id");

-- CreateIndex
CREATE INDEX "mems_members_department_id_idx" ON "mems_members"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_categories_code_key" ON "mems_categories"("code");

-- CreateIndex
CREATE INDEX "mems_categories_parent_id_idx" ON "mems_categories"("parent_id");

-- CreateIndex
CREATE INDEX "mems_asset_models_category_id_idx" ON "mems_asset_models"("category_id");

-- CreateIndex
CREATE INDEX "mems_locations_parent_id_idx" ON "mems_locations"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_assets_asset_code_key" ON "mems_assets"("asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "mems_assets_serial_number_key" ON "mems_assets"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "mems_assets_qr_code_key" ON "mems_assets"("qr_code");

-- CreateIndex
CREATE INDEX "mems_assets_model_id_status_idx" ON "mems_assets"("model_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mems_borrow_requests_request_code_key" ON "mems_borrow_requests"("request_code");

-- CreateIndex
CREATE INDEX "mems_borrow_requests_owner_id_status_idx" ON "mems_borrow_requests"("owner_id", "status");

-- CreateIndex
CREATE INDEX "mems_request_lines_request_id_idx" ON "mems_request_lines"("request_id");

-- CreateIndex
CREATE INDEX "mems_reservations_model_id_status_from_time_buffer_to_time_idx" ON "mems_reservations"("model_id", "status", "from_time", "buffer_to_time");

-- CreateIndex
CREATE INDEX "mems_maintenances_asset_id_from_time_idx" ON "mems_maintenances"("asset_id", "from_time");

-- AddForeignKey
ALTER TABLE "mems_members" ADD CONSTRAINT "mems_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "mems_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_categories" ADD CONSTRAINT "mems_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "mems_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_asset_models" ADD CONSTRAINT "mems_asset_models_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "mems_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_locations" ADD CONSTRAINT "mems_locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "mems_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_assets" ADD CONSTRAINT "mems_assets_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "mems_asset_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_assets" ADD CONSTRAINT "mems_assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "mems_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_borrow_requests" ADD CONSTRAINT "mems_borrow_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "mems_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_request_lines" ADD CONSTRAINT "mems_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_request_lines" ADD CONSTRAINT "mems_request_lines_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "mems_asset_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_reservations" ADD CONSTRAINT "mems_reservations_request_line_id_fkey" FOREIGN KEY ("request_line_id") REFERENCES "mems_request_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_reservations" ADD CONSTRAINT "mems_reservations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "mems_asset_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_reservations" ADD CONSTRAINT "mems_reservations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_maintenances" ADD CONSTRAINT "mems_maintenances_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


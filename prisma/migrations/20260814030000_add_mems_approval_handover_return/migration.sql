-- CreateEnum
CREATE TYPE "MemsApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MemsIncidentKind" AS ENUM ('CONDITION_WORSENED', 'MISSING_ACCESSORY', 'OVERDUE');

-- CreateEnum
CREATE TYPE "MemsIncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "MemsAssetEventKind" AS ENUM ('INTAKE', 'HANDED_OVER', 'RETURNED', 'INSPECTED', 'CONDITION_CHANGED', 'MAINTENANCE', 'INCIDENT');

-- CreateTable
CREATE TABLE "mems_approvals" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "decision" "MemsApprovalDecision" NOT NULL,
    "decided_by" UUID NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_accessories" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mems_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_handovers" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "handed_by" UUID NOT NULL,
    "received_by" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_handover_lines" (
    "id" UUID NOT NULL,
    "handover_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "condition" "MemsAssetCondition" NOT NULL,
    "note" TEXT,

    CONSTRAINT "mems_handover_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_handover_photos" (
    "id" UUID NOT NULL,
    "handover_line_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_handover_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_handover_accessories" (
    "id" UUID NOT NULL,
    "handover_line_id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "is_present" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mems_handover_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_returns" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "received_by" UUID NOT NULL,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "handover_line_id" UUID,
    "condition_before" "MemsAssetCondition" NOT NULL,
    "condition_after" "MemsAssetCondition" NOT NULL,
    "resulting_status" "MemsAssetStatus" NOT NULL,
    "note" TEXT,

    CONSTRAINT "mems_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_return_photos" (
    "id" UUID NOT NULL,
    "return_line_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_return_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_return_accessories" (
    "id" UUID NOT NULL,
    "return_line_id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "is_present" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mems_return_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_incidents" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "request_id" UUID,
    "return_line_id" UUID,
    "responsible_id" UUID,
    "kind" "MemsIncidentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "MemsIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mems_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_asset_events" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" "MemsAssetEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "actor_id" UUID,
    "request_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mems_approvals_request_id_decided_at_idx" ON "mems_approvals"("request_id", "decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "mems_accessories_model_id_name_key" ON "mems_accessories"("model_id", "name");

-- CreateIndex
CREATE INDEX "mems_handovers_request_id_idx" ON "mems_handovers"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_handover_lines_handover_id_asset_id_key" ON "mems_handover_lines"("handover_id", "asset_id");

-- CreateIndex
CREATE INDEX "mems_handover_photos_handover_line_id_idx" ON "mems_handover_photos"("handover_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_handover_accessories_handover_line_id_accessory_id_key" ON "mems_handover_accessories"("handover_line_id", "accessory_id");

-- CreateIndex
CREATE INDEX "mems_returns_request_id_idx" ON "mems_returns"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_return_lines_return_id_asset_id_key" ON "mems_return_lines"("return_id", "asset_id");

-- CreateIndex
CREATE INDEX "mems_return_photos_return_line_id_idx" ON "mems_return_photos"("return_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "mems_return_accessories_return_line_id_accessory_id_key" ON "mems_return_accessories"("return_line_id", "accessory_id");

-- CreateIndex
CREATE INDEX "mems_incidents_asset_id_status_idx" ON "mems_incidents"("asset_id", "status");

-- CreateIndex
CREATE INDEX "mems_asset_events_asset_id_occurred_at_idx" ON "mems_asset_events"("asset_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "mems_approvals" ADD CONSTRAINT "mems_approvals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_accessories" ADD CONSTRAINT "mems_accessories_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "mems_asset_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handovers" ADD CONSTRAINT "mems_handovers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handover_lines" ADD CONSTRAINT "mems_handover_lines_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "mems_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handover_lines" ADD CONSTRAINT "mems_handover_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handover_photos" ADD CONSTRAINT "mems_handover_photos_handover_line_id_fkey" FOREIGN KEY ("handover_line_id") REFERENCES "mems_handover_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handover_accessories" ADD CONSTRAINT "mems_handover_accessories_handover_line_id_fkey" FOREIGN KEY ("handover_line_id") REFERENCES "mems_handover_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_handover_accessories" ADD CONSTRAINT "mems_handover_accessories_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "mems_accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_returns" ADD CONSTRAINT "mems_returns_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_lines" ADD CONSTRAINT "mems_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "mems_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_lines" ADD CONSTRAINT "mems_return_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_lines" ADD CONSTRAINT "mems_return_lines_handover_line_id_fkey" FOREIGN KEY ("handover_line_id") REFERENCES "mems_handover_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_photos" ADD CONSTRAINT "mems_return_photos_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "mems_return_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_accessories" ADD CONSTRAINT "mems_return_accessories_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "mems_return_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_return_accessories" ADD CONSTRAINT "mems_return_accessories_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "mems_accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_incidents" ADD CONSTRAINT "mems_incidents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_incidents" ADD CONSTRAINT "mems_incidents_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "mems_return_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_asset_events" ADD CONSTRAINT "mems_asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "mems_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "MemsExtensionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "mems_incidents" ADD COLUMN     "reported_by" UUID;

-- CreateTable
CREATE TABLE "mems_request_photos" (
    "id" UUID NOT NULL,
    "request_id" UUID,
    "incident_id" UUID,
    "url" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'local',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mems_request_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mems_loan_extensions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "requested_to_time" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MemsExtensionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,

    CONSTRAINT "mems_loan_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mems_request_photos_request_id_idx" ON "mems_request_photos"("request_id");

-- CreateIndex
CREATE INDEX "mems_request_photos_incident_id_idx" ON "mems_request_photos"("incident_id");

-- CreateIndex
CREATE INDEX "mems_loan_extensions_request_id_requested_at_idx" ON "mems_loan_extensions"("request_id", "requested_at");

-- AddForeignKey
ALTER TABLE "mems_request_photos" ADD CONSTRAINT "mems_request_photos_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_request_photos" ADD CONSTRAINT "mems_request_photos_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "mems_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mems_loan_extensions" ADD CONSTRAINT "mems_loan_extensions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "mems_borrow_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


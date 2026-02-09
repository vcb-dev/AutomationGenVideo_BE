-- CreateTable
CREATE TABLE "lark_employees" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "employee_data" JSONB,
    "tag_code" TEXT,
    "position" TEXT,
    "team" TEXT,
    "status" TEXT,
    "date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lark_employees_employee_id_key" ON "lark_employees"("employee_id");

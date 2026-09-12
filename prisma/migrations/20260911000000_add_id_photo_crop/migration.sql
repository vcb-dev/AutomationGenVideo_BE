-- AlterTable
ALTER TABLE "id_photo_histories" ADD COLUMN     "crop_offset_x" DOUBLE PRECISION,
ADD COLUMN     "crop_offset_y" DOUBLE PRECISION,
ADD COLUMN     "crop_scale" DOUBLE PRECISION;

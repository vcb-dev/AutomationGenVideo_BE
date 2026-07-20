import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Đánh dấu 1 route bỏ qua JwtAuthGuard dù controller có @UseGuards(JwtAuthGuard) ở class-level. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

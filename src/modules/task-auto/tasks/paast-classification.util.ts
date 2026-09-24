import { Prisma } from "@prisma/client";

/**
 * Khoá tra cứu của `content_paast_analyzed` (seed ở migration 20260923090000). Đổi tên phân loại này
 * thì phải đổi kèm hằng số, nếu không số thực đạt về 0.
 */
export const PAAST_CLASSIFICATION_NAME = "Phân tích theo PAAST";

/**
 * Phải AND với bộ lọc của chỗ gọi, KHÔNG spread chung một object: mảnh này dùng `OR`, deadlineWindow()
 * cũng dùng `OR` — spread sẽ ghi đè nhau im lặng.
 */
export function paastAnalyzedTaskWhere(): Prisma.TaskWhereInput {
  // Bỏ qua hoa-thường cho khớp cách editor-kpi-actuals.util.ts đếm.
  const classification = {
    classification: {
      name: {
        equals: PAAST_CLASSIFICATION_NAME,
        mode: Prisma.QueryMode.insensitive,
      },
    },
  };
  return {
    OR: [
      { content: classification },
      { editor_content: classification },
      { team_content: classification },
    ],
  };
}

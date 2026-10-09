import { Prisma } from "@prisma/client";

export const PAAST_CLASSIFICATION_NAME = "Phân tích theo PAAST";

export function paastAnalyzedTaskWhere(): Prisma.TaskWhereInput {
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

export interface TaskProductRefs {
  product_line_id: string | null;
  product_id: string | null;
  editor_product_id: string | null;
  team_product_id: string | null;
}

export interface ProductLineLookup {
  byProductId: Map<string, string | null>;
  byEditorProductId: Map<string, string | null>;
  byTeamProductId: Map<string, string | null>;
}

export function resolveTaskProductLineId(
  task: TaskProductRefs,
  lookup: ProductLineLookup,
): string | null {
  return (
    task.product_line_id ??
    (task.product_id ? lookup.byProductId.get(task.product_id) : null) ??
    (task.editor_product_id ? lookup.byEditorProductId.get(task.editor_product_id) : null) ??
    (task.team_product_id ? lookup.byTeamProductId.get(task.team_product_id) : null) ??
    null
  );
}

export function productLineCategoryLabel(line: {
  name: string | null;
  video_category: string | null;
}): string {
  return (line.video_category || line.name || "").toUpperCase();
}

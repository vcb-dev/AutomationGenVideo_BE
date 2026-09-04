/** Một tiêu chí PAAST đang `miss` — input cho bước nâng cấp content. */
export interface MissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

/**
 * Trích các tiêu chí `miss` từ 1 bản phân tích PAAST (bỏ tiêu chí `na` của Stick — phần cần
 * production không sửa được bằng text, business doc §11.2). Dùng chung cho
 * PaastService.upgradeAnalysis và AiIntegrationService.upgradeContent.
 */
export function extractMissingElements(analysisResult: any): MissingElement[] {
  const layers = analysisResult?.layers || {};
  const missing: MissingElement[] = [];
  const criteriaLayers: Array<[string, string]> = [
    ['action', 'criteria'],
    ['acknowledge', 'criteria'],
    ['stick', 'criteria'],
    ['trust', 'criteria'],
  ];

  for (const [layerKey, field] of criteriaLayers) {
    const criteria = layers[layerKey]?.[field] || [];
    for (const c of criteria) {
      if (c.status === 'miss') {
        missing.push({ layer: layerKey, criterion: c.code, suggestion: c.evidence || '' });
      }
    }
  }
  return missing;
}

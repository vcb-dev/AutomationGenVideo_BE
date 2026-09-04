/** Một tiêu chí PAAST đang `miss` — dùng làm input cho bước nâng cấp content. */
export interface MissingElement {
  layer: string;
  criterion: string;
  suggestion: string;
}

/**
 * Trích các tiêu chí đang `miss` từ 1 bản phân tích PAAST (loại tiêu chí `na` của Stick — không
 * thể "nâng cấp" phần cần production bằng cách sửa text, business doc §11.2).
 *
 * Dùng chung cho cả PAAST Analyzer (PaastService.upgradeAnalysis) lẫn luồng content-transform
 * (AiIntegrationService.upgradeContent) — hai nơi cùng cần đúng danh sách tiêu chí thiếu này.
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

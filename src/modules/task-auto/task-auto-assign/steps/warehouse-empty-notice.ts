// Giữ đúng shape meta cũ (productKpi/contentLines) — WarehouseEmptyBanner ở FE đọc thẳng các field này.
export type EmptyWarehouseNoticeMeta = {
  videosNeededToday: number;
  productKpi: null;
  contentLines: { id: string; name: string; count: number }[];
};

export type EmptyWarehouseNotice = {
  editorId: string;
  title: string;
  body: string;
  meta: EmptyWarehouseNoticeMeta;
};

/**
 * Thông báo cho editor còn phải làm task tuyến tự động hôm nay nhưng Kho sản phẩm của team không có
 * SP nào đang bật — không tạo được task, báo số video cần làm để editor tự tạo task hoặc nhờ leader
 * bổ sung kho.
 */
export function buildEmptyWarehouseNotice(args: {
  editorId: string;
  videosNeeded: number;
  contentLine: { id: string; name: string };
}): EmptyWarehouseNotice {
  const { editorId, videosNeeded, contentLine } = args;
  return {
    editorId,
    title: `Không có task ${contentLine.name} tự động hôm nay — kho sản phẩm team đang trống`,
    body: `Cần làm ${videosNeeded} video ${contentLine.name} hôm nay theo KPI nhưng Kho sản phẩm của team chưa có sản phẩm nào đang bật để tạo task tự động.`,
    meta: {
      videosNeededToday: videosNeeded,
      productKpi: null,
      contentLines: [{ id: contentLine.id, name: contentLine.name, count: videosNeeded }],
    },
  };
}

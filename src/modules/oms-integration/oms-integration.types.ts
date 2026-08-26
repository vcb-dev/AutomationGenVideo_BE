/** Kiểu dữ liệu trả về từ OMS (warehouse-be, xem OMS_API_URL trong .env) — xác định bằng cách
 *  gọi thử API thật, không phải tài liệu chính thức nên chỉ khai đúng field đang dùng tới. */

export interface OmsProductSummary {
  id: string;
  alias: string;
  name: string;
  image_url: string | null;
  default_sku: string;
  skus: string[];
  variant_count: number;
  matched_sku: string | null;
  vendor: string | null;
  product_type: string | null;
  unit: string | null;
  tags: string[];
  price_from: number;
  is_published: boolean;
}

export interface OmsProductListResponse {
  data: OmsProductSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface OmsProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  price: number;
  compare_at_price: number | null;
  cost: number | null;
  image_url: string | null;
  enabled: boolean;
  option_values: string[];
}

export interface OmsProductImage {
  id: string;
  url: string;
  position: number;
  is_primary: boolean;
}

export interface OmsProductDetail {
  id: string;
  alias: string;
  name: string;
  vendor: string | null;
  product_type: string | null;
  tags: string[];
  is_published: boolean;
  image_url: string | null;
  images: OmsProductImage[];
  variants: OmsProductVariant[];
  category_ids: string[];
  created_at: string;
  updated_at: string;
}

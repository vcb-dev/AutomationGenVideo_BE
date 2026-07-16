-- Unique sku per scope, needed so auto-link-by-code (Source.code <-> Product.sku) has a
-- deterministic match instead of an ambiguous one when multiple products share a code.
-- Verified against prod data before writing this: 0 duplicate (team_id, sku) rows in
-- team_products and 0 duplicate (user_id, sku) rows in editor_products.
CREATE UNIQUE INDEX IF NOT EXISTS "team_products_team_id_sku_key" ON "team_products" ("team_id", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "editor_products_user_id_sku_key" ON "editor_products" ("user_id", "sku");

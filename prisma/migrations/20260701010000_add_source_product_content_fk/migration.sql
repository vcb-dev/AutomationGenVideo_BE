-- Add missing FK constraints for source_product_id / source_content_id ("copied from global
-- catalog" provenance), mirroring the existing source_source_id pattern on team_sources /
-- editor_sources. Verified 0 orphaned rows before adding these constraints.

ALTER TABLE "team_products"
  ADD CONSTRAINT "team_products_source_product_id_fkey"
  FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "editor_products"
  ADD CONSTRAINT "editor_products_source_product_id_fkey"
  FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_contents"
  ADD CONSTRAINT "team_contents_source_content_id_fkey"
  FOREIGN KEY ("source_content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "editor_contents"
  ADD CONSTRAINT "editor_contents_source_content_id_fkey"
  FOREIGN KEY ("source_content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add brand_type to teams table
ALTER TABLE teams ADD COLUMN IF NOT EXISTS brand_type TEXT NOT NULL DEFAULT 'DO_DA';
CREATE INDEX IF NOT EXISTS teams_brand_type_idx ON teams(brand_type);

-- Add composite index on contents for brand_type + status filter
CREATE INDEX IF NOT EXISTS contents_brand_type_status_idx ON contents(brand_type, status);

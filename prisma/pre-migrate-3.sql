-- Enable pg_trgm extension for fast ILIKE full-text search on report_outstanding.content
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index — speeds up ILIKE '%keyword%' queries by 10-100x
CREATE INDEX IF NOT EXISTS report_outstanding_content_trgm
    ON report_outstanding
    USING GIN (content gin_trgm_ops);
